-- O cliente redefine a própria senha pelo e-mail cadastrado (link de uso único, 30 minutos).
alter table app.clientes add column email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

create table app.portal_redefinicoes (
  token_hash text primary key,
  cliente_id uuid not null references app.clientes(id),
  criado_em  timestamptz not null default now(),
  expira_em  timestamptz not null,
  usado_em   timestamptz
);
alter table app.portal_redefinicoes enable row level security;   -- sem políticas: só pelas funções

-- Pedido de redefinição: devolve nome e e-mail para a aplicação mandar o link (nada se não houver e-mail)
create or replace function app.portal_pedir_redefinicao(p_documento text, p_token_hash text)
returns table (nome text, email text)
language plpgsql security definer set search_path = app, pg_temp as $$
declare c app.clientes;
begin
  select cl.* into c from app.clientes cl join app.portal_acessos a on a.cliente_id = cl.id
   where cl.documento_login = app.normalizar_documento(p_documento) and cl.portal_ativo and cl.mesclado_em is null;
  if c.id is null or c.email is null then return; end if;
  if (select count(*) from app.portal_redefinicoes where cliente_id = c.id and criado_em > now() - interval '1 hour') >= 3 then return; end if;
  insert into app.portal_redefinicoes (token_hash, cliente_id, expira_em) values (p_token_hash, c.id, now() + interval '30 minutes');
  return query select c.nome, c.email;
end $$;

create or replace function app.portal_redefinicao_valida(p_token_hash text) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select exists (select 1 from app.portal_redefinicoes where token_hash = p_token_hash and usado_em is null and expira_em > now())
$$;

-- Grava a senha nova (hash), derruba as sessões abertas e tira o bloqueio por tentativas erradas
create or replace function app.portal_redefinir_senha(p_token_hash text, p_senha_hash text) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare r app.portal_redefinicoes; v_login text;
begin
  select * into r from app.portal_redefinicoes where token_hash = p_token_hash for update;
  if r.cliente_id is null or r.usado_em is not null or r.expira_em <= now() then
    raise exception 'Este link já foi usado ou venceu. Peça um novo.';
  end if;
  if coalesce(length(p_senha_hash), 0) < 20 then raise exception 'Senha inválida.'; end if;
  update app.portal_acessos set senha_hash = p_senha_hash, trocada_em = now() where cliente_id = r.cliente_id;
  update app.portal_redefinicoes set usado_em = now() where token_hash = p_token_hash;
  delete from app.portal_sessoes where cliente_id = r.cliente_id;
  select documento_login into v_login from app.clientes where id = r.cliente_id;
  delete from app.tentativas_login where email = 'cliente:' || v_login and not ok;
  return r.cliente_id;
end $$;

grant execute on function app.portal_pedir_redefinicao(text, text), app.portal_redefinicao_valida(text), app.portal_redefinir_senha(text, text) to vc_app;
