-- =====================================================================
-- Vendas da Shopee e do Mercado Livre: não são dívida de cliente (a plataforma repassa). Saem do contas a receber
-- e aparecem como pagas. Resumo diário por marketplace no corte das 14h (horário das plataformas).
-- =====================================================================
create or replace view app.v_pedidos with (security_invoker = true) as
with pg as (
  select pedido_id,
         coalesce(sum(valor) filter (where status_conferencia = 'conferido'), 0) as recebido,
         coalesce(sum(valor) filter (where status_conferencia = 'pendente'), 0)  as a_conferir,
         count(*) filter (where status_conferencia = 'pendente')                 as qtd_a_conferir
    from app.pagamentos group by pedido_id
)
select p.id, p.origem, p.bling_id, p.bling_numero, p.canal, p.numero_externo, p.cliente_id, p.vendedora_id, p.data_pedido, p.moeda, p.valor_total, p.status_comercial, p.previsao_envio, p.enviado_em, p.entregue_em, p.vencimento, p.credito_concedido, p.taxa_marketplace, p.repasse_previsto, p.observacoes, p.bling_hash_conferido, p.criado_por, p.criado_em, p.atualizado_em, p.atendimento_id,
       coalesce(pg.recebido, 0)   as recebido,
       coalesce(pg.a_conferir, 0) as a_conferir,
       coalesce(pg.qtd_a_conferir, 0) as qtd_a_conferir,
       case when p.status_comercial = 'cancelado' or mk.codigo is not null then 0
            else greatest(p.valor_total - coalesce(pg.recebido, 0), 0) end as saldo,
       case
         when p.status_comercial = 'cancelado'                                   then 'cancelado'
         when mk.codigo is not null                                               then 'pago'
         when p.valor_total - coalesce(pg.recebido, 0) <= 0                       then 'pago'
         when p.vencimento is not null and p.vencimento < current_date            then 'atrasado'
         when coalesce(pg.recebido, 0) > 0                                         then 'parcial'
         when p.credito_concedido                                                   then 'a_credito'
         else 'aguardando'
       end as status_pagamento,
       (p.status_comercial = 'em_separacao' and p.previsao_envio < current_date) as envio_atrasado,
       (b.bling_id is not null and p.bling_hash_conferido is distinct from b.conteudo_hash) as bling_mudou,
       b.total as bling_total,
       b.situacao_nome as bling_situacao,
       (b.total is not null and b.total <> p.valor_total) as divergencia_valor,
       c.nome as cliente_nome,
       v.nome as vendedora_nome,
       v.whatsapp as vendedora_whatsapp,
       p.deposito_id, p.separacao_conferida_em, p.separacao_conferida_por, p.total_confirmado_em, p.total_confirmado_por, p.conta_pagamento, p.estoque_baixado, p.chegou_em, p.local_retirada, p.volumes, p.desconto_qtd_pct, p.desconto_qtd_status, p.desconto_qtd_decidido_por, p.desconto_qtd_decidido_em
  from app.pedidos p
  left join pg on pg.pedido_id = p.id
  left join app.bling_pedidos b on b.bling_id = p.bling_id
  left join app.clientes c on c.id = p.cliente_id
  left join app.vendedoras v on v.id = p.vendedora_id
  left join app.canais mk on mk.codigo = p.canal and mk.marketplace;

-- Dia de corte: o lançamento feito até ~14h de um dia conta para esse dia (as plataformas fecham às 14h);
-- lançado depois disso, vai para o dia seguinte.
create or replace function app.dia_corte_marketplace(p_quando timestamptz) returns date
language sql stable set search_path = app, pg_temp as $$
  select ((p_quando at time zone 'America/Sao_Paulo') + interval '9 hours 50 minutes')::date
$$;
grant execute on function app.dia_corte_marketplace(timestamptz) to vc_app;
