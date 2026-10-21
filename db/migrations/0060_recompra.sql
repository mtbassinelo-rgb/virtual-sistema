-- =====================================================================
-- Recompra: quem chamar esta semana.
-- Para cada cliente: intervalo normal de compra, dias desde a última, atraso, situação e o que costuma levar.
-- A vendedora vê só os clientes dela; a gestão vê todos. Só leitura.
--
-- Situação (pela ordem):
--   novo        1 pedido, há menos de recompra_novo_dias
--   inativo     sem comprar há recompra_inativo_dias ou mais
--   em_risco    passou de 2× o intervalo normal
--   atrasado    passou do intervalo normal + tolerância
--   em_dia      dentro do intervalo
--   recuperado  (marca extra) voltou a comprar depois de ficar inativo
-- =====================================================================

insert into app.parametros (chave, valor, descricao) values
  ('recompra_intervalo_padrao', 30, 'Recompra: intervalo esperado (dias) para quem tem um pedido só'),
  ('recompra_tolerancia_pct', 20, 'Recompra: atrasado = passou do intervalo normal mais N%'),
  ('recompra_inativo_dias', 120, 'Recompra: sem comprar há N dias = inativo'),
  ('recompra_novo_dias', 60, 'Recompra: primeiro pedido há menos de N dias = cliente novo')
on conflict (chave) do nothing;

create or replace function app.recompra_clientes()
returns table (cliente_id uuid, nome text, whatsapp text, pais text, vendedora_id uuid, vendedora text, moeda app.moeda,
               pedidos int, primeira date, ultima date, intervalo_dias int, dias_desde int, atraso_dias int,
               valor_medio numeric, total_12m numeric, situacao text, recuperado boolean, alto_valor boolean,
               produtos text[], ultimo_contato timestamptz)
language plpgsql stable security definer set search_path = app, pg_temp as $$
#variable_conflict use_column
declare v_padrao numeric := coalesce(app.param('recompra_intervalo_padrao'), 30);
        v_tol numeric := 1 + coalesce(app.param('recompra_tolerancia_pct'), 20) / 100;
        v_inativo int := coalesce(app.param('recompra_inativo_dias'), 120)::int;
        v_novo int := coalesce(app.param('recompra_novo_dias'), 60)::int;
begin
  if app.uid() is null then raise exception 'Usuário não identificado.'; end if;
  return query
  with ped as (
    select p.id, p.cliente_id, p.data_pedido, p.valor_total, p.moeda,
           lag(p.data_pedido) over (partition by p.cliente_id order by p.data_pedido, p.id) as anterior
      from app.pedidos p
      join app.clientes c on c.id = p.cliente_id and c.mesclado_em is null
     where app.conta_como_venda(p.status_comercial) and coalesce(app.ve_pedido(c.vendedora_id), false)
  ), base as (
    select pd.cliente_id, count(*)::int as n, min(pd.data_pedido) as prim, max(pd.data_pedido) as ult,
           count(*) filter (where pd.data_pedido > current_date - 365)::int as n12,
           min(pd.data_pedido) filter (where pd.data_pedido > current_date - 365) as prim12,
           avg(pd.valor_total) filter (where pd.data_pedido > current_date - 365) as medio,
           coalesce(sum(pd.valor_total) filter (where pd.data_pedido > current_date - 365), 0) as tot12,
           (array_agg(pd.moeda order by pd.data_pedido desc))[1] as moe,
           (array_agg(pd.data_pedido - pd.anterior order by pd.data_pedido desc))[1] as ultimo_gap
      from ped pd group by pd.cliente_id
  ), calc as (
    select b.*,
           case when b.n12 >= 2 then greatest(1, round((b.ult - b.prim12)::numeric / (b.n12 - 1))) else v_padrao end::int as intervalo,
           (current_date - b.ult)::int as desde
      from base b
  ), rank_valor as (
    select cl.cliente_id, percent_rank() over (order by cl.tot12 desc) as pr from calc cl where cl.tot12 > 0
  ), habituais as (
    select x.cliente_id, array_agg(x.prod order by x.vezes desc, x.prod) filter (where x.ord <= 5) as prods
      from (select p.cliente_id, coalesce(pr.nome, i.descricao) as prod, count(distinct p.id) as vezes,
                   row_number() over (partition by p.cliente_id order by count(distinct p.id) desc, coalesce(pr.nome, i.descricao)) as ord
              from ped p join app.pedido_itens i on i.pedido_id = p.id left join app.produtos pr on pr.id = i.produto_id
             where p.data_pedido > current_date - 365
             group by p.cliente_id, coalesce(pr.nome, i.descricao)) x
     group by x.cliente_id
  )
  select c.id, c.nome, coalesce(c.whatsapp, c.telefone), c.pais::text, c.vendedora_id, v.nome, k.moe,
         k.n, k.prim, k.ult, k.intervalo, k.desde, greatest(0, k.desde - k.intervalo),
         round(k.medio, 2), k.tot12,
         case
           when k.n = 1 and k.desde < v_novo then 'novo'
           when k.desde >= v_inativo then 'inativo'
           when k.desde > 2 * k.intervalo then 'em_risco'
           when k.desde > k.intervalo * v_tol then 'atrasado'
           else 'em_dia'
         end,
         (k.desde <= 30 and coalesce(k.ultimo_gap, 0) >= v_inativo),
         coalesce(rv.pr <= 0.2, false),
         coalesce(h.prods, '{}'),
         (select max(a.em) from app.atendimentos a where a.cliente_id = c.id)
    from calc k
    join app.clientes c on c.id = k.cliente_id
    join app.vendedoras v on v.id = c.vendedora_id
    left join rank_valor rv on rv.cliente_id = k.cliente_id
    left join habituais h on h.cliente_id = k.cliente_id;
end $$;

revoke execute on function app.recompra_clientes() from public;
grant execute on function app.recompra_clientes() to vc_app;
