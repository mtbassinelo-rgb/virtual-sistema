-- Desconto por quantidade só vale com a liberação do gerente: o pedido do site que atinge a faixa fica
-- "a liberar" (preços intactos); o gerente libera (o desconto entra nos itens) ou não libera.
alter table app.pedidos
  add column desconto_qtd_pct numeric(5,2),
  add column desconto_qtd_status text check (desconto_qtd_status in ('pendente','aprovado','recusado')),
  add column desconto_qtd_decidido_por uuid references app.usuarios(id),
  add column desconto_qtd_decidido_em timestamptz;

-- Faixa atingida por marca no pedido: [{marca, qtd, pct}]
create or replace function app._faixas_desconto_pedido(p_pedido uuid)
returns table (marca text, qtd numeric, pct numeric)
language sql stable security definer set search_path = app, pg_temp as $$
  with ped as (select case when moeda = 'GS' then 'PY'::app.pais else 'BR'::app.pais end as pais from app.pedidos where id = p_pedido),
  q as (
    select pr.marca, sum(case when pr.unidades_caixa > 0 then i.quantidade / pr.unidades_caixa else i.quantidade end) as qtd
      from app.pedido_itens i join app.produtos pr on pr.id = i.produto_id
     where i.pedido_id = p_pedido and i.descricao not ilike '%(promoção%' and i.descricao not ilike '%por quantidade)%' group by pr.marca)
  select q.marca, q.qtd, max(d.desconto_pct)
    from q cross join ped join app.descontos_quantidade d on d.ativo and (d.marca is null or d.marca = q.marca)
     and (d.pais is null or d.pais = ped.pais) and q.qtd >= d.min_qtd
   group by q.marca, q.qtd
$$;

-- Pedido do site recém-criado: só marca que pode ter desconto (o gerente decide). Devolve o maior % atingido.
create or replace function app.portal_aplicar_desconto_quantidade(p_sessao_hash text, p_pedido uuid) returns numeric
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; v_pct numeric;
begin
  select * into v_ped from app.pedidos where id = p_pedido and cliente_id = app.portal_cliente_id(p_sessao_hash) and origem = 'portal'
     and criado_em > now() - interval '10 minutes' and total_confirmado_em is null;
  if v_ped.id is null then return 0; end if;
  select max(pct) into v_pct from app._faixas_desconto_pedido(p_pedido);
  if v_pct is null then return 0; end if;
  update app.pedidos set desconto_qtd_pct = v_pct, desconto_qtd_status = 'pendente' where id = p_pedido;
  return v_pct;
end $$;

-- Gerente libera (aplica o desconto nos itens das marcas que atingiram a faixa) ou não libera
create or replace function app.decidir_desconto_quantidade(p_pedido uuid, p_liberar boolean) returns numeric
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; r record; v_total numeric;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só o gerente libera desconto por quantidade.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_ped from app.pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if v_ped.desconto_qtd_status is distinct from 'pendente' then raise exception 'Este pedido não tem desconto esperando liberação.'; end if;
  if v_ped.total_confirmado_em is not null then raise exception 'O total já foi confirmado ao cliente: não dá para mudar os preços.'; end if;
  if p_liberar then
    for r in select * from app._faixas_desconto_pedido(p_pedido) loop
      update app.pedido_itens i set preco_unitario = app.arredondar_preco(i.preco_unitario * (1 - r.pct / 100), v_ped.moeda),
             descricao = i.descricao || ' (−' || trim(to_char(r.pct, 'FM990.##')) || '% por quantidade)'
        from app.produtos pr
       where i.pedido_id = p_pedido and pr.id = i.produto_id and pr.marca is not distinct from r.marca
         and i.descricao not ilike '%(promoção%' and i.descricao not ilike '%por quantidade)%';
    end loop;
    select round(sum(quantidade * preco_unitario), 2) into v_total from app.pedido_itens where pedido_id = p_pedido;
    update app.pedidos set valor_total = coalesce(v_total, 0) where id = p_pedido;
  end if;
  update app.pedidos set desconto_qtd_status = case when p_liberar then 'aprovado' else 'recusado' end,
         desconto_qtd_decidido_por = app.uid(), desconto_qtd_decidido_em = now() where id = p_pedido;
  return case when p_liberar then v_ped.valor_total - coalesce(v_total, v_ped.valor_total) else 0 end;
end $$;
grant execute on function app.decidir_desconto_quantidade(uuid, boolean) to vc_app;
revoke execute on function app._faixas_desconto_pedido(uuid) from public;


-- A visão dos pedidos foi criada no começo com as colunas que existiam na época ("p.*" fica fixo na criação):
-- as colunas novas (depósito, total confirmado, desconto por quantidade etc.) entram no fim da visão.
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
       case when p.status_comercial = 'cancelado' then 0
            else greatest(p.valor_total - coalesce(pg.recebido, 0), 0) end as saldo,
       case
         when p.status_comercial = 'cancelado'                                   then 'cancelado'
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
  left join app.vendedoras v on v.id = p.vendedora_id;
