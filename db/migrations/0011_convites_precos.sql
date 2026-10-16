-- 1) Primeiro acesso da equipe por link de uso único: a pessoa cria a própria senha.
--    Ninguém (nem quem cadastra) conhece a senha de outra pessoa.
-- 2) Tabela de preços por planilha (todas as tabelas de uma vez).

create table app.usuario_convites (
  token_hash  text primary key,                 -- sha256 do token; o token só existe no link
  usuario_id  uuid not null references app.usuarios(id),
  expira_em   timestamptz not null,
  usado_em    timestamptz,
  criado_em   timestamptz not null default now()
);
alter table app.usuario_convites enable row level security;   -- acesso só pelas funções abaixo

create or replace function app.convite_usuario(p_token_hash text)
returns table (nome text, email text)
language sql stable security definer set search_path = app, pg_temp as $$
  select u.nome, u.email from app.usuario_convites c join app.usuarios u on u.id = c.usuario_id
   where c.token_hash = p_token_hash and c.usado_em is null and c.expira_em > now() and u.ativo
$$;

create or replace function app.usar_convite_usuario(p_token_hash text, p_senha_hash text)
returns text language plpgsql security definer set search_path = app, pg_temp as $$
declare v_usuario uuid; v_email text;
begin
  update app.usuario_convites c set usado_em = now()
   where c.token_hash = p_token_hash and c.usado_em is null and c.expira_em > now()
     and exists (select 1 from app.usuarios u where u.id = c.usuario_id and u.ativo)
  returning usuario_id into v_usuario;
  if v_usuario is null then raise exception 'Este link já foi usado ou expirou. Peça um novo.'; end if;
  if coalesce(length(p_senha_hash), 0) < 20 then raise exception 'Senha inválida.'; end if;
  update app.usuarios set senha_hash = p_senha_hash where id = v_usuario returning email into v_email;
  delete from app.sessoes where usuario_id = v_usuario;
  -- outros links pendentes da mesma pessoa deixam de valer
  update app.usuario_convites set usado_em = now() where usuario_id = v_usuario and usado_em is null;
  return v_email;
end $$;

grant execute on function app.convite_usuario(text), app.usar_convite_usuario(text, text) to vc_app;

-- ---------------------------------------------------------------------
-- Preços em lote. p_linhas: [{"codigo": "RHE-001", "tabela": "py_normal", "valor": 7000}, ...]
-- Só grava o que mudou; o preço novo vale a partir de hoje (o histórico fica).
-- ---------------------------------------------------------------------
create or replace function app.importar_precos(p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = app, pg_temp as $$
declare r jsonb; v_prod uuid; v_tab text; v_valor numeric; v_atual numeric; n int := 0; v_sem text[] := '{}';
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono altera preços.' using errcode = 'insufficient_privilege';
  end if;
  for r in select * from jsonb_array_elements(p_linhas) loop
    v_tab := r->>'tabela';
    if not exists (select 1 from app.tabelas_preco where codigo = v_tab) then raise exception 'Tabela de preço desconhecida: %', v_tab; end if;
    v_valor := nullif(r->>'valor','')::numeric;
    if v_valor is null then continue; end if;
    if v_valor <= 0 then raise exception 'Preço do produto % na tabela % precisa ser maior que zero.', r->>'codigo', v_tab; end if;
    select id into v_prod from app.produtos where codigo = trim(r->>'codigo');
    if v_prod is null then v_sem := v_sem || (r->>'codigo'); continue; end if;
    v_valor := case when (select moeda from app.tabelas_preco where codigo = v_tab) = 'GS' then app.arredondar_preco(v_valor, 'GS') else round(v_valor, 2) end;
    select valor into v_atual from app.precos where produto_id = v_prod and tabela = v_tab and vigente_desde <= current_date
     order by vigente_desde desc limit 1;
    if v_atual is distinct from v_valor then
      insert into app.precos (produto_id, tabela, valor, vigente_desde, definido_por)
      values (v_prod, v_tab, v_valor, current_date, app.uid())
      on conflict (produto_id, tabela, vigente_desde) do update set valor = excluded.valor, definido_por = excluded.definido_por;
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('alterados', n, 'codigos_desconhecidos', to_jsonb(v_sem));
end $$;
grant execute on function app.importar_precos(jsonb) to vc_app;
