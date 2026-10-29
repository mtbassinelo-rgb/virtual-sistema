-- =====================================================================
-- Integração direta Shopee e Mercado Livre (fase 1, leitura) e "Envios de hoje" do estoquista.
-- O sistema busca os pedidos pagos nas plataformas: cada pedido vira venda (baixa no estoque, igual ao relatório)
-- e um envio para o estoquista preparar. O relatório do Bling continua funcionando: o mesmo pedido não entra duas vezes
-- (canal + número do marketplace). Pedidos do Full/Fulfillment (estoque no armazém da plataforma) não entram aqui.
-- =====================================================================

-- Contas conectadas (tokens). Sem política de leitura: só as funções abaixo leem e gravam.
create table if not exists app.marketplace_contas (
  id                 uuid primary key default gen_random_uuid(),
  canal              text not null references app.canais(codigo),
  conta_externa      text not null,               -- user_id do Mercado Livre / shop_id da Shopee
  nome               text,
  access_token       text,
  refresh_token      text,
  expira_em          timestamptz,
  refresh_expira_em  timestamptz,
  ativa              boolean not null default true,
  conectada_por      uuid references app.usuarios(id),
  conectada_em       timestamptz not null default now(),
  sincronizada_em    timestamptz,
  ultimo_erro        text,
  ultimo_erro_em     timestamptz,
  unique (canal, conta_externa)
);
alter table app.marketplace_contas enable row level security;
revoke all on app.marketplace_contas from vc_app;

-- Envios a preparar (um por pedido do marketplace; "pacote" junta pedidos que vão na mesma caixa)
create table if not exists app.marketplace_envios (
  id                uuid primary key default gen_random_uuid(),
  canal             text not null references app.canais(codigo),
  conta_id          uuid references app.marketplace_contas(id) on delete set null,
  numero_externo    text not null,
  pacote            text,
  pedido_id         uuid references app.pedidos(id) on delete set null,
  deposito_id       uuid references app.depositos(id),
  comprador         text,
  itens             jsonb not null default '[]',
  status_plataforma text,
  logistica         text,
  prazo             timestamptz,
  etapa             text not null default 'a_preparar' check (etapa in ('a_preparar','preparado','enviado','cancelado')),
  preparado_em      timestamptz,
  preparado_por     uuid references app.usuarios(id),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  unique (canal, numero_externo)
);
create index if not exists marketplace_envios_etapa on app.marketplace_envios (etapa, prazo);
alter table app.marketplace_envios enable row level security;
drop policy if exists ler on app.marketplace_envios;
create policy ler on app.marketplace_envios for select
  using (coalesce(app.pode_gerir(), false) or (deposito_id is not null and app.pode_operar_deposito(deposito_id)));
grant select on app.marketplace_envios to vc_app;

-- Situação das contas para a tela de conexões (sem os tokens)
create or replace function app.mkt_contas_situacao()
returns table (id uuid, canal text, conta_externa text, nome text, ativa boolean, conectada_em timestamptz, conectada_por text,
               sincronizada_em timestamptz, ultimo_erro text, ultimo_erro_em timestamptz, expira_em timestamptz, refresh_expira_em timestamptz)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono.' using errcode = 'insufficient_privilege'; end if;
  return query select c.id, c.canal, c.conta_externa, c.nome, c.ativa, c.conectada_em, app.nome_usuario(c.conectada_por),
                      c.sincronizada_em, c.ultimo_erro, c.ultimo_erro_em, c.expira_em, c.refresh_expira_em
                 from app.marketplace_contas c order by c.canal, c.nome;
end $$;

-- Daqui para baixo: chamadas pelo servidor (conexão OAuth e sincronização), sem usuário logado.
create or replace function app.mkt_salvar_conta(p_canal text, p_conta text, p_nome text, p_access text, p_refresh text,
                                                p_expira_s int, p_refresh_expira_s int, p_usuario uuid)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id uuid;
begin
  if not exists (select 1 from app.canais where codigo = p_canal and marketplace) then raise exception 'Canal inválido.'; end if;
  insert into app.marketplace_contas (canal, conta_externa, nome, access_token, refresh_token, expira_em, refresh_expira_em, ativa, conectada_por, conectada_em, ultimo_erro)
  values (p_canal, p_conta, p_nome, p_access, p_refresh, now() + make_interval(secs => greatest(coalesce(p_expira_s, 0) - 120, 60)),
          case when p_refresh_expira_s is not null then now() + make_interval(secs => p_refresh_expira_s) end, true, p_usuario, now(), null)
  on conflict (canal, conta_externa) do update
     set nome = coalesce(excluded.nome, app.marketplace_contas.nome), access_token = excluded.access_token, refresh_token = excluded.refresh_token,
         expira_em = excluded.expira_em, refresh_expira_em = excluded.refresh_expira_em, ativa = true,
         conectada_por = excluded.conectada_por, conectada_em = now(), ultimo_erro = null
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.mkt_contas_ativas()
returns table (id uuid, canal text, conta_externa text, access_token text, refresh_token text, expira_em timestamptz, sincronizada_em timestamptz)
language sql stable security definer set search_path = app, pg_temp as $$
  select id, canal, conta_externa, access_token, refresh_token, expira_em, sincronizada_em from app.marketplace_contas where ativa order by canal
$$;

create or replace function app.mkt_atualizar_token(p_id uuid, p_access text, p_refresh text, p_expira_s int, p_refresh_expira_s int)
returns void language sql security definer set search_path = app, pg_temp as $$
  update app.marketplace_contas
     set access_token = p_access, refresh_token = coalesce(p_refresh, refresh_token),
         expira_em = now() + make_interval(secs => greatest(coalesce(p_expira_s, 0) - 120, 60)),
         refresh_expira_em = coalesce(case when p_refresh_expira_s is not null then now() + make_interval(secs => p_refresh_expira_s) end, refresh_expira_em)
   where id = p_id
$$;

create or replace function app.mkt_resultado(p_id uuid, p_erro text)
returns void language sql security definer set search_path = app, pg_temp as $$
  update app.marketplace_contas
     set sincronizada_em = case when p_erro is null then now() else sincronizada_em end,
         ultimo_erro = left(p_erro, 500), ultimo_erro_em = case when p_erro is null then ultimo_erro_em else now() end
   where id = p_id
$$;

-- Um pedido vindo da plataforma. p jsonb:
-- {ref, pacote, data (yyyy-mm-dd), comprador, status, logistica, prazo (iso), etapa ('a_preparar'|'enviado'|'cancelado'),
--  taxa, itens: [{sku, alt, descricao, quantidade, valor}]}
-- Devolve 'novo', 'atualizado', 'cancelado' ou 'ignorado'.
create or replace function app.mkt_registrar_pedido(p_conta uuid, p jsonb)
returns text language plpgsql security definer set search_path = app, pg_temp as $$
declare v_conta app.marketplace_contas; v_can app.canais; v_dep uuid; v_vend uuid; v_ref text; v_ped uuid; v_env app.marketplace_envios;
        v_itens jsonb; v_tot numeric; v_etapa text; v_res text := 'atualizado';
begin
  select * into v_conta from app.marketplace_contas where id = p_conta;
  if v_conta.id is null then raise exception 'Conta não encontrada.'; end if;
  select * into v_can from app.canais where codigo = v_conta.canal;
  v_ref := nullif(left(trim(coalesce(p->>'ref', '')), 60), '');
  if v_ref is null then return 'ignorado'; end if;
  v_etapa := coalesce(p->>'etapa', 'a_preparar');
  v_dep := coalesce(v_can.deposito_id, (select id from app.depositos where ativo and nome ilike 'CD Principal%' order by nome limit 1));
  select id into v_ped from app.pedidos where canal = v_conta.canal and numero_externo = v_ref;
  select * into v_env from app.marketplace_envios where canal = v_conta.canal and numero_externo = v_ref;

  if v_etapa = 'cancelado' then
    if v_ped is not null and (select status_comercial::text from app.pedidos where id = v_ped) <> 'cancelado' then
      perform app.estornar_pedido_marketplace(v_ped);
      update app.pedidos set status_comercial = 'cancelado' where id = v_ped;
      update app.estoque_pendencias set resolvida_em = now() where pedido_id = v_ped and resolvida_em is null;
    end if;
    if v_env.id is not null then
      update app.marketplace_envios set etapa = 'cancelado', status_plataforma = p->>'status', atualizado_em = now() where id = v_env.id;
    end if;
    return 'cancelado';
  end if;

  -- itens: usa o SKU se ele estiver cadastrado; senão o código alternativo (ex.: MLB do anúncio)
  select jsonb_agg(jsonb_build_object(
           'codigo', case when app.produto_por_codigo(i->>'sku') is not null or nullif(i->>'alt', '') is null then coalesce(nullif(i->>'sku', ''), i->>'alt') else i->>'alt' end,
           'quantidade', (i->>'quantidade')::numeric, 'descricao', i->>'descricao', 'valor', coalesce(nullif(i->>'valor', '')::numeric, 0)))
    into v_itens from jsonb_array_elements(coalesce(p->'itens', '[]')) i;
  v_itens := coalesce(v_itens, '[]');

  if v_ped is null then
    v_vend := coalesce(v_can.vendedora_id, (select id from app.vendedoras where nome = 'Marketplace' limit 1));
    if v_vend is null then raise exception 'Cadastre a vendedora "Marketplace" para os pedidos dos canais.'; end if;
    select coalesce(sum((i->>'quantidade')::numeric * (i->>'valor')::numeric), 0) into v_tot from jsonb_array_elements(v_itens) i;
    insert into app.pedidos (origem, canal, numero_externo, vendedora_id, data_pedido, moeda, valor_total, status_comercial, deposito_id,
                             taxa_marketplace, repasse_previsto, entregue_em, enviado_em, observacoes)
    values ('planilha', v_conta.canal, v_ref, v_vend, coalesce(nullif(p->>'data', '')::date, current_date), 'BRL', round(v_tot, 2), 'entregue', v_dep,
            nullif(p->>'taxa', '')::numeric, case when nullif(p->>'taxa', '') is not null then round(v_tot - (p->>'taxa')::numeric, 2) end,
            coalesce(nullif(p->>'data', '')::date, current_date), coalesce(nullif(p->>'data', '')::date, current_date),
            'Recebido direto da plataforma (' || v_can.nome || ')')
    returning id into v_ped;
    perform app.baixar_pedido_marketplace(v_ped, v_itens);
    update app.pedidos set valor_total = greatest(round(v_tot, 2), 0) where id = v_ped;
    v_res := 'novo';
  end if;

  -- envio para o estoquista: só os que ele prepara (pedido que já chega enviado entra direto como enviado)
  if v_env.id is null then
    insert into app.marketplace_envios (canal, conta_id, numero_externo, pacote, pedido_id, deposito_id, comprador, itens,
                                        status_plataforma, logistica, prazo, etapa)
    values (v_conta.canal, p_conta, v_ref, nullif(p->>'pacote', ''), v_ped, v_dep, left(p->>'comprador', 120),
            (select coalesce(jsonb_agg(jsonb_build_object('codigo', x->>'codigo', 'descricao', coalesce(pr.nome, x->>'descricao'),
                     'quantidade', (x->>'quantidade')::numeric, 'produto_id', pr.id)), '[]')
               from jsonb_array_elements(v_itens) x left join app.produtos pr on pr.id = app.produto_por_codigo(x->>'codigo')),
            p->>'status', p->>'logistica', nullif(p->>'prazo', '')::timestamptz, case when v_etapa = 'enviado' then 'enviado' else 'a_preparar' end);
  else
    update app.marketplace_envios
       set status_plataforma = p->>'status', logistica = coalesce(p->>'logistica', logistica),
           prazo = coalesce(nullif(p->>'prazo', '')::timestamptz, prazo), pedido_id = coalesce(pedido_id, v_ped),
           etapa = case when v_etapa = 'enviado' then 'enviado' when etapa = 'cancelado' then 'a_preparar' else etapa end,
           atualizado_em = now()
     where id = v_env.id;
  end if;
  return v_res;
end $$;

-- Estoquista marca o envio como embalado (ou desfaz)
create or replace function app.mkt_marcar_envio(p_envio uuid, p_preparado boolean)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare v app.marketplace_envios;
begin
  select * into v from app.marketplace_envios where id = p_envio for update;
  if v.id is null then raise exception 'Envio não encontrado.'; end if;
  if not (coalesce(app.pode_gerir(), false) or (v.deposito_id is not null and app.pode_operar_deposito(v.deposito_id))) then
    raise exception 'Só quem mexe no estoque desta unidade marca os envios.' using errcode = 'insufficient_privilege';
  end if;
  if v.etapa in ('enviado', 'cancelado') then raise exception 'Este envio já foi % na plataforma.', case when v.etapa = 'enviado' then 'enviado' else 'cancelado' end; end if;
  update app.marketplace_envios
     set etapa = case when p_preparado then 'preparado' else 'a_preparar' end,
         preparado_em = case when p_preparado then now() end, preparado_por = case when p_preparado then app.uid() end,
         atualizado_em = now()
   where id = p_envio;
end $$;

revoke execute on function app.mkt_salvar_conta(text, text, text, text, text, int, int, uuid), app.mkt_contas_ativas(),
  app.mkt_atualizar_token(uuid, text, text, int, int), app.mkt_resultado(uuid, text), app.mkt_registrar_pedido(uuid, jsonb),
  app.mkt_marcar_envio(uuid, boolean), app.mkt_contas_situacao() from public;
grant execute on function app.mkt_salvar_conta(text, text, text, text, text, int, int, uuid), app.mkt_contas_ativas(),
  app.mkt_atualizar_token(uuid, text, text, int, int), app.mkt_resultado(uuid, text), app.mkt_registrar_pedido(uuid, jsonb),
  app.mkt_marcar_envio(uuid, boolean), app.mkt_contas_situacao() to vc_app;
