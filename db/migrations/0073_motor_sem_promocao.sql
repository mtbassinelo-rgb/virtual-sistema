-- =====================================================================
-- Produto de marca do motor (Paraguai): vale só o preço do motor (tabela Normal/VIP da precificação).
-- Promoção aprovada para esse produto no Paraguai deixa de baixar o preço e não aparece no site.
-- No Brasil nada muda.
-- =====================================================================
create or replace function app.produto_no_motor(p_produto uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select exists (select 1 from app.produtos p join app.marcas_inteligencia mi on mi.marca = coalesce(nullif(trim(p.marca), ''), 'Sem marca')
                  where p.id = p_produto and mi.gatilho)
$$;
grant execute on function app.produto_no_motor(uuid) to vc_app;

create or replace function app.preco_final(p_cliente uuid, p_produto uuid, p_data date default current_date)
returns table (preco numeric, preco_tabela numeric, moeda app.moeda, tabela text, promocao_id uuid, desconto_pct numeric, limite_qtd numeric)
language sql stable security definer set search_path = app, pg_temp as $$
  with base as (select * from app.preco_para_cliente(p_cliente, p_produto, p_data)),
       promo as (
         select pr.id, pr.desconto_pct, pr.limite_qtd from app.promocoes pr
          where pr.produto_id = p_produto and pr.status = 'aprovada' and p_data between pr.inicio and pr.fim
            and pr.pais = (select pais from app.clientes where id = p_cliente)
            and not (pr.pais = 'PY' and app.produto_no_motor(p_produto))
          order by pr.desconto_pct desc limit 1)
  select case when promo.id is null then b.valor else app.arredondar_preco(b.valor * (1 - promo.desconto_pct / 100), b.moeda) end,
         b.valor, b.moeda, b.tabela, promo.id, promo.desconto_pct, promo.limite_qtd
    from base b left join promo on true
$$;

create or replace function app.preco_final_moeda(p_cliente uuid, p_produto uuid, p_moeda app.moeda, p_data date default current_date)
returns table (preco numeric, preco_tabela numeric, tabela text, promocao_id uuid, desconto_pct numeric, limite_qtd numeric)
language sql stable security definer set search_path = app, pg_temp as $$
  with base as (
    select pr.valor, pr.tabela from app.precos pr
     where pr.produto_id = p_produto and pr.tabela = app.tabela_para(p_cliente, p_moeda) and pr.vigente_desde <= p_data
     order by pr.vigente_desde desc limit 1),
  promo as (
    select pr.id, pr.desconto_pct, pr.limite_qtd from app.promocoes pr
     where pr.produto_id = p_produto and pr.status = 'aprovada' and p_data between pr.inicio and pr.fim
       and pr.pais = case when p_moeda = 'GS' then 'PY'::app.pais else 'BR'::app.pais end
       and not (p_moeda = 'GS' and app.produto_no_motor(p_produto))
     order by pr.desconto_pct desc limit 1)
  select case when promo.id is null then b.valor else app.arredondar_preco(b.valor * (1 - promo.desconto_pct / 100), p_moeda) end,
         b.valor, b.tabela, promo.id, promo.desconto_pct, promo.limite_qtd
    from base b left join promo on true
$$;

create or replace function app.vitrine_extras()
returns table (produto_id uuid, vendidos_90d numeric, promo_pct numeric, promo_pais app.pais, promo_fim date, destaque boolean)
language sql stable security definer set search_path = app, pg_temp as $$
  with vendas as (
    select c.produto_id, sum(c.quantidade) as qtd
      from app.pedido_itens i
      join app.pedidos p on p.id = i.pedido_id
      cross join lateral app.componentes(i.produto_id, i.quantidade) c
     where p.status_comercial <> 'cancelado' and p.data_pedido >= current_date - 90
     group by 1
    union all
    -- o kit também conta como vendido (além dos componentes)
    select i.produto_id, sum(i.quantidade) from app.pedido_itens i join app.pedidos p on p.id = i.pedido_id
      join app.produtos k on k.id = i.produto_id and k.tipo = 'kit'
     where p.status_comercial <> 'cancelado' and p.data_pedido >= current_date - 90 group by 1),
  promo as (
    select distinct on (pr.produto_id) pr.produto_id, pr.desconto_pct, pr.pais, pr.fim
      from app.promocoes pr
     where pr.status = 'aprovada' and current_date between pr.inicio and pr.fim
       and not (pr.pais = 'PY' and app.produto_no_motor(pr.produto_id))
     order by pr.produto_id, pr.desconto_pct desc)
  select p.id, coalesce((select sum(qtd) from vendas v where v.produto_id = p.id), 0),
         pm.desconto_pct, pm.pais, pm.fim, p.destaque
    from app.produtos p left join promo pm on pm.produto_id = p.id
   where p.ativo
     and (p.destaque or pm.produto_id is not null or exists (select 1 from vendas v where v.produto_id = p.id))
$$;
