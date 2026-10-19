-- Acessos da equipe: horário permitido por dia da semana e permissões por pessoa (ligar/desligar áreas do sistema).
-- Horário: sem nenhum horário cadastrado = acesso livre. Com horários, só entra nos dias/horas marcados
-- (fora disso a sessão não vale e o banco recusa qualquer operação). O dono nunca é limitado por horário.

alter table app.usuarios add column permissoes jsonb not null default '{}'::jsonb;   -- {"caixa": false, "clientes": true, ...}

create table app.usuario_horarios (
  usuario_id uuid not null references app.usuarios(id) on delete cascade,
  dia        smallint not null check (dia between 0 and 6),     -- 0 = domingo
  inicio     time not null,
  fim        time not null,
  primary key (usuario_id, dia),
  check (fim > inicio)
);
alter table app.usuario_horarios enable row level security;
create policy ler on app.usuario_horarios for select using (usuario_id = app.uid() or app.pode_gerir());
grant select on app.usuario_horarios to vc_app;
create trigger auditar after insert or update or delete on app.usuario_horarios for each row execute function app.auditar('usuario_id');

create or replace function app.dentro_do_horario(p_usuario uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce((
    select u.perfil = 'dono'
        or not exists (select 1 from app.usuario_horarios h where h.usuario_id = u.id)
        or exists (select 1 from app.usuario_horarios h
                    where h.usuario_id = u.id
                      and h.dia = extract(dow from now() at time zone 'America/Sao_Paulo')::int
                      and (now() at time zone 'America/Sao_Paulo')::time between h.inicio and h.fim)
      from app.usuarios u where u.id = p_usuario), false)
$$;

-- Perfil de quem está operando: fora do horário permitido, ninguém (o banco recusa tudo)
create or replace function app.perfil_atual() returns app.perfil
language sql stable security definer set search_path = app, pg_temp as $$
  select perfil from app.usuarios where id = app.uid() and ativo and app.dentro_do_horario(id)
$$;

drop function app.sessao_valida(text);
create function app.sessao_valida(p_token_hash text)
returns table (usuario_id uuid, nome text, perfil app.perfil, vendedora_id uuid, permissoes jsonb)
language sql stable security definer set search_path = app, pg_temp as $$
  select u.id, u.nome, u.perfil, u.vendedora_id, u.permissoes
    from app.sessoes s join app.usuarios u on u.id = s.usuario_id
   where s.token_hash = p_token_hash and s.expira_em > now() and u.ativo and app.dentro_do_horario(u.id)
$$;
grant execute on function app.sessao_valida(text), app.dentro_do_horario(uuid) to vc_app;

-- Estoquista vê os pedidos (para separar); vendedora continua vendo só os dela
create or replace function app.ve_pedido(p_vendedora uuid) returns boolean
language sql stable as $$
  select app.e_gestao() or app.perfil_atual() = 'estoquista'
      or (app.perfil_atual() = 'vendedora' and p_vendedora = app.minha_vendedora())
$$;

-- Acessos de cada pessoa (tela Equipe)
create or replace function app.acessos_equipe()
returns table (usuario_id uuid, permissoes jsonb, horarios jsonb, depositos uuid[])
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono vê os acessos da equipe.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select u.id, u.permissoes,
           coalesce((select jsonb_agg(jsonb_build_object('dia', h.dia, 'inicio', to_char(h.inicio, 'HH24:MI'), 'fim', to_char(h.fim, 'HH24:MI')) order by h.dia)
                       from app.usuario_horarios h where h.usuario_id = u.id), '[]'::jsonb),
           coalesce((select array_agg(r.deposito_id) from app.deposito_responsaveis r where r.usuario_id = u.id), '{}')
      from app.usuarios u where u.email <> 'sistema@importacao.local';
end $$;

-- Salva permissões, horários e unidades em que a pessoa mexe no estoque/caixa.
-- p_permissoes: {"chave": true/false} só com o que difere do padrão do perfil
-- p_horarios: [{"dia":1,"inicio":"08:00","fim":"18:00"}, ...] (vazio = sem limite de horário)
create or replace function app.definir_acesso_usuario(p_usuario uuid, p_permissoes jsonb, p_horarios jsonb, p_depositos uuid[])
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare r jsonb; k text; v jsonb;
begin
  perform app._pode_gerir(p_usuario, null);
  if p_usuario = app.uid() then raise exception 'Você não pode mudar os seus próprios acessos (peça a outro gerente ou ao dono).'; end if;
  if (select perfil from app.usuarios where id = p_usuario) = 'dono' then raise exception 'O dono tem acesso a tudo, sem limite de horário.'; end if;
  if jsonb_typeof(coalesce(p_permissoes, '{}')) <> 'object' then raise exception 'Permissões inválidas.'; end if;
  for k, v in select * from jsonb_each(coalesce(p_permissoes, '{}')) loop
    if k !~ '^[a-z_]{2,40}$' or jsonb_typeof(v) <> 'boolean' then raise exception 'Permissão inválida: %', k; end if;
  end loop;
  update app.usuarios set permissoes = coalesce(p_permissoes, '{}') where id = p_usuario;

  delete from app.usuario_horarios where usuario_id = p_usuario;
  for r in select * from jsonb_array_elements(coalesce(p_horarios, '[]')) loop
    insert into app.usuario_horarios (usuario_id, dia, inicio, fim)
    values (p_usuario, (r->>'dia')::smallint, (r->>'inicio')::time, (r->>'fim')::time);
  end loop;

  delete from app.deposito_responsaveis where usuario_id = p_usuario and not (deposito_id = any(coalesce(p_depositos, '{}')));
  insert into app.deposito_responsaveis (deposito_id, usuario_id)
  select d, p_usuario from unnest(coalesce(p_depositos, '{}')) d
  where not exists (select 1 from app.deposito_responsaveis x where x.deposito_id = d and x.usuario_id = p_usuario);

  -- quem perdeu horário agora sai na próxima ação (a sessão é conferida a cada página)
end $$;

grant execute on function app.acessos_equipe(), app.definir_acesso_usuario(uuid, jsonb, jsonb, uuid[]) to vc_app;

-- Estoque e caixa: fora do horário (ou desativado) ninguém opera, nem quem é responsável pela unidade
create or replace function app.pode_operar_deposito(p_deposito uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select app.perfil_atual() is not null and (
         app.perfil_atual() in ('gerente','dono')
      or exists (select 1 from app.deposito_responsaveis where deposito_id = p_deposito and usuario_id = app.uid()))
$$;
create or replace function app.pode_caixa(p_deposito uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select app.uid() is not null and app.perfil_atual() is not null and (
         app.perfil_atual() in ('gerente','dono')
      or exists (select 1 from app.deposito_responsaveis where deposito_id = p_deposito and usuario_id = app.uid())
      or exists (select 1 from app.vendedora_depositos vd join app.usuarios u on u.vendedora_id = vd.vendedora_id
                  where u.id = app.uid() and vd.deposito_id = p_deposito))
$$;
