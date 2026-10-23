-- =====================================================================
-- Migração 0100: acompanhamento do WhatsApp (conexão por QR Code)
--
-- Cada número de WhatsApp da equipe é uma "conexão": o gerente cria na tela
-- WhatsApp → Conexões e escaneia o QR Code com o celular do número. A pessoa
-- continua usando o WhatsApp normalmente (celular ou navegador); o sistema só
-- recebe uma cópia das mensagens (enviadas e recebidas) para acompanhar:
-- quantas mensagens, tempo de resposta, conversas sem resposta, quem é cliente
-- e quanto cada conversa movimentou em pedidos.
--
-- Grupos, status e canais são ignorados. Fotos e áudios ficam só como tipo
-- ("imagem", "áudio"), sem o arquivo.
-- =====================================================================

-- Últimos 8 dígitos do número: casa o WhatsApp com o cadastro do cliente mesmo
-- quando o número foi digitado com 0 na frente, sem DDI ou com o 9 extra do Brasil.
create or replace function app.zap8(p text) returns text
language sql immutable parallel safe as $$
  select case when length(d) >= 8 then right(d, 8) end
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;
grant execute on function app.zap8(text) to vc_app, vc_sync;
create index if not exists clientes_zap8_whatsapp on app.clientes (app.zap8(whatsapp));
create index if not exists clientes_zap8_telefone on app.clientes (app.zap8(telefone));

create table app.whatsapp_conexoes (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null check (length(trim(nome)) between 1 and 60),
  instancia           text not null unique check (instancia ~ '^[a-z0-9-]{3,40}$'),
  pais                app.pais not null default 'PY',
  vendedora_id        uuid references app.vendedoras(id),
  numero              text check (numero is null or numero ~ '^[0-9]{8,15}$'),
  estado              text not null default 'desconectado'
                      check (estado in ('desconectado','aguardando_qr','conectando','conectado')),
  qr                  text,
  qr_em               timestamptz,
  conectado_em        timestamptz,
  ultima_mensagem_em  timestamptz,
  ativo               boolean not null default true,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create trigger auditar after insert or update or delete on app.whatsapp_conexoes
  for each row execute function app.auditar('id');

create table app.whatsapp_contatos (
  conexao_id   uuid not null references app.whatsapp_conexoes(id),
  contato      text not null check (contato ~ '^(lid:)?[0-9]{5,25}$'),
  nome         text,
  primeira_em  timestamptz not null,
  ultima_em    timestamptz not null,
  primary key (conexao_id, contato)
);

create table app.whatsapp_mensagens (
  id          bigint generated always as identity primary key,
  conexao_id  uuid not null references app.whatsapp_conexoes(id),
  msg_id      text not null,
  contato     text not null,
  enviada     boolean not null,            -- true = saiu do número da empresa
  tipo        text not null,               -- texto, imagem, audio, video, documento, figurinha, localizacao, contato, outro
  texto       text,
  em          timestamptz not null,
  recebida_em timestamptz not null default now(),
  unique (conexao_id, msg_id)
);
create index on app.whatsapp_mensagens (conexao_id, contato, em);
create index on app.whatsapp_mensagens (em);

-- Quem vê: gestão vê tudo; a vendedora (se tiver a área liberada) vê só a conexão ligada a ela.
create or replace function app.ve_conexao_whatsapp(p_conexao uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select app.e_gestao() or exists (
    select 1 from app.whatsapp_conexoes w
     where w.id = p_conexao and app.perfil_atual() = 'vendedora'
       and w.vendedora_id is not null and w.vendedora_id = app.minha_vendedora())
$$;
grant execute on function app.ve_conexao_whatsapp(uuid) to vc_app;

alter table app.whatsapp_conexoes enable row level security;
create policy ler on app.whatsapp_conexoes for select using (app.ve_conexao_whatsapp(id));
create policy gerir on app.whatsapp_conexoes for all using (app.pode_gerir()) with check (app.pode_gerir());
alter table app.whatsapp_contatos enable row level security;
create policy ler on app.whatsapp_contatos for select using (app.ve_conexao_whatsapp(conexao_id));
alter table app.whatsapp_mensagens enable row level security;
create policy ler on app.whatsapp_mensagens for select using (app.ve_conexao_whatsapp(conexao_id));

grant select, insert, update on app.whatsapp_conexoes to vc_app;
grant select on app.whatsapp_contatos, app.whatsapp_mensagens to vc_app;

-- ---------------------------------------------------------------------
-- Escrita pela integração (webhook do servidor de WhatsApp). A aplicação
-- confere a chave secreta do webhook antes de chamar estas funções.
-- ---------------------------------------------------------------------

-- p_msgs: [{id, contato, nome, enviada, tipo, texto, em (epoch em segundos)}]
create or replace function app.whatsapp_registrar(p_instancia text, p_msgs jsonb) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_con uuid; v_n int; v_max timestamptz;
begin
  select id into v_con from app.whatsapp_conexoes where instancia = p_instancia;
  if v_con is null or jsonb_typeof(p_msgs) <> 'array' then return 0; end if;

  with m as (
    select m->>'contato' as contato, nullif(left(trim(m->>'nome'), 80), '') as nome,
           coalesce((m->>'enviada')::boolean, false) as enviada, to_timestamp((m->>'em')::double precision) as em
      from jsonb_array_elements(p_msgs) m
     where coalesce(m->>'id', '') <> '' and coalesce(m->>'contato', '') ~ '^(lid:)?[0-9]{5,25}$'
       and coalesce(m->>'em', '') ~ '^[0-9]+(\.[0-9]+)?$')
  insert into app.whatsapp_contatos (conexao_id, contato, nome, primeira_em, ultima_em)
  select v_con, contato, (array_agg(nome order by em desc) filter (where nome is not null and not enviada))[1], min(em), max(em)
    from m group by contato
  on conflict (conexao_id, contato) do update
     set nome = coalesce(excluded.nome, app.whatsapp_contatos.nome),
         primeira_em = least(app.whatsapp_contatos.primeira_em, excluded.primeira_em),
         ultima_em = greatest(app.whatsapp_contatos.ultima_em, excluded.ultima_em);

  insert into app.whatsapp_mensagens (conexao_id, msg_id, contato, enviada, tipo, texto, em)
  select distinct on (left(m->>'id', 120)) v_con, left(m->>'id', 120), m->>'contato', coalesce((m->>'enviada')::boolean, false),
         coalesce(nullif(left(m->>'tipo', 20), ''), 'outro'), left(m->>'texto', 4000), to_timestamp((m->>'em')::double precision)
    from jsonb_array_elements(p_msgs) m
   where coalesce(m->>'id', '') <> '' and coalesce(m->>'contato', '') ~ '^(lid:)?[0-9]{5,25}$'
     and coalesce(m->>'em', '') ~ '^[0-9]+(\.[0-9]+)?$'
  on conflict (conexao_id, msg_id) do nothing;
  get diagnostics v_n = row_count;

  select max(to_timestamp((m->>'em')::double precision)) into v_max
    from jsonb_array_elements(p_msgs) m where coalesce(m->>'em', '') ~ '^[0-9]+(\.[0-9]+)?$';
  if v_max is not null then
    update app.whatsapp_conexoes set ultima_mensagem_em = greatest(coalesce(ultima_mensagem_em, '-infinity'), v_max) where id = v_con;
  end if;
  return v_n;
end $$;
grant execute on function app.whatsapp_registrar(text, jsonb) to vc_app;

-- Estado da conexão (QR, conectando, conectado, desconectado). Número só é gravado quando informado.
create or replace function app.whatsapp_estado(p_instancia text, p_estado text, p_numero text default null, p_qr text default null) returns void
language sql security definer set search_path = app, pg_temp as $$
  update app.whatsapp_conexoes
     set estado = p_estado,
         numero = coalesce(case when regexp_replace(coalesce(p_numero, ''), '\D', '', 'g') ~ '^[0-9]{8,15}$'
                                then regexp_replace(p_numero, '\D', '', 'g') end, numero),
         qr = case when p_estado = 'aguardando_qr' then coalesce(p_qr, qr) end,
         qr_em = case when p_estado = 'aguardando_qr' and p_qr is not null then now() when p_estado = 'aguardando_qr' then qr_em end,
         conectado_em = case when p_estado = 'conectado' and estado <> 'conectado' then now() else conectado_em end,
         atualizado_em = now()
   where instancia = p_instancia
     and p_estado in ('desconectado','aguardando_qr','conectando','conectado')
$$;
grant execute on function app.whatsapp_estado(text, text, text, text) to vc_app;
