-- =====================================================================
-- Vendas avulsas: vendas feitas fora do sistema (ex.: antes do sistema novo),
-- lançadas só pelo valor, por unidade e data. Não mexem em estoque nem em cliente.
-- Entram no "Vendido no mês", no painel das unidades e no financeiro (fin_itens).
-- Custo é opcional: sem custo, a venda conta no faturamento mas fica fora do lucro.
-- =====================================================================

create table app.vendas_avulsas (
  id uuid primary key default gen_random_uuid(),
  deposito_id uuid not null references app.depositos(id),
  data date not null,
  moeda app.moeda not null default 'GS',
  valor numeric(16,2) not null check (valor > 0),
  cambio numeric(12,4) not null check (cambio > 0),
  custo_brl numeric(14,2) check (custo_brl >= 0),
  descricao text not null check (length(trim(descricao)) between 1 and 300),
  criado_por uuid references app.usuarios(id),
  criado_em timestamptz not null default now()
);
create index vendas_avulsas_data on app.vendas_avulsas (data);
comment on table app.vendas_avulsas is 'Vendas lançadas só pelo valor (fora do sistema). Sem estoque e sem cliente.';

create or replace function app.lancar_venda_avulsa(p_deposito uuid, p_data date, p_moeda app.moeda, p_valor numeric,
  p_descricao text, p_custo_brl numeric default null) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id uuid;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono lança venda avulsa.'; end if;
  if p_deposito is null or not exists (select 1 from app.depositos where id = p_deposito) then raise exception 'Escolha a unidade.'; end if;
  if p_data is null or p_data > current_date then raise exception 'Data inválida.'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor.'; end if;
  if nullif(trim(p_descricao), '') is null then raise exception 'Descreva a venda (ex.: vendas de 01 a 21/10 pelos comprovantes).'; end if;
  insert into app.vendas_avulsas (deposito_id, data, moeda, valor, cambio, custo_brl, descricao, criado_por)
  values (p_deposito, p_data, coalesce(p_moeda, 'GS'), p_valor, coalesce(app.param('cambio_custo_gs'), 1300), p_custo_brl, trim(p_descricao), app.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.excluir_venda_avulsa(p_id uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono exclui venda avulsa.'; end if;
  delete from app.vendas_avulsas where id = p_id;
  if not found then raise exception 'Venda avulsa não encontrada.'; end if;
end $$;

-- fin_itens passa a trazer também as vendas avulsas (sem pedido, sem cliente, marca "Venda avulsa")
create or replace function app.fin_itens(p_inicio date, p_fim date)
returns table (data_pedido date, moeda app.moeda, pedido_id uuid, cliente_id uuid, vendedora_id uuid, produto_id uuid, marca text,
               receita numeric, receita_brl numeric, custo_brl numeric)
language plpgsql stable security definer set search_path = app, pg_temp as $$
declare v_cambio numeric := coalesce(app.param('cambio_custo_gs'), 1300);
begin
  if not coalesce(app.e_gestao(), false) then raise exception 'Só gestão vê o financeiro.'; end if;
  return query
  select p.data_pedido, p.moeda, p.id, p.cliente_id, p.vendedora_id, i.produto_id, coalesce(nullif(trim(pr.marca), ''), 'Sem marca'),
         i.total,
         round(case when p.moeda = 'GS' then i.total / coalesce(i.cambio_custo, v_cambio) else i.total end, 2),
         round(i.quantidade * i.custo_unitario_brl, 2)
    from app.pedido_itens i
    join app.pedidos p on p.id = i.pedido_id
    left join app.produtos pr on pr.id = i.produto_id
   where app.conta_como_venda(p.status_comercial) and p.data_pedido between p_inicio and p_fim
  union all
  select a.data, a.moeda, null::uuid, null::uuid, null::uuid, null::uuid, 'Venda avulsa'::text,
         a.valor, round(case when a.moeda = 'GS' then a.valor / a.cambio else a.valor end, 2), a.custo_brl
    from app.vendas_avulsas a
   where a.data between p_inicio and p_fim;
end $$;

create trigger auditar after insert or update or delete on app.vendas_avulsas for each row execute function app.auditar('id');

alter table app.vendas_avulsas enable row level security;
create policy ler on app.vendas_avulsas for select using (app.e_gestao());
grant select on app.vendas_avulsas to vc_app;

revoke execute on function app.lancar_venda_avulsa(uuid, date, app.moeda, numeric, text, numeric), app.excluir_venda_avulsa(uuid) from public;
grant execute on function app.lancar_venda_avulsa(uuid, date, app.moeda, numeric, text, numeric), app.excluir_venda_avulsa(uuid) to vc_app;

-- Lançamento das vendas de outubro/2026 feitas antes do sistema novo (01 a 21/10),
-- somadas pelos comprovantes dos grupos de WhatsApp. Só em produção (onde já há pedidos do sistema novo).
insert into app.vendas_avulsas (deposito_id, data, moeda, valor, cambio, descricao)
select d.id, date '2026-10-21', 'GS', v.valor, coalesce(app.param('cambio_custo_gs'), 1300), v.descr
  from (values
    ('cd-foz',   87515500::numeric, 'Vendas de 01 a 21/10 fora do sistema — soma dos comprovantes do grupo COMPROBANTES COSMÉTICOS'),
    ('loja-cde', 39949000::numeric, 'Vendas de 01 a 21/10 fora do sistema — soma dos comprovantes do grupo Comprobantes: Top Salon')
  ) v(codigo, valor, descr)
  join app.depositos d on d.codigo = v.codigo
 where exists (select 1 from app.pedidos where data_pedido between date '2026-10-22' and date '2026-10-31')
   and not exists (select 1 from app.vendas_avulsas);
