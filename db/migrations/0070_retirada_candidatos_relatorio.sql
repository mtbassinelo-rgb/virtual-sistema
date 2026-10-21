-- =====================================================================
-- Retire em Foz: (4) sugestão automática de clientes locais e (5) relatório das retiradas.
-- =====================================================================

-- Cidades da região (perto do CD Foz), usadas para sugerir clientes locais.
create table if not exists app.retirada_foz_cidades (
  padrao text primary key check (length(trim(padrao)) between 2 and 60)
);
insert into app.retirada_foz_cidades (padrao) values
  ('ciudad del este'), ('cde'), ('hernandarias'), ('presidente franco'), ('pdte franco'), ('minga guazu'), ('foz'),
  ('santa rita'), ('los cedrales'), ('juan leon mallorquin'), ('itakyry'), ('san alberto')
on conflict do nothing;
alter table app.retirada_foz_cidades enable row level security;
create policy ler on app.retirada_foz_cidades for select using (true);
grant select on app.retirada_foz_cidades to vc_app;

-- (4) Clientes do Paraguai que ainda não são locais e parecem ser da região:
-- cidade da região e/ou já retiraram pedido em algum ponto. Ordenados pelo que compram (90 dias).
create or replace function app.candidatos_cliente_local()
returns table (cliente_id uuid, nome text, cidade text, vendedora text, cidade_regiao boolean, retiradas int,
               pedidos_90 int, caixas_90 numeric, vendido_90 numeric, sugerido boolean)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.e_gestao(), false) then raise exception 'Só gestão vê os candidatos a cliente local.'; end if;
  return query
  with base as (
    select c.id, c.nome, c.cidade, v.nome as vend, c.cliente_local_sugerido_em is not null as sug,
           exists (select 1 from app.retirada_foz_cidades rc
                    where lower(unaccent_safe(coalesce(c.cidade, ''))) ~ ('\m' || rc.padrao || '\M')) as regiao
      from app.clientes c join app.vendedoras v on v.id = c.vendedora_id
     where c.pais = 'PY' and not c.cliente_local and c.mesclado_em is null
  ), ret as (
    select p.cliente_id, count(*)::int as n from app.pedidos p
     where p.local_retirada is not null or p.retirada_foz group by p.cliente_id
  ), compras as (
    select p.cliente_id, count(distinct p.id)::int as ped, sum(p.valor_total) as vend,
           sum((select sum(i.quantidade / pr.unidades_caixa) from app.pedido_itens i join app.produtos pr on pr.id = i.produto_id
                 where i.pedido_id = p.id and pr.unidades_caixa > 0)) as cx
      from app.pedidos p
     where p.moeda = 'GS' and app.conta_como_venda(p.status_comercial) and p.data_pedido >= current_date - 90
     group by p.cliente_id
  )
  select b.id, b.nome, b.cidade, b.vend, b.regiao, coalesce(r.n, 0), coalesce(cp.ped, 0), round(coalesce(cp.cx, 0), 1), coalesce(cp.vend, 0), b.sug
    from base b left join ret r on r.cliente_id = b.id left join compras cp on cp.cliente_id = b.id
   where b.regiao or coalesce(r.n, 0) > 0
   order by (case when b.regiao then 1 else 0 end + case when coalesce(r.n, 0) > 0 then 2 else 0 end) desc, coalesce(cp.vend, 0) desc
   limit 60;
end $$;

-- Sem depender da extensão unaccent: tira acentos do português/espanhol
create or replace function app.unaccent_safe(t text) returns text language sql immutable as $$
  select translate(t, 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')
$$;

-- (5) Relatório das retiradas por mês: pedidos, caixas, desconto dado e pasero que a empresa deixou de pagar.
-- Saldo = pasero economizado − desconto (positivo: o incentivo se paga).
create or replace function app.relatorio_retirada_foz(p_inicio date, p_fim date)
returns table (mes text, pedidos int, clientes int, vendido numeric, caixas numeric, desconto numeric, pasero_economizado numeric, saldo numeric)
language plpgsql stable security definer set search_path = app, pg_temp as $$
#variable_conflict use_column
declare v_pasero numeric;
begin
  if not coalesce(app.e_gestao(), false) then raise exception 'Só gestão vê o relatório das retiradas.'; end if;
  select c.valor into v_pasero from app.custos_variaveis_vigentes('PY') c where c.tipo = 'entrega' and c.base = 'caixa';
  v_pasero := coalesce(v_pasero, app.param('retirada_foz_desconto_caixa'), 0);
  return query
  with ped as (
    select to_char(date_trunc('month', p.data_pedido), 'YYYY-MM') as m, p.id, p.cliente_id, p.valor_total, coalesce(p.retirada_foz_desconto, 0) as descv,
           coalesce((select sum(i.quantidade / pr.unidades_caixa) from app.pedido_itens i join app.produtos pr on pr.id = i.produto_id
                      where i.pedido_id = p.id and pr.unidades_caixa > 0), 0) as cx
      from app.pedidos p
     where p.retirada_foz and p.status_comercial <> 'cancelado' and p.data_pedido between p_inicio and p_fim
  )
  select ped.m, count(*)::int, count(distinct ped.cliente_id)::int, sum(ped.valor_total), round(sum(ped.cx), 1), sum(ped.descv),
         round(sum(ped.cx) * v_pasero), round(sum(ped.cx) * v_pasero) - sum(ped.descv)
    from ped group by ped.m order by ped.m desc;
end $$;

revoke execute on function app.candidatos_cliente_local(), app.relatorio_retirada_foz(date, date) from public;
grant execute on function app.candidatos_cliente_local(), app.relatorio_retirada_foz(date, date), app.unaccent_safe(text) to vc_app;
