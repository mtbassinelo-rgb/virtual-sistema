-- =====================================================================
-- Migração 0138: etiqueta de envio e resumo diário no WhatsApp do gerente
--
-- Etiqueta: com os dados confirmados no pedido (nome, identidade, telefone, direção) e o meio de envio,
-- uma por volume. A loja CDE e o estoquista imprimem mesmo sem ver o pedido pela regra da vendedora.
--
-- Resumo diário: no horário do parâmetro resumo_diario_hora (0 = desligado), vai para o mesmo número do
-- aviso de pagamento: vendas do dia por vendedora, pagamentos, o que falta conferir/finalizar/separar e
-- os pedidos parados (separados há mais de 3 dias sem pagamento).
-- =====================================================================

create or replace function app.etiquetas_envio(p_ids uuid[])
returns table (id uuid, cliente text, bling_numero text, data_pedido date, entrega_tipo text, entrega_meio text, entrega_dados text,
               volumes int, cidade text, pais text, envio_nome text, envio_documento text, envio_telefone text, envio_endereco text, vendedora text)
language sql stable security definer set search_path = app, pg_temp as $$
  select p.id, cl.nome, p.bling_numero, p.data_pedido, p.entrega_tipo, p.entrega_meio, p.entrega_dados,
         greatest(coalesce(p.volumes, p.caixas_separadas, 1), 1), cl.cidade, cl.pais::text,
         cl.envio_nome, cl.envio_documento, cl.envio_telefone, cl.envio_endereco, v.nome
    from app.pedidos p join app.clientes cl on cl.id = p.cliente_id left join app.vendedoras v on v.id = p.vendedora_id
   where p.id = any(p_ids)
     and (app.ve_pedido(p.vendedora_id) or app.pode_operar_deposito(p.deposito_id) or app.pode_confirmar_envio_py())
   order by array_position(p_ids, p.id)
$$;
grant execute on function app.etiquetas_envio(uuid[]) to vc_app;

insert into app.parametros (chave, valor, descricao) values
  ('resumo_diario_hora', 18, 'Hora do resumo do dia no WhatsApp do gerente (mesmo número do aviso de pagamento; 0 = desligado)')
on conflict (chave) do nothing;
update app.parametros set descricao = 'WhatsApp do gerente: recebe o aviso de pagamento e o resumo do dia (com DDI, só números; 0 = desligado)'
 where chave = 'aviso_pagamento_whatsapp';

create table if not exists app.resumo_diario_envios (
  dia        date primary key,
  enviado_em timestamptz not null default now()
);
alter table app.resumo_diario_envios enable row level security;

-- Devolve o resumo quando chegou a hora e ainda não foi enviado hoje (nada, caso contrário).
create or replace function app.resumo_diario_pendente()
returns table (dia date, numero text, instancia text, dados jsonb)
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_agora timestamp := now() at time zone 'America/Asuncion'; v_dia date := (now() at time zone 'America/Asuncion')::date;
        v_hora numeric := coalesce(app.param('resumo_diario_hora'), 0); v_num numeric := coalesce(app.param('aviso_pagamento_whatsapp'), 0);
        v_inst text; v_ini timestamptz;
begin
  if v_hora <= 0 or v_num <= 0 or extract(hour from v_agora) < v_hora then return; end if;
  if exists (select 1 from app.resumo_diario_envios e where e.dia = v_dia) then return; end if;
  select w.instancia into v_inst from app.whatsapp_conexoes w where w.ativo and w.estado = 'conectado'
   order by (w.vendedora_id is null) desc, w.criado_em limit 1;
  if v_inst is null then return; end if;
  v_ini := v_dia::timestamp at time zone 'America/Asuncion';
  return query select v_dia, trunc(v_num)::bigint::text, v_inst, jsonb_build_object(
    'vendas', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select coalesce(v.nome, 'Sem vendedora') as vendedora, p.moeda::text as moeda, count(*)::int as n, sum(p.valor_total) as total
          from app.pedidos p left join app.vendedoras v on v.id = p.vendedora_id
          left join app.canais k on k.codigo = p.canal
         where p.criado_em >= v_ini and p.status_comercial::text <> 'cancelado' and not coalesce(k.marketplace, false)
         group by 1, 2) x),
    'marketplace', (select count(*) from app.pedidos p join app.canais k on k.codigo = p.canal and k.marketplace
                     where p.criado_em >= v_ini and p.status_comercial::text <> 'cancelado'),
    'pagos', (select coalesce(jsonb_agg(x), '[]') from (
        select p.moeda::text as moeda, count(*)::int as n, sum(g.valor) as total
          from app.pagamentos g join app.pedidos p on p.id = g.pedido_id
         where g.registrado_em >= v_ini and g.status_conferencia <> 'recusado' group by 1) x),
    'a_conferir', (select count(distinct g.pedido_id) from app.pagamentos g where g.status_conferencia = 'pendente'),
    'a_finalizar', (select count(*) from app.pedidos p where p.separacao_conferida_em is not null and p.finalizado_em is null
                     and p.origem <> 'bling' and p.status_comercial::text in ('em_separacao', 'enviado', 'aguardando_retirada')),
    'a_separar', (select count(*) from app.pedidos p where p.status_comercial::text = 'em_separacao' and p.origem <> 'bling'
                   and p.separacao_conferida_em is null),
    'cde', (select count(*) from app.pedidos p where app.envio_py_pendente(p)),
    'parados', (select coalesce(jsonb_agg(x), '[]') from (
        select cl.nome as cliente, v.nome as vendedora, vp.saldo, p.moeda::text as moeda,
               (current_date - p.separacao_conferida_em::date) as dias
          from app.pedidos p join app.v_pedidos vp on vp.id = p.id
          join app.clientes cl on cl.id = p.cliente_id left join app.vendedoras v on v.id = p.vendedora_id
         where p.status_comercial::text = 'em_separacao' and p.separacao_conferida_em < now() - interval '3 days'
           and vp.saldo > 0 and vp.a_conferir = 0
         order by p.separacao_conferida_em limit 8) x)
  );
end $$;
revoke execute on function app.resumo_diario_pendente() from public;
grant execute on function app.resumo_diario_pendente() to vc_app;

create or replace function app.resumo_diario_marcar(p_dia date) returns void
language sql security definer set search_path = app, pg_temp as $$
  insert into app.resumo_diario_envios (dia) values (p_dia) on conflict do nothing
$$;
revoke execute on function app.resumo_diario_marcar(date) from public;
grant execute on function app.resumo_diario_marcar(date) to vc_app;
