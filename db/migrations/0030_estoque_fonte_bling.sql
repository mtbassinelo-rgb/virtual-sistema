-- =====================================================================
-- Migração 0030: Bling como fonte oficial do estoque (fase de transição)
--
-- * Cada depósito escolhe a fonte do estoque: 'sistema' (extrato próprio) ou
--   'bling' (espelho dos saldos lidos do Bling). Padrão: 'sistema', ou seja,
--   esta migração NÃO muda nada até alguém ligar a fonte Bling num depósito.
-- * Espelho do Bling: saldo físico e virtual por depósito e produto, com a hora
--   da leitura. Falha, resposta incompleta ou produto ausente NUNCA viram zero:
--   o saldo anterior fica e envelhece. Leitura que zera muitos produtos de uma
--   vez vai para quarentena.
-- * Reservas: o Bling não reserva estoque para pedido; o sistema reserva os
--   pedidos em aberto (inclusive os digitados no Bling) até o estoque ser
--   lançado no Bling (situação "atendido") ou o pedido ser cancelado.
-- * Disponibilidade = saldo da fonte − reservas. Dado velho ou integração com
--   falha não confirma disponibilidade (vale 0 para venda; a vendedora confirma).
-- * Eventos de webhook com chave única (eventId): repetidos não duplicam.
-- * Divergências Bling × sistema ficam registradas até alguém resolver.
-- * Kits não têm saldo próprio: o saldo de um SKU de kit no Bling é ignorado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Depósitos: vínculo com o Bling e fonte do estoque
-- ---------------------------------------------------------------------
alter table app.depositos
  add column bling_deposito_id bigint unique,
  add column fonte_estoque text not null default 'sistema' check (fonte_estoque in ('sistema','bling'));
alter table app.depositos add constraint fonte_bling_tem_vinculo
  check (fonte_estoque = 'sistema' or bling_deposito_id is not null);

insert into app.parametros values
  ('bling_saldo_validade_min', 60, 'Saldo do Bling lido há mais de N minutos não confirma disponibilidade'),
  ('bling_falhas_alerta',       3, 'Falhas seguidas da sincronização que colocam a integração em alerta'),
  ('bling_quarentena_pct',     30, 'Leitura que zera mais de N% dos produtos com saldo vai para quarentena'),
  ('bling_quarentena_minimo',   5, 'A quarentena só vale a partir de N produtos zerados na mesma leitura'),
  ('reserva_estoque_proprio',   0, '1 = reservas também descontam nos depósitos com estoque próprio (fase C)')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- Saúde da integração e execuções
-- ---------------------------------------------------------------------
alter table app.sincronizacoes add column tipo text;   -- saldos, produtos, pedidos, eventos, depositos

create table app.integracao_saude (
  fonte            text primary key references app.integracoes(codigo),
  ultima_ok        timestamptz,
  ultima_tentativa timestamptz,
  falhas_seguidas  int not null default 0,
  ultimo_erro      text,
  ultimo_erro_em   timestamptz
);
insert into app.integracao_saude (fonte) values ('bling');

-- A chamada vem da rotina de sincronização? (papel vc_sync, por login ou "set role")
create or replace function app._e_sync() returns boolean
language sql stable as $$ select session_user = 'vc_sync' or current_setting('role', true) = 'vc_sync' $$;

create or replace function app.integracao_em_alerta(p_fonte text) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce((select s.ultima_ok is null
                       or s.falhas_seguidas >= app.param('bling_falhas_alerta')
                       or s.ultima_ok < now() - make_interval(mins => app.param('bling_saldo_validade_min')::int)
                     from app.integracao_saude s where s.fonte = p_fonte), true)
$$;

create or replace function app.sinc_iniciar(p_fonte text, p_tipo text) returns bigint
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id bigint;
begin
  insert into app.sincronizacoes (fonte, tipo) values (p_fonte, p_tipo) returning id into v_id;
  update app.integracao_saude set ultima_tentativa = now() where fonte = p_fonte;
  return v_id;
end $$;

-- Encerra uma execução. Erro: conta falha seguida (mensagem sem tokens, a aplicação já limpa).
create or replace function app.sinc_finalizar(p_id bigint, p_ok boolean, p_lidos int default 0, p_criados int default 0,
                                              p_atualizados int default 0, p_erro text default null)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare v_fonte text;
begin
  update app.sincronizacoes set fim = now(), status = case when p_ok then 'ok' else 'erro' end,
         lidos = p_lidos, criados = p_criados, atualizados = p_atualizados,
         erros = case when p_erro is null then erros else erros || jsonb_build_array(left(p_erro, 1000)) end
   where id = p_id and fim is null
  returning fonte into v_fonte;
  if v_fonte is null then raise exception 'Execução % não existe ou já foi encerrada.', p_id; end if;
  if p_ok then
    update app.integracao_saude set ultima_ok = now(), falhas_seguidas = 0 where fonte = v_fonte;
  else
    update app.integracao_saude set falhas_seguidas = falhas_seguidas + 1, ultimo_erro = left(p_erro, 1000), ultimo_erro_em = now()
     where fonte = v_fonte;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Credenciais do Bling (tokens cifrados pela aplicação; só a sincronização lê)
-- ---------------------------------------------------------------------
create table app.bling_credenciais (
  id                    int primary key default 1 check (id = 1),
  access_token_cifrado  text not null,
  refresh_token_cifrado text not null,
  access_expira_em      timestamptz not null,
  refresh_expira_em     timestamptz,
  conectado_por         uuid references app.usuarios(id),
  conectado_em          timestamptz not null default now(),
  renovado_em           timestamptz
);

-- Gravar tokens: o dono (ao conectar a conta) ou a sincronização (ao renovar)
create or replace function app.bling_salvar_tokens(p_access text, p_refresh text, p_access_expira timestamptz,
                                                   p_refresh_expira timestamptz default null)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app._e_sync() and app.perfil_atual() is distinct from 'dono' then
    raise exception 'Só o dono conecta a conta do Bling.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_access,'') = '' or coalesce(p_refresh,'') = '' then raise exception 'Tokens vazios.'; end if;
  insert into app.bling_credenciais as c (id, access_token_cifrado, refresh_token_cifrado, access_expira_em, refresh_expira_em, conectado_por)
  values (1, p_access, p_refresh, p_access_expira, p_refresh_expira, app.uid())
  on conflict (id) do update set access_token_cifrado = excluded.access_token_cifrado,
    refresh_token_cifrado = excluded.refresh_token_cifrado, access_expira_em = excluded.access_expira_em,
    refresh_expira_em = coalesce(excluded.refresh_expira_em, c.refresh_expira_em),
    renovado_em = now(),
    conectado_por = coalesce(excluded.conectado_por, c.conectado_por);
end $$;

-- Situação da conexão para a tela (sem tokens)
create or replace function app.bling_conexao() returns table (conectado boolean, access_expira_em timestamptz,
  refresh_expira_em timestamptz, conectado_em timestamptz, renovado_em timestamptz)
language sql stable security definer set search_path = app, pg_temp as $$
  select true, access_expira_em, refresh_expira_em, conectado_em, renovado_em from app.bling_credenciais where app.pode_gerir()
$$;

-- ---------------------------------------------------------------------
-- Eventos de webhook (fila idempotente)
-- ---------------------------------------------------------------------
create table app.bling_eventos (
  event_id          text primary key,
  evento            text not null,                 -- ex.: stock.updated
  recurso           text not null,
  acao              text not null,
  recurso_id        bigint,
  ocorrido_em       timestamptz,
  dados             jsonb not null,
  recebido_em       timestamptz not null default now(),
  recebimentos      int not null default 1,         -- quantas vezes o Bling enviou o mesmo evento
  status            text not null default 'pendente'
                    check (status in ('pendente','processando','processado','erro','descartado')),
  tentativas        int not null default 0,
  proxima_tentativa timestamptz not null default now(),
  ultimo_erro       text,
  processado_em     timestamptz
);
create index on app.bling_eventos (status, proxima_tentativa);

-- Grava o evento recebido. Devolve 'novo' ou 'duplicado' (o mesmo eventId já chegou).
create or replace function app.bling_receber_evento(p jsonb) returns text
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_novo boolean; v_evento text := p->>'event';
begin
  if coalesce(p->>'eventId','') = '' then raise exception 'Evento sem eventId.'; end if;
  if coalesce(v_evento,'') !~ '^[a-z_]+\.[a-z_]+$' then raise exception 'Evento inválido: %', v_evento; end if;
  insert into app.bling_eventos as e (event_id, evento, recurso, acao, recurso_id, ocorrido_em, dados)
  values (p->>'eventId', v_evento, split_part(v_evento, '.', 1), split_part(v_evento, '.', 2),
          case when (p->'data'->>'id') ~ '^\d+$' then (p->'data'->>'id')::bigint
               when (p->'data'->'produto'->>'id') ~ '^\d+$' then (p->'data'->'produto'->>'id')::bigint end,
          case when p->>'date' is not null then (p->>'date')::timestamptz end,
          p)
  on conflict (event_id) do update set recebimentos = e.recebimentos + 1
  returning (xmax = 0) into v_novo;
  return case when v_novo then 'novo' else 'duplicado' end;
end $$;

-- Pega até N eventos para processar (vários processos não pegam o mesmo).
-- Evento "processando" há mais de 10 minutos (processo caiu) volta para a fila.
create or replace function app.bling_pegar_eventos(p_limite int default 20) returns setof app.bling_eventos
language sql security definer set search_path = app, pg_temp as $$
  update app.bling_eventos e set status = 'processando', tentativas = e.tentativas + 1,
         proxima_tentativa = now() + interval '10 minutes'
   where e.event_id in (select event_id from app.bling_eventos
                         where (status in ('pendente','erro') or status = 'processando')
                           and proxima_tentativa <= now()
                         order by ocorrido_em nulls last, recebido_em
                         limit p_limite for update skip locked)
  returning e.*
$$;

-- Conclui um evento. Com erro: tenta de novo com espera crescente; após 15 tentativas, descarta e alerta.
create or replace function app.bling_concluir_evento(p_event_id text, p_erro text default null) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if p_erro is null then
    update app.bling_eventos set status = 'processado', processado_em = now(), ultimo_erro = null where event_id = p_event_id;
  else
    update app.bling_eventos set
      status = case when tentativas >= 15 then 'descartado' else 'erro' end,
      ultimo_erro = left(p_erro, 1000),
      proxima_tentativa = now() + make_interval(mins => least(power(2, least(tentativas, 9))::int, 360))
     where event_id = p_event_id;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Espelho dos saldos do Bling
-- ---------------------------------------------------------------------
create table app.bling_estoque_saldos (
  deposito_id      uuid not null references app.depositos(id),
  produto_id       uuid not null references app.produtos(id),
  bling_produto_id bigint not null,
  saldo_fisico     numeric(12,3) not null,     -- pode vir negativo do Bling: vira divergência, nunca disponibilidade
  saldo_virtual    numeric(12,3) not null,
  lido_em          timestamptz not null,
  mudou_em         timestamptz not null,
  sincronizacao_id bigint references app.sincronizacoes(id),
  primary key (deposito_id, produto_id)
);

-- Histórico de cada mudança de saldo vista no Bling
create table app.bling_estoque_historico (
  id               bigserial primary key,
  deposito_id      uuid not null references app.depositos(id),
  produto_id       uuid not null references app.produtos(id),
  fisico_antes     numeric(12,3),
  fisico_depois    numeric(12,3) not null,
  virtual_antes    numeric(12,3),
  virtual_depois   numeric(12,3) not null,
  em               timestamptz not null default now(),
  sincronizacao_id bigint references app.sincronizacoes(id)
);
create index on app.bling_estoque_historico (deposito_id, produto_id, em);

-- ---------------------------------------------------------------------
-- Divergências Bling × sistema
-- ---------------------------------------------------------------------
create table app.estoque_divergencias (
  id               bigserial primary key,
  tipo             text not null check (tipo in ('saldo_diferente','negativo_no_bling','produto_sem_vinculo',
                                                 'quarentena','fisico_virtual_diferente','reserva_sem_bling')),
  deposito_id      uuid references app.depositos(id),
  produto_id       uuid references app.produtos(id),
  codigo           text,
  bling_produto_id bigint,
  saldo_bling      numeric(12,3),
  saldo_sistema    numeric(12,3),
  reservado        numeric(12,3),
  detalhe          jsonb,
  aberta_em        timestamptz not null default now(),
  atualizada_em    timestamptz not null default now(),
  status           text not null default 'aberta' check (status in ('aberta','resolvida','ignorada')),
  resolvida_em     timestamptz,
  resolvida_por    uuid references app.usuarios(id),
  resolucao        text
);
-- Uma única divergência aberta por tipo + depósito + produto/código
create unique index divergencia_aberta on app.estoque_divergencias (tipo, deposito_id, produto_id, codigo)
  nulls not distinct where status = 'aberta';

create or replace function app._divergencia(p_tipo text, p_dep uuid, p_prod uuid, p_codigo text, p_bling_id bigint,
                                            p_saldo_bling numeric, p_saldo_sistema numeric, p_reservado numeric, p_detalhe jsonb)
returns void language sql security definer set search_path = app, pg_temp as $$
  insert into app.estoque_divergencias as d (tipo, deposito_id, produto_id, codigo, bling_produto_id, saldo_bling,
                                             saldo_sistema, reservado, detalhe)
  values (p_tipo, p_dep, p_prod, p_codigo, p_bling_id, p_saldo_bling, p_saldo_sistema, p_reservado, p_detalhe)
  on conflict (tipo, deposito_id, produto_id, codigo) where status = 'aberta' do update set
    saldo_bling = excluded.saldo_bling, saldo_sistema = excluded.saldo_sistema, reservado = excluded.reservado,
    bling_produto_id = coalesce(excluded.bling_produto_id, d.bling_produto_id),
    detalhe = excluded.detalhe, atualizada_em = now()
$$;

-- Fecha automaticamente uma divergência que deixou de existir
create or replace function app._fechar_divergencia(p_tipo text, p_dep uuid, p_prod uuid, p_resolucao text)
returns void language sql security definer set search_path = app, pg_temp as $$
  update app.estoque_divergencias set status = 'resolvida', resolvida_em = now(), resolucao = p_resolucao
   where tipo = p_tipo and deposito_id is not distinct from p_dep and produto_id is not distinct from p_prod and status = 'aberta'
$$;

-- ---------------------------------------------------------------------
-- Registrar uma leitura de saldos do Bling (rotina de sincronização)
-- p_itens: [{"bling_produto_id": 123, "codigo": "SOU-SH", "saldo_fisico": 10, "saldo_virtual": 10}, ...]
-- Regras: item malformado rejeita a leitura inteira; produto ausente da leitura
-- não muda; leitura que zera muitos produtos de uma vez vai para quarentena.
-- ---------------------------------------------------------------------
create or replace function app.bling_registrar_saldos(p_deposito uuid, p_itens jsonb, p_sincronizacao bigint default null)
returns jsonb language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_dep app.depositos; it jsonb; v_prod app.produtos; v_ant app.bling_estoque_saldos;
  v_bid bigint; v_fis numeric; v_vir numeric; v_cod text;
  n_zerados int := 0; n_positivos int; n_lidos int := 0; n_mudaram int := 0; n_sem_vinculo int := 0; n_kits int := 0;
begin
  select * into v_dep from app.depositos where id = p_deposito;
  if v_dep.id is null then raise exception 'Depósito não existe.'; end if;
  if v_dep.bling_deposito_id is null then raise exception 'Depósito % sem vínculo com o Bling.', v_dep.nome; end if;
  if jsonb_typeof(p_itens) is distinct from 'array' then raise exception 'Leitura de saldos inválida.'; end if;

  -- 1) validação completa antes de gravar qualquer coisa
  for it in select * from jsonb_array_elements(p_itens) loop
    if coalesce(it->>'bling_produto_id','') !~ '^\d+$'
       or jsonb_typeof(it->'saldo_fisico') is distinct from 'number'
       or jsonb_typeof(it->'saldo_virtual') is distinct from 'number' then
      raise exception 'Item de saldo incompleto: %. Leitura descartada; o saldo anterior foi mantido.', left(it::text, 200);
    end if;
  end loop;

  -- 2) proteção contra leitura que zera muitos produtos de uma vez
  select count(*) into n_positivos from app.bling_estoque_saldos where deposito_id = p_deposito and saldo_fisico > 0;
  select count(*) into n_zerados
    from jsonb_array_elements(p_itens) i
    join app.bling_estoque_saldos s on s.deposito_id = p_deposito and s.bling_produto_id = (i->>'bling_produto_id')::bigint
   where s.saldo_fisico > 0 and (i->>'saldo_fisico')::numeric <= 0;
  if n_zerados >= app.param('bling_quarentena_minimo')
     and n_zerados * 100 > app.param('bling_quarentena_pct') * greatest(n_positivos, 1) then
    perform app._divergencia('quarentena', p_deposito, null, null, null, null, null, null,
      jsonb_build_object('zerados', n_zerados, 'com_saldo_antes', n_positivos, 'sincronizacao', p_sincronizacao,
                         'itens', jsonb_array_length(p_itens)));
    return jsonb_build_object('quarentena', true, 'zerados', n_zerados, 'com_saldo_antes', n_positivos);
  end if;

  -- 3) gravação
  for it in select * from jsonb_array_elements(p_itens) loop
    v_bid := (it->>'bling_produto_id')::bigint;
    v_fis := (it->>'saldo_fisico')::numeric;
    v_vir := (it->>'saldo_virtual')::numeric;
    v_cod := nullif(trim(it->>'codigo'), '');
    n_lidos := n_lidos + 1;
    select * into v_prod from app.produtos where bling_produto_id = v_bid;
    if v_prod.id is null and v_cod is not null then
      select * into v_prod from app.produtos where id = app.produto_por_codigo(v_cod);
    end if;
    if v_prod.id is null then
      n_sem_vinculo := n_sem_vinculo + 1;
      perform app._divergencia('produto_sem_vinculo', p_deposito, null, coalesce(v_cod, 'BLING-' || v_bid), v_bid,
                               v_fis, null, null, jsonb_build_object('saldo_virtual', v_vir));
      continue;
    end if;
    if v_prod.tipo = 'kit' then n_kits := n_kits + 1; continue; end if;   -- kit: saldo vem dos componentes

    select * into v_ant from app.bling_estoque_saldos where deposito_id = p_deposito and produto_id = v_prod.id;
    if v_ant.produto_id is null or v_ant.saldo_fisico <> v_fis or v_ant.saldo_virtual <> v_vir then
      insert into app.bling_estoque_historico (deposito_id, produto_id, fisico_antes, fisico_depois, virtual_antes, virtual_depois, sincronizacao_id)
      values (p_deposito, v_prod.id, v_ant.saldo_fisico, v_fis, v_ant.saldo_virtual, v_vir, p_sincronizacao);
      n_mudaram := n_mudaram + 1;
    end if;
    insert into app.bling_estoque_saldos as s (deposito_id, produto_id, bling_produto_id, saldo_fisico, saldo_virtual, lido_em, mudou_em, sincronizacao_id)
    values (p_deposito, v_prod.id, v_bid, v_fis, v_vir, now(), now(), p_sincronizacao)
    on conflict (deposito_id, produto_id) do update set
      bling_produto_id = excluded.bling_produto_id, saldo_fisico = excluded.saldo_fisico, saldo_virtual = excluded.saldo_virtual,
      lido_em = excluded.lido_em, sincronizacao_id = excluded.sincronizacao_id,
      mudou_em = case when s.saldo_fisico <> excluded.saldo_fisico or s.saldo_virtual <> excluded.saldo_virtual then now() else s.mudou_em end;

    if v_fis < 0 then
      perform app._divergencia('negativo_no_bling', p_deposito, v_prod.id, v_prod.codigo, v_bid, v_fis, null, null, null);
    else
      perform app._fechar_divergencia('negativo_no_bling', p_deposito, v_prod.id, 'Saldo voltou a ser positivo no Bling');
    end if;
    if v_fis <> v_vir then
      perform app._divergencia('fisico_virtual_diferente', p_deposito, v_prod.id, v_prod.codigo, v_bid, v_fis, null, null,
                               jsonb_build_object('saldo_virtual', v_vir));
    else
      perform app._fechar_divergencia('fisico_virtual_diferente', p_deposito, v_prod.id, 'Físico e virtual iguais');
    end if;
  end loop;
  perform app._fechar_divergencia('quarentena', p_deposito, null, 'Leitura seguinte aceita');
  return jsonb_build_object('quarentena', false, 'lidos', n_lidos, 'mudaram', n_mudaram,
                            'sem_vinculo', n_sem_vinculo, 'kits_ignorados', n_kits);
end $$;

-- ---------------------------------------------------------------------
-- Reservas de estoque por pedido
-- ---------------------------------------------------------------------
create table app.estoque_reservas (
  id           bigserial primary key,
  pedido_id    uuid not null references app.pedidos(id),
  deposito_id  uuid not null references app.depositos(id),
  produto_id   uuid not null references app.produtos(id),
  quantidade   numeric(12,3) not null check (quantidade > 0),
  status       text not null default 'ativa' check (status in ('ativa','consumida','liberada')),
  criada_em    timestamptz not null default now(),
  encerrada_em timestamptz,
  motivo       text,
  unique (pedido_id, deposito_id, produto_id)
);
create index on app.estoque_reservas (deposito_id, produto_id) where status = 'ativa';

-- Recalcula as reservas de um pedido a partir do estado atual (idempotente: chamar duas vezes dá o mesmo resultado).
--  Reserva: pedido em aprovação/separação; pedido do Bling em aberto (situação não "atendido"/"cancelado");
--           pedido do sistema já enviado, de depósito com fonte Bling, ainda sem pedido no Bling.
--  Consome: estoque lançado (Bling "atendido", envio em depósito de estoque próprio, baixa de marketplace).
--  Libera:  cancelamento ou item retirado do pedido.
create or replace function app.recalcular_reservas(p_pedido uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; v_sit text; v_fim text; v_motivo text;
begin
  select * into v_ped from app.pedidos where id = p_pedido;
  if v_ped.id is null then return; end if;
  if v_ped.bling_id is not null then
    select coalesce(s.significado, 'aberto') into v_sit
      from app.bling_pedidos b left join app.bling_situacoes s on s.id = b.situacao_id where b.bling_id = v_ped.bling_id;
  end if;

  if v_ped.status_comercial = 'cancelado' or v_sit = 'cancelado' then
    v_fim := 'liberada'; v_motivo := 'Pedido cancelado';
  elsif v_sit = 'atendido' then
    v_fim := 'consumida'; v_motivo := 'Estoque lançado no Bling (pedido atendido)';
  elsif v_ped.estoque_baixado then
    v_fim := 'consumida'; v_motivo := 'Baixa do pedido de marketplace';
  end if;

  if to_regclass('pg_temp._reserva_desejada') is null then
    create temp table _reserva_desejada (deposito_id uuid, produto_id uuid, quantidade numeric) on commit drop;
  else
    truncate _reserva_desejada;
  end if;
  if v_fim is null then
    if exists (select 1 from app.pedido_itens where pedido_id = p_pedido and produto_id is not null) then
      insert into _reserva_desejada
      select coalesce(i.deposito_origem_id, v_ped.deposito_id), c.produto_id, sum(c.quantidade)
        from app.pedido_itens i cross join lateral app.componentes(i.produto_id, i.quantidade) c
       where i.pedido_id = p_pedido and i.produto_id is not null
       group by 1, 2;
    elsif v_ped.bling_id is not null then
      insert into _reserva_desejada
      select v_ped.deposito_id, c.produto_id, sum(c.quantidade)
        from app.bling_pedidos b
        cross join lateral jsonb_array_elements(b.itens) it
        cross join lateral (select coalesce((select id from app.produtos where bling_produto_id =
                                               case when (it->'produto'->>'id') ~ '^\d+$' then (it->'produto'->>'id')::bigint end),
                                            app.produto_por_codigo(coalesce(it->>'codigo', it->'produto'->>'codigo'))) as pid,
                                   (it->>'quantidade')::numeric as qtd) x
        cross join lateral app.componentes(x.pid, x.qtd) c
       where b.bling_id = v_ped.bling_id and x.pid is not null and x.qtd > 0
       group by 2;
    end if;
    delete from _reserva_desejada where deposito_id is null or quantidade <= 0;

    -- Enviado/entregue: em depósito de estoque próprio o extrato já baixou; em depósito com fonte Bling
    -- a reserva só sai quando o pedido do Bling for atendido.
    if v_ped.status_comercial::text in ('enviado','aguardando_retirada','entregue') then
      delete from _reserva_desejada r using app.depositos d
       where d.id = r.deposito_id and d.fonte_estoque = 'sistema';
      v_fim := 'consumida'; v_motivo := 'Pedido enviado';
    end if;
  end if;

  update app.estoque_reservas r set status = coalesce(v_fim, 'liberada'), encerrada_em = now(),
         motivo = coalesce(v_motivo, 'Item retirado do pedido')
   where r.pedido_id = p_pedido and r.status = 'ativa'
     and not exists (select 1 from _reserva_desejada d where d.deposito_id = r.deposito_id and d.produto_id = r.produto_id);

  insert into app.estoque_reservas as r (pedido_id, deposito_id, produto_id, quantidade)
  select p_pedido, deposito_id, produto_id, quantidade from _reserva_desejada
  on conflict (pedido_id, deposito_id, produto_id) do update set
    quantidade = excluded.quantidade, status = 'ativa', encerrada_em = null, motivo = null
  where r.status <> 'ativa' or r.quantidade <> excluded.quantidade;
end $$;

create or replace function app._reservas_pedido() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  perform app.recalcular_reservas(coalesce(new.id, old.id));
  return null;
end $$;
create trigger reservas after insert or update of status_comercial, deposito_id, bling_id, estoque_baixado on app.pedidos
  for each row execute function app._reservas_pedido();

create or replace function app._reservas_itens() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  perform app.recalcular_reservas(coalesce(new.pedido_id, old.pedido_id));
  return null;
end $$;
create trigger reservas after insert or update or delete on app.pedido_itens
  for each row execute function app._reservas_itens();

create or replace function app._reservas_bling() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare v uuid;
begin
  for v in select id from app.pedidos where bling_id = new.bling_id loop
    perform app.recalcular_reservas(v);
  end loop;
  return null;
end $$;
create trigger reservas after update of situacao_id, itens on app.bling_pedidos
  for each row execute function app._reservas_bling();

create trigger auditar after insert or update or delete on app.estoque_reservas for each row execute function app.auditar('id');

-- ---------------------------------------------------------------------
-- Disponibilidade (camada única: a fonte pode mudar sem mexer em quem consulta)
-- ---------------------------------------------------------------------
-- Saldo do extrato próprio (a antiga saldo_disponivel, sem reservas)
create or replace function app.saldo_local(p_deposito uuid, p_produto uuid) returns numeric
language sql stable security definer set search_path = app, pg_temp as $$
  select case
    when exists (select 1 from app.kit_componentes where kit_id = p_produto) then
      coalesce((select min(floor(coalesce(s.quantidade, 0) / k.quantidade))
                  from app.kit_componentes k
                  left join app.estoque_saldos s on s.produto_id = k.componente_id and s.deposito_id = p_deposito
                 where k.kit_id = p_produto), 0)
    else coalesce((select quantidade from app.estoque_saldos where deposito_id = p_deposito and produto_id = p_produto), 0)
  end
$$;

create or replace function app.reservado(p_deposito uuid, p_produto uuid) returns numeric
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce(sum(quantidade), 0) from app.estoque_reservas
   where deposito_id = p_deposito and produto_id = p_produto and status = 'ativa'
$$;

create or replace function app.disponibilidade(p_deposito uuid, p_produto uuid)
returns table (quantidade numeric, confiavel boolean, fonte text, saldo numeric, reservado numeric, lido_em timestamptz)
language plpgsql stable security definer set search_path = app, pg_temp as $$
declare v_fonte text; v_desconta boolean; v_saldo numeric; v_lido timestamptz; v_conf boolean; v_res numeric;
begin
  select d.fonte_estoque into v_fonte from app.depositos d where d.id = p_deposito;
  if v_fonte is null then return; end if;

  if exists (select 1 from app.kit_componentes where kit_id = p_produto) then
    -- kit: quantos kits completos cabem no que está disponível de cada componente
    return query
      select coalesce(min(floor(c.quantidade / k.quantidade)), 0), coalesce(bool_and(c.confiavel), false), v_fonte,
             min(floor(c.saldo / k.quantidade)), null::numeric, min(c.lido_em)
        from app.kit_componentes k cross join lateral app.disponibilidade(p_deposito, k.componente_id) c
       where k.kit_id = p_produto;
    return;
  end if;

  v_desconta := v_fonte = 'bling' or app.param('reserva_estoque_proprio') = 1;
  v_res := case when v_desconta then app.reservado(p_deposito, p_produto) else 0 end;
  if v_fonte = 'bling' then
    select b.saldo_fisico, b.lido_em into v_saldo, v_lido
      from app.bling_estoque_saldos b where b.deposito_id = p_deposito and b.produto_id = p_produto;
    v_conf := v_lido is not null
              and v_lido >= now() - make_interval(mins => app.param('bling_saldo_validade_min')::int)
              and not app.integracao_em_alerta('bling');
  else
    v_saldo := coalesce((select s.quantidade from app.estoque_saldos s where s.deposito_id = p_deposito and s.produto_id = p_produto), 0);
    v_conf := true;
  end if;
  return query select greatest(coalesce(v_saldo, 0) - v_res, 0), v_conf, v_fonte, v_saldo, v_res, v_lido;
end $$;

-- Quantidade que pode ser vendida. Dado não confiável (velho ou integração em alerta) vale 0:
-- o site não confirma disponibilidade e o pedido entra como encomenda para a vendedora confirmar.
create or replace function app.saldo_disponivel(p_deposito uuid, p_produto uuid) returns numeric
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce((select case when d.confiavel then d.quantidade else 0 end from app.disponibilidade(p_deposito, p_produto) d), 0)
$$;

-- Trava o saldo dos produtos (e componentes de kits) enquanto um pedido confere a disponibilidade:
-- dois pedidos simultâneos não levam a mesma última unidade. Ordem fixa evita bloqueio mútuo.
create or replace function app.travar_saldos(p_depositos uuid[], p_produtos uuid[]) returns void
language sql security definer set search_path = app, pg_temp as $$
  select count(pg_advisory_xact_lock(k)) from (
    select distinct hashtextextended(d::text || '/' || c.produto_id::text, 0) k
      from unnest(p_depositos) d cross join unnest(p_produtos) p cross join lateral app.componentes(p, 1) c
     where d is not null and p is not null
     order by 1) t
$$;

-- Pedido do cliente: mesma regra de antes, agora com trava e descontando reservas.
create or replace function app.portal_criar_pedido(p_sessao_hash text, p_itens jsonb, p_obs text default null)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_cli app.clientes; v_dep app.depositos; v_ped uuid; it jsonb; v_qtd numeric; f record;
  v_local numeric; v_abast numeric; q_local numeric; q_abast numeric; q_enc numeric; v_enc boolean; v_prod app.produtos; v_total numeric := 0; n int := 0;
begin
  select * into v_cli from app.clientes where id = app.portal_cliente_id(p_sessao_hash);
  if v_cli.id is null then raise exception 'Sessão expirada. Peça um novo link para a sua vendedora.'; end if;
  select * into v_dep from app.depositos where id = app.deposito_do_cliente(v_cli.id);
  perform app.travar_saldos(array[v_dep.id, v_dep.abastecido_por],
    array(select (i->>'produto_id')::uuid from jsonb_array_elements(coalesce(p_itens, '[]')) i where (i->>'produto_id') is not null));
  insert into app.pedidos (origem, canal, cliente_id, vendedora_id, data_pedido, moeda, valor_total, status_comercial, deposito_id, observacoes)
  values ('portal', 'portal', v_cli.id, v_cli.vendedora_id, current_date, v_cli.moeda, 0, 'aguardando_aprovacao', v_dep.id,
          nullif(trim(coalesce(p_obs,'')), ''))
  returning id into v_ped;
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    v_qtd := (it->>'quantidade')::numeric;
    continue when v_qtd is null or v_qtd <= 0;
    select * into v_prod from app.produtos where id = (it->>'produto_id')::uuid and ativo;
    if v_prod.id is null then raise exception 'Produto não encontrado.'; end if;
    select * into f from app.preco_final(v_cli.id, v_prod.id);
    if f.preco is null then raise exception 'Produto sem preço na sua tabela.'; end if;
    if f.limite_qtd is not null and v_qtd > f.limite_qtd then
      raise exception 'Promoção de % limitada a % unidades por pedido.', v_prod.nome, f.limite_qtd;
    end if;
    v_local := app.saldo_disponivel(v_dep.id, v_prod.id);
    v_abast := case when v_dep.abastecido_por is null then 0 else app.saldo_disponivel(v_dep.abastecido_por, v_prod.id) end;
    v_enc := coalesce((it->>'encomenda')::boolean, false);
    if v_local + v_abast < v_qtd and not v_enc then
      raise exception 'Quantidade maior que a disponível de % (disponível: %).', v_prod.nome, v_local + v_abast;
    end if;
    q_local := least(v_qtd, v_local);
    q_abast := least(v_qtd - q_local, v_abast);
    q_enc := v_qtd - q_local - q_abast;
    if q_local > 0 then
      insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
      values (v_ped, v_prod.id, v_prod.codigo,
              v_prod.nome || case when f.promocao_id is not null then ' (promoção -' || f.desconto_pct::int || '%)' else '' end,
              q_local, f.preco, f.tabela, v_dep.id);
    end if;
    if q_abast > 0 then
      insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
      values (v_ped, v_prod.id, v_prod.codigo,
              v_prod.nome || case when f.promocao_id is not null then ' (promoção -' || f.desconto_pct::int || '%)' else '' end
                          || ' · vem de ' || (select nome from app.depositos where id = v_dep.abastecido_por)
                          || coalesce(' (' || v_dep.prazo_abastecimento || ')', ''),
              q_abast, f.preco, f.tabela, v_dep.abastecido_por);
    end if;
    if q_enc > 0 then
      insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
      values (v_ped, v_prod.id, v_prod.codigo,
              v_prod.nome || case when f.promocao_id is not null then ' (promoção -' || f.desconto_pct::int || '%)' else '' end
                          || ' · ENCOMENDA (sem estoque: confirmar prazo)',
              q_enc, f.preco, f.tabela, v_dep.id);
    end if;
    v_total := v_total + v_qtd * f.preco; n := n + 1;
  end loop;
  if n = 0 then raise exception 'Escolha pelo menos um produto.'; end if;
  update app.pedidos set valor_total = round(v_total, 2) where id = v_ped;
  return v_ped;
end $$;

-- ---------------------------------------------------------------------
-- Comparação Bling × sistema e resolução de divergências
-- ---------------------------------------------------------------------
create or replace function app.comparar_estoque(p_deposito uuid default null) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare r record; n int := 0;
begin
  if not app._e_sync() and not app.pode_gerir() then
    raise exception 'Só gerente ou dono compara o estoque.' using errcode = 'insufficient_privilege';
  end if;
  for r in select b.deposito_id, b.produto_id, b.bling_produto_id, b.saldo_fisico, p.codigo,
                  coalesce(s.quantidade, 0) as local, app.reservado(b.deposito_id, b.produto_id) as res
             from app.bling_estoque_saldos b
             join app.produtos p on p.id = b.produto_id
             left join app.estoque_saldos s on s.deposito_id = b.deposito_id and s.produto_id = b.produto_id
            where p_deposito is null or b.deposito_id = p_deposito loop
    if r.saldo_fisico <> r.local then
      perform app._divergencia('saldo_diferente', r.deposito_id, r.produto_id, r.codigo, r.bling_produto_id,
                               r.saldo_fisico, r.local, r.res, jsonb_build_object('diferenca', r.saldo_fisico - r.local));
      n := n + 1;
    else
      perform app._fechar_divergencia('saldo_diferente', r.deposito_id, r.produto_id, 'Saldos iguais na comparação');
    end if;
  end loop;
  -- reservas de pedidos já enviados que ainda não apareceram no Bling há mais de 2 dias
  for r in select re.deposito_id, re.produto_id, sum(re.quantidade) q, jsonb_agg(re.pedido_id) peds
             from app.estoque_reservas re join app.pedidos pe on pe.id = re.pedido_id
            where re.status = 'ativa' and pe.bling_id is null
              and pe.status_comercial::text in ('enviado','aguardando_retirada','entregue')
              and pe.atualizado_em < now() - interval '2 days'
              and (p_deposito is null or re.deposito_id = p_deposito)
            group by 1, 2 loop
    perform app._divergencia('reserva_sem_bling', r.deposito_id, r.produto_id, (select codigo from app.produtos where id = r.produto_id),
                             null, null, null, r.q, jsonb_build_object('pedidos', r.peds));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Resolver: 'igualar_ao_bling' lança um ajuste no extrato próprio (nunca abaixo de zero);
-- 'manter_sistema' e 'ignorar' exigem motivo. Tudo fica na auditoria.
create or replace function app.resolver_divergencia(p_id bigint, p_acao text, p_motivo text) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v app.estoque_divergencias;
begin
  if not app.pode_gerir() then raise exception 'Só gerente ou dono resolve divergências.' using errcode = 'insufficient_privilege'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo.'; end if;
  select * into v from app.estoque_divergencias where id = p_id and status = 'aberta' for update;
  if v.id is null then raise exception 'Divergência não encontrada ou já resolvida.'; end if;
  if p_acao = 'igualar_ao_bling' then
    if v.tipo <> 'saldo_diferente' then raise exception 'Só divergência de saldo pode ser igualada ao Bling.'; end if;
    perform app.ajustar_estoque(v.deposito_id, v.produto_id, greatest(v.saldo_bling, 0), 'Reconciliação com o Bling: ' || p_motivo);
  elsif p_acao not in ('manter_sistema','ignorar') then
    raise exception 'Ação inválida.';
  end if;
  update app.estoque_divergencias set status = case when p_acao = 'ignorar' then 'ignorada' else 'resolvida' end,
         resolvida_em = now(), resolvida_por = app.uid(), resolucao = p_acao || ': ' || p_motivo
   where id = p_id;
end $$;

-- A importação por planilha não pode sobrescrever o estoque de um depósito cuja fonte é o Bling
create or replace function app._importacao_sem_fonte_bling() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if new.referencia_tipo = 'inventario' and new.observacao like 'Importação do Bling%'
     and (select fonte_estoque from app.depositos where id = new.deposito_id) = 'bling' then
    raise exception 'Este depósito usa o Bling como fonte do estoque: a importação por planilha não altera o saldo.';
  end if;
  return new;
end $$;
create trigger importacao_sem_fonte_bling before insert on app.estoque_movimentos
  for each row execute function app._importacao_sem_fonte_bling();

-- Ligar/desligar a fonte Bling num depósito (só o dono)
create or replace function app.definir_fonte_estoque(p_deposito uuid, p_fonte text, p_bling_deposito_id bigint default null)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if app.perfil_atual() is distinct from 'dono' then
    raise exception 'Só o dono muda a fonte do estoque.' using errcode = 'insufficient_privilege';
  end if;
  update app.depositos set bling_deposito_id = coalesce(p_bling_deposito_id, bling_deposito_id), fonte_estoque = p_fonte
   where id = p_deposito;
  if not found then raise exception 'Depósito não existe.'; end if;
end $$;

-- Visão para a tela de estoque: sistema × Bling × reservas × disponível
create or replace view app.v_estoque_comparativo with (security_invoker = true) as
select v.deposito_id, v.deposito, d.fonte_estoque, v.produto_id, v.codigo, v.produto,
       v.saldo as saldo_sistema, b.saldo_fisico as bling_fisico, b.saldo_virtual as bling_virtual, b.lido_em as bling_lido_em,
       x.reservado, x.quantidade as disponivel, x.confiavel
  from app.v_estoque v
  join app.depositos d on d.id = v.deposito_id
  left join app.bling_estoque_saldos b on b.deposito_id = v.deposito_id and b.produto_id = v.produto_id
  cross join lateral app.disponibilidade(v.deposito_id, v.produto_id) x;

-- ---------------------------------------------------------------------
-- Segurança
-- ---------------------------------------------------------------------
alter table app.integracao_saude enable row level security;
alter table app.bling_credenciais enable row level security;          -- sem políticas: só funções e a sincronização
alter table app.bling_eventos enable row level security;
alter table app.bling_estoque_saldos enable row level security;
alter table app.bling_estoque_historico enable row level security;
alter table app.estoque_divergencias enable row level security;
alter table app.estoque_reservas enable row level security;

create policy ler on app.integracao_saude for select using (app.uid() is not null);
create policy ler on app.bling_eventos for select using (app.pode_gerir());
create policy ler on app.bling_estoque_saldos for select using (app.uid() is not null);
create policy ler on app.bling_estoque_historico for select using (app.pode_gerir());
create policy ler on app.estoque_divergencias for select using (app.pode_gerir());
create policy ler on app.estoque_reservas for select using (app.uid() is not null);
create policy sync on app.bling_credenciais for all to vc_sync using (true) with check (true);

revoke all on app.bling_credenciais from vc_app;
grant select on app.integracao_saude, app.bling_eventos, app.bling_estoque_saldos, app.bling_estoque_historico,
  app.estoque_divergencias, app.estoque_reservas, app.v_estoque_comparativo to vc_app;
grant select, update on app.bling_credenciais to vc_sync;
grant select on app.depositos, app.produtos, app.produto_codigos, app.kit_componentes, app.bling_situacoes to vc_sync;

grant execute on function app.disponibilidade(uuid, uuid), app.saldo_local(uuid, uuid), app.reservado(uuid, uuid),
  app.integracao_em_alerta(text), app.bling_conexao(), app.bling_salvar_tokens(text, text, timestamptz, timestamptz),
  app.comparar_estoque(uuid), app.resolver_divergencia(bigint, text, text), app.definir_fonte_estoque(uuid, text, bigint),
  app.travar_saldos(uuid[], uuid[]) to vc_app;
grant execute on function app.bling_receber_evento(jsonb) to vc_app, vc_sync;   -- o webhook roda na aplicação
grant execute on function app.sinc_iniciar(text, text), app.sinc_finalizar(bigint, boolean, int, int, int, text),
  app.bling_pegar_eventos(int), app.bling_concluir_evento(text, text), app.bling_registrar_saldos(uuid, jsonb, bigint),
  app.bling_salvar_tokens(text, text, timestamptz, timestamptz), app.comparar_estoque(uuid),
  app.disponibilidade(uuid, uuid), app.saldo_disponivel(uuid, uuid), app.integracao_em_alerta(text) to vc_sync;
-- funções de gatilho
grant execute on function app._e_sync() to vc_app, vc_sync;
grant execute on function app._reservas_pedido(), app._reservas_itens(), app._reservas_bling(),
  app._importacao_sem_fonte_bling() to vc_app, vc_sync;

-- ---------------------------------------------------------------------
-- Envio de pedido em depósito com fonte Bling: o extrato próprio roda em paralelo e pode
-- estar diferente; falta no extrato não trava o envio, vira pendência para conferir
-- (mesma regra dos pedidos de marketplace). Em depósito de estoque próprio nada muda.
-- ---------------------------------------------------------------------
create or replace function app.estoque_do_pedido() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare it record; v_bling boolean;
begin
  if new.deposito_id is null or new.origem = 'bling' then return new; end if;
  v_bling := (select fonte_estoque = 'bling' from app.depositos where id = new.deposito_id);
  if new.status_comercial::text in ('enviado','aguardando_retirada','entregue')
     and old.status_comercial::text in ('em_separacao','aguardando_aprovacao') then
    for it in select c.produto_id, sum(c.quantidade) q
                from app.pedido_itens i cross join lateral app.componentes(i.produto_id, i.quantidade) c
               where i.pedido_id = new.id and i.produto_id is not null group by 1 loop
      if v_bling then
        begin
          perform app._lancar(new.deposito_id, it.produto_id, 'saida_venda', it.q, 'pedido', new.id::text, null);
        exception when others then
          insert into app.estoque_pendencias (tipo, pedido_id, deposito_id, produto_id, codigo, quantidade, detalhe)
          values ('sem_estoque', new.id, new.deposito_id, it.produto_id,
                  (select codigo from app.produtos where id = it.produto_id), it.q,
                  'Saída não lançada no extrato próprio (fonte oficial: Bling)');
        end;
      else
        perform app._lancar(new.deposito_id, it.produto_id, 'saida_venda', it.q, 'pedido', new.id::text, null);
      end if;
    end loop;
  elsif new.status_comercial::text = 'cancelado' and old.status_comercial::text in ('enviado','aguardando_retirada','entregue') then
    -- devolve só o que de fato saiu do extrato por este pedido
    for it in select m.produto_id, sum(case when m.tipo = 'saida_venda' then m.quantidade else -m.quantidade end) q
                from app.estoque_movimentos m
               where m.referencia_tipo = 'pedido' and m.referencia_id = new.id::text
                 and m.tipo in ('saida_venda','devolucao_cliente') and m.deposito_id = new.deposito_id
               group by 1 having sum(case when m.tipo = 'saida_venda' then m.quantidade else -m.quantidade end) > 0 loop
      perform app._lancar(new.deposito_id, it.produto_id, 'devolucao_cliente', it.q, 'pedido', new.id::text, 'Pedido cancelado após envio');
    end loop;
  end if;
  return new;
end $$;
