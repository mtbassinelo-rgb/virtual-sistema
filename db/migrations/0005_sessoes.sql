-- =====================================================================
-- Migração 0005: login e sessões
-- A aplicação nunca lê a tabela de usuários diretamente para o login:
-- usa funções que devolvem só o necessário.
-- =====================================================================

create table app.sessoes (
  token_hash   text primary key,          -- sha256 do token do cookie (o token em si não é guardado)
  usuario_id   uuid not null references app.usuarios(id),
  criada_em    timestamptz not null default now(),
  expira_em    timestamptz not null,
  ip           text,
  agente       text
);
create index on app.sessoes (usuario_id);
alter table app.sessoes enable row level security;   -- sem políticas: acesso só pelas funções

create table app.tentativas_login (
  email  text not null,
  em     timestamptz not null default now(),
  ok     boolean not null
);
create index on app.tentativas_login (email, em);
alter table app.tentativas_login enable row level security;

-- Dados para conferir a senha (a comparação é feita na aplicação com argon2)
create or replace function app.dados_login(p_email text)
returns table (id uuid, senha_hash text, bloqueado boolean)
language sql stable security definer set search_path = app, pg_temp as $$
  select u.id, u.senha_hash,
         (select count(*) from app.tentativas_login t
           where t.email = lower(p_email) and not t.ok and t.em > now() - interval '15 minutes') >= 5
    from app.usuarios u
   where u.email = lower(p_email) and u.ativo
$$;

create or replace function app.registrar_tentativa(p_email text, p_ok boolean)
returns void language sql security definer set search_path = app, pg_temp as $$
  insert into app.tentativas_login (email, ok) values (lower(p_email), p_ok)
$$;

create or replace function app.criar_sessao(p_usuario uuid, p_token_hash text, p_dias int, p_ip text, p_agente text)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not exists (select 1 from app.usuarios where id = p_usuario and ativo) then
    raise exception 'Usuário inativo.';
  end if;
  delete from app.sessoes where expira_em < now();
  insert into app.sessoes (token_hash, usuario_id, expira_em, ip, agente)
  values (p_token_hash, p_usuario, now() + make_interval(days => p_dias), p_ip, left(p_agente, 300));
end $$;

create or replace function app.sessao_valida(p_token_hash text)
returns table (usuario_id uuid, nome text, perfil app.perfil, vendedora_id uuid)
language sql stable security definer set search_path = app, pg_temp as $$
  select u.id, u.nome, u.perfil, u.vendedora_id
    from app.sessoes s join app.usuarios u on u.id = s.usuario_id
   where s.token_hash = p_token_hash and s.expira_em > now() and u.ativo
$$;

create or replace function app.encerrar_sessao(p_token_hash text)
returns void language sql security definer set search_path = app, pg_temp as $$
  delete from app.sessoes where token_hash = p_token_hash
$$;

-- Troca de senha: o próprio usuário, ou o dono para qualquer usuário
create or replace function app.definir_senha(p_usuario uuid, p_senha_hash text)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if app.uid() is distinct from p_usuario and app.perfil_atual() is distinct from 'dono' then
    raise exception 'Sem permissão para trocar esta senha.' using errcode = 'insufficient_privilege';
  end if;
  update app.usuarios set senha_hash = p_senha_hash where id = p_usuario;
  delete from app.sessoes where usuario_id = p_usuario;   -- derruba sessões antigas
end $$;

-- A senha nunca aparece na auditoria
create or replace function app.auditar() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_antes jsonb; v_depois jsonb; v_id text; k text;
begin
  if tg_op = 'INSERT' then
    v_depois := to_jsonb(new) - 'senha_hash'; v_id := to_jsonb(new)->>(tg_argv[0]);
  elsif tg_op = 'DELETE' then
    v_antes := to_jsonb(old) - 'senha_hash'; v_id := to_jsonb(old)->>(tg_argv[0]);
  else
    v_antes := '{}'; v_depois := '{}';
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if (to_jsonb(new)->k) is distinct from (to_jsonb(old)->k) and k not in ('atualizado_em') then
        if k = 'senha_hash' then
          v_antes := v_antes || jsonb_build_object(k, '(oculto)');
          v_depois := v_depois || jsonb_build_object(k, '(senha alterada)');
        else
          v_antes := v_antes || jsonb_build_object(k, to_jsonb(old)->k);
          v_depois := v_depois || jsonb_build_object(k, to_jsonb(new)->k);
        end if;
      end if;
    end loop;
    if v_depois = '{}' then return new; end if;
    v_id := to_jsonb(new)->>(tg_argv[0]);
  end if;
  insert into app.auditoria (usuario_id, executor, tabela, registro_id, acao, antes, depois, motivo)
  values (app.uid(), coalesce(nullif(current_setting('role', true), 'none'), session_user), tg_table_name, v_id, tg_op,
          v_antes, v_depois, nullif(current_setting('app.motivo', true), ''));
  return coalesce(new, old);
end $$;

-- A aplicação não lê o hash de senha de ninguém
revoke select on app.usuarios from vc_app;
grant select (id, nome, email, perfil, vendedora_id, ativo, criado_em) on app.usuarios to vc_app;

grant execute on function app.dados_login(text), app.registrar_tentativa(text, boolean),
  app.criar_sessao(uuid, text, int, text, text), app.sessao_valida(text), app.encerrar_sessao(text),
  app.definir_senha(uuid, text) to vc_app;
