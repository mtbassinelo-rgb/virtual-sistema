-- Login do cliente na área de atacado com o número do documento (CI/RUC no Paraguai, CPF/CNPJ no Brasil)
-- e uma senha. A vendedora gera uma senha inicial de 6 números (o sistema sorteia; ninguém escolhe
-- uma senha igual para todos) e o cliente pode trocar depois em "Minha conta". Não expira.
alter table app.clientes add column documento text check (length(documento) <= 30);
alter table app.clientes add column documento_login text
  generated always as (nullif(upper(regexp_replace(coalesce(documento, ''), '[^0-9A-Za-z]', '', 'g')), '')) stored;
create unique index clientes_documento_login on app.clientes (documento_login) where documento_login is not null and mesclado_em is null;
grant update (documento) on app.clientes to vc_app;

create table app.portal_acessos (
  cliente_id  uuid primary key references app.clientes(id),
  senha_hash  text not null check (length(senha_hash) >= 20),
  criado_por  uuid references app.usuarios(id),
  criado_em   timestamptz not null default now(),
  trocada_em  timestamptz                              -- quando o próprio cliente trocou
);
alter table app.portal_acessos enable row level security;   -- sem políticas: acesso só pelas funções

create or replace function app.normalizar_documento(p text) returns text
language sql immutable as $$ select nullif(upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')), '') $$;

-- Vendedora/gerência: grava o documento e a senha inicial (hash). Derruba as sessões abertas.
create or replace function app.definir_acesso_cliente(p_cliente uuid, p_documento text, p_senha_hash text) returns text
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_vend uuid; v_login text := app.normalizar_documento(p_documento); v_outro text;
begin
  select vendedora_id into v_vend from app.clientes where id = p_cliente and mesclado_em is null;
  if v_vend is null or not app.pode_escrever() or not app.ve_pedido(v_vend) then
    raise exception 'Sem permissão para dar acesso a este cliente.' using errcode = 'insufficient_privilege';
  end if;
  if v_login is null or length(v_login) < 5 then raise exception 'Informe o CI, RUC, CPF ou CNPJ do cliente.'; end if;
  select nome into v_outro from app.clientes where documento_login = v_login and id <> p_cliente and mesclado_em is null;
  if v_outro is not null then raise exception 'Este documento já está no cadastro de outro cliente: %.', v_outro; end if;
  if coalesce(length(p_senha_hash), 0) < 20 then raise exception 'Senha inválida.'; end if;
  update app.clientes set documento = left(trim(p_documento), 30), portal_ativo = true where id = p_cliente;
  insert into app.portal_acessos (cliente_id, senha_hash, criado_por) values (p_cliente, p_senha_hash, app.uid())
  on conflict (cliente_id) do update set senha_hash = excluded.senha_hash, criado_por = excluded.criado_por, criado_em = now(), trocada_em = null;
  delete from app.portal_sessoes where cliente_id = p_cliente;
  return v_login;
end $$;

-- Login: dados para conferir a senha (a comparação é feita na aplicação com argon2).
-- 5 senhas erradas em 15 minutos bloqueiam aquele documento por 15 minutos.
create or replace function app.portal_dados_login(p_documento text)
returns table (cliente_id uuid, senha_hash text, bloqueado boolean)
language sql stable security definer set search_path = app, pg_temp as $$
  select c.id, a.senha_hash,
         (select count(*) from app.tentativas_login t
           where t.email = 'cliente:' || app.normalizar_documento(p_documento) and not t.ok and t.em > now() - interval '15 minutes') >= 5
    from app.clientes c join app.portal_acessos a on a.cliente_id = c.id
   where c.documento_login = app.normalizar_documento(p_documento) and c.portal_ativo and c.mesclado_em is null
$$;

create or replace function app.portal_registrar_tentativa(p_documento text, p_ok boolean) returns void
language sql security definer set search_path = app, pg_temp as $$
  insert into app.tentativas_login (email, ok) values ('cliente:' || coalesce(app.normalizar_documento(p_documento), '?'), p_ok)
$$;

create or replace function app.portal_abrir_sessao(p_cliente uuid, p_sessao_hash text) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not exists (select 1 from app.clientes c join app.portal_acessos a on a.cliente_id = c.id
                  where c.id = p_cliente and c.portal_ativo and c.mesclado_em is null) then
    raise exception 'Acesso do cliente inativo.';
  end if;
  delete from app.portal_sessoes where expira_em < now();
  insert into app.portal_sessoes (token_hash, cliente_id, expira_em)
  values (p_sessao_hash, p_cliente, now() + make_interval(days => app.param('sessao_cliente_dias')::int));
end $$;

-- O cliente troca a própria senha (a aplicação confere a atual antes). Outras sessões dele caem.
create or replace function app.portal_trocar_senha(p_sessao_hash text, p_senha_hash text) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_cli uuid := app.portal_cliente_id(p_sessao_hash);
begin
  if v_cli is null then raise exception 'Entre na área do cliente para trocar a senha.'; end if;
  if coalesce(length(p_senha_hash), 0) < 20 then raise exception 'Senha inválida.'; end if;
  update app.portal_acessos set senha_hash = p_senha_hash, trocada_em = now() where cliente_id = v_cli;
  delete from app.portal_sessoes where cliente_id = v_cli and token_hash <> p_sessao_hash;
end $$;

-- Documento do cliente logado (para a tela Minha conta e para conferir a senha atual)
create or replace function app.portal_documento(p_sessao_hash text) returns text
language sql stable security definer set search_path = app, pg_temp as $$
  select documento from app.clientes where id = app.portal_cliente_id(p_sessao_hash)
$$;

-- Bloquear acesso também apaga a senha
create or replace function app.bloquear_portal(p_cliente uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.pode_escrever() or not app.ve_pedido((select vendedora_id from app.clientes where id = p_cliente)) then
    raise exception 'Sem permissão.' using errcode = 'insufficient_privilege';
  end if;
  update app.clientes set portal_ativo = false where id = p_cliente;
  delete from app.portal_sessoes where cliente_id = p_cliente;
  delete from app.portal_convites where cliente_id = p_cliente and usado_em is null;
  delete from app.portal_acessos where cliente_id = p_cliente;
end $$;

grant execute on function app.normalizar_documento(text), app.definir_acesso_cliente(uuid, text, text), app.portal_dados_login(text),
  app.portal_registrar_tentativa(text, boolean), app.portal_abrir_sessao(uuid, text), app.portal_trocar_senha(text, text),
  app.portal_documento(text) to vc_app;
