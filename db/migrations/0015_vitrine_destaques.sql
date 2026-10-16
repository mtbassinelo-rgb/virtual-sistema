-- Vitrine: destaques escolhidos pela gestão, mais vendidos e promoções em vigor (sem revelar preços).

alter table app.produtos add column destaque boolean not null default false;

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
     order by pr.produto_id, pr.desconto_pct desc)
  select p.id, coalesce((select sum(qtd) from vendas v where v.produto_id = p.id), 0),
         pm.desconto_pct, pm.pais, pm.fim, p.destaque
    from app.produtos p left join promo pm on pm.produto_id = p.id
   where p.ativo
     and (p.destaque or pm.produto_id is not null or exists (select 1 from vendas v where v.produto_id = p.id))
$$;
grant execute on function app.vitrine_extras() to vc_app;

create or replace function app.definir_destaque(p_id uuid, p_destaque boolean) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono escolhe os destaques.' using errcode = 'insufficient_privilege';
  end if;
  update app.produtos set destaque = coalesce(p_destaque, false) where id = p_id;
end $$;
grant execute on function app.definir_destaque(uuid, boolean) to vc_app;
