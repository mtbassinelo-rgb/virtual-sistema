-- Minha conta (cada pessoa troca a própria senha) e Equipe (dono/gerente cadastram pessoas e geram
-- links de nova senha pelo próprio sistema, sem precisar do servidor). Ninguém vê a senha de ninguém:
-- a aplicação só manda o hash (argon2) ou o hash do token do link.

-- Troca da própria senha. A aplicação confere a senha atual antes de chamar.
-- As outras sessões da pessoa são encerradas; a sessão atual continua.
create or replace function app.trocar_minha_senha(p_senha_hash text, p_sessao_atual text) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if app.uid() is null then raise exception 'Entre no sistema para trocar a senha.'; end if;
  if coalesce(length(p_senha_hash), 0) < 20 then raise exception 'Senha inválida.'; end if;
  update app.usuarios set senha_hash = p_senha_hash where id = app.uid() and ativo;
  if not found then raise exception 'Usuário inativo.'; end if;
  delete from app.sessoes where usuario_id = app.uid() and token_hash <> coalesce(p_sessao_atual, '');
  update app.usuario_convites set usado_em = now() where usuario_id = app.uid() and usado_em is null;
end $$;

-- Lista da equipe (sem senha, só se já criou).
create or replace function app.equipe()
returns table (id uuid, nome text, email text, perfil app.perfil, ativo boolean, tem_senha boolean, vendedora text,
               link_pendente timestamptz, ultimo_acesso timestamptz)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono vê a equipe.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select u.id, u.nome, u.email, u.perfil, u.ativo, u.senha_hash is not null, v.nome,
           (select max(c.expira_em) from app.usuario_convites c where c.usuario_id = u.id and c.usado_em is null and c.expira_em > now()),
           (select max(s.criada_em) from app.sessoes s where s.usuario_id = u.id)
      from app.usuarios u left join app.vendedoras v on v.id = u.vendedora_id
     where u.email <> 'sistema@importacao.local'
     order by u.ativo desc, u.perfil, u.nome;
end $$;

-- Gerente não mexe em dono; ninguém se rebaixa/desativa sozinho.
create or replace function app._pode_gerir(p_alvo uuid, p_perfil_novo app.perfil) returns void
language plpgsql stable security definer set search_path = app, pg_temp as $$
declare v_eu app.perfil := app.perfil_atual(); v_alvo app.perfil;
begin
  if v_eu not in ('gerente','dono') then
    raise exception 'Só gerente ou dono cuida da equipe.' using errcode = 'insufficient_privilege';
  end if;
  select perfil into v_alvo from app.usuarios where id = p_alvo;
  if v_eu = 'gerente' and (v_alvo = 'dono' or p_perfil_novo = 'dono') then
    raise exception 'Só o dono cadastra ou altera outro dono.' using errcode = 'insufficient_privilege';
  end if;
end $$;

-- Cadastra (ou atualiza) uma pessoa e registra um link de primeiro acesso / nova senha.
-- p_token_hash: sha256 do token que a aplicação mostra uma única vez.
create or replace function app.convidar_pessoa(p_email text, p_nome text, p_perfil app.perfil, p_vendedora uuid,
                                               p_token_hash text, p_horas int) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_email text := lower(trim(coalesce(p_email,''))); v_id uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.'; end if;
  if length(trim(coalesce(p_nome,''))) < 2 then raise exception 'Informe o nome.'; end if;
  if p_perfil = 'vendedora' and p_vendedora is null then raise exception 'Escolha qual vendedora é esta pessoa.'; end if;
  if v_email = 'sistema@importacao.local' then raise exception 'E-mail reservado.'; end if;
  select id into v_id from app.usuarios where email = v_email;
  perform app._pode_gerir(v_id, p_perfil);
  if v_id = app.uid() and p_perfil is distinct from app.perfil_atual() then raise exception 'Você não pode mudar o seu próprio perfil.'; end if;
  insert into app.usuarios (email, nome, perfil, vendedora_id, ativo)
  values (v_email, left(trim(p_nome), 120), p_perfil, case when p_perfil = 'vendedora' then p_vendedora end, true)
  on conflict (email) do update set nome = excluded.nome, perfil = excluded.perfil, vendedora_id = excluded.vendedora_id, ativo = true
  returning id into v_id;
  perform app.gerar_link_senha(v_id, p_token_hash, p_horas);
  return v_id;
end $$;

create or replace function app.gerar_link_senha(p_usuario uuid, p_token_hash text, p_horas int) returns text
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_email text;
begin
  perform app._pode_gerir(p_usuario, null);
  if coalesce(length(p_token_hash), 0) <> 64 then raise exception 'Link inválido.'; end if;
  select email into v_email from app.usuarios where id = p_usuario and ativo;
  if v_email is null then raise exception 'Pessoa não encontrada ou inativa.'; end if;
  -- vale só o link mais recente
  update app.usuario_convites set usado_em = now() where usuario_id = p_usuario and usado_em is null;
  insert into app.usuario_convites (token_hash, usuario_id, expira_em)
  values (p_token_hash, p_usuario, now() + make_interval(hours => least(greatest(coalesce(p_horas, 48), 1), 168)));
  return v_email;
end $$;

create or replace function app.ativar_pessoa(p_usuario uuid, p_ativo boolean) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  perform app._pode_gerir(p_usuario, null);
  if p_usuario = app.uid() then raise exception 'Você não pode desativar o seu próprio acesso.'; end if;
  update app.usuarios set ativo = coalesce(p_ativo, false) where id = p_usuario and email <> 'sistema@importacao.local';
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  if not coalesce(p_ativo, false) then
    delete from app.sessoes where usuario_id = p_usuario;
    update app.usuario_convites set usado_em = now() where usuario_id = p_usuario and usado_em is null;
  end if;
end $$;

grant execute on function app.trocar_minha_senha(text, text), app.equipe(),
  app.convidar_pessoa(text, text, app.perfil, uuid, text, int), app.gerar_link_senha(uuid, text, int),
  app.ativar_pessoa(uuid, boolean) to vc_app;
revoke execute on function app._pode_gerir(uuid, app.perfil) from public;
