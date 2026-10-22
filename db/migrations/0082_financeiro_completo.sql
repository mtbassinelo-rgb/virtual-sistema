-- =====================================================================
-- Financeiro completo:
--  1. Despesas fixas x variáveis (para o ponto de equilíbrio) e contas fixas que se repetem todo mês.
--  2. NF-e de entrada pelo XML: fornecedor pelo CNPJ, itens ligados aos produtos (EAN, código já usado
--     com o fornecedor), duplicatas viram contas a pagar ligadas à nota. O estoque sobe ao receber a nota.
--  3. Metas da empresa por mês: vendas, compras e lucro.
--  4. Itens vendidos em R$ (para lucro por marca/cliente e ponto de equilíbrio consolidados).
-- =====================================================================

-- 1. Fixa ou variável -------------------------------------------------
alter table app.despesa_categorias add column tipo text not null default 'fixa' check (tipo in ('fixa', 'variavel'));
update app.despesa_categorias set tipo = 'variavel' where codigo in ('mercadoria', 'comissoes', 'transportadora', 'passeiro', 'impostos');
comment on column app.despesa_categorias.tipo is 'fixa: não muda com as vendas (aluguel, salários). variavel: acompanha as vendas (comissão, frete, passeiro, impostos).';

create table app.despesas_recorrentes (
  id             uuid primary key default gen_random_uuid(),
  categoria      text not null references app.despesa_categorias(codigo),
  descricao      text not null check (length(trim(descricao)) between 1 and 200),
  fornecedor     text check (length(fornecedor) <= 120),
  moeda          app.moeda not null,
  valor          numeric(14,2) not null check (valor > 0),
  dia_vencimento int not null check (dia_vencimento between 1 and 28),
  inicio         date not null default date_trunc('month', current_date)::date,
  fim            date,
  ativo          boolean not null default true,
  criado_por     uuid references app.usuarios(id),
  criado_em      timestamptz not null default now()
);
comment on table app.despesas_recorrentes is 'Contas fixas (aluguel, salários, internet...): o sistema lança a conta de cada mês sozinho.';

alter table app.despesas
  add column compra_id uuid references app.compras(id) on delete set null,
  add column recorrente_id uuid references app.despesas_recorrentes(id) on delete set null;
create index on app.despesas (compra_id);
create unique index despesas_recorrente_mes on app.despesas (recorrente_id, competencia) where recorrente_id is not null;

alter table app.despesas_recorrentes enable row level security;
create policy ler on app.despesas_recorrentes for select using (app.e_gestao());
create policy gerir on app.despesas_recorrentes for all using (app.pode_gerir()) with check (app.pode_gerir());
grant select, insert, update, delete on app.despesas_recorrentes to vc_app;
create trigger auditar after insert or update or delete on app.despesas_recorrentes for each row execute function app.auditar('id');

-- Lança as contas fixas do mês que ainda não foram lançadas (pode rodar quantas vezes quiser)
create or replace function app.gerar_despesas_recorrentes(p_mes date) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_mes date := date_trunc('month', coalesce(p_mes, current_date))::date; n int;
begin
  if not coalesce(app.pode_gerir(), false) then return 0; end if;
  insert into app.despesas (categoria, descricao, fornecedor, moeda, valor, competencia, vencimento, recorrente_id)
  select r.categoria, r.descricao, r.fornecedor, r.moeda, r.valor, v_mes,
         make_date(extract(year from v_mes)::int, extract(month from v_mes)::int, r.dia_vencimento), r.id
    from app.despesas_recorrentes r
   where r.ativo and date_trunc('month', r.inicio) <= v_mes and (r.fim is null or r.fim >= v_mes)
  on conflict (recorrente_id, competencia) where recorrente_id is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- 2. NF-e de entrada pelo XML -----------------------------------------
alter table app.fornecedores add column cnpj text check (cnpj ~ '^[0-9]{14}$');
create unique index fornecedores_cnpj on app.fornecedores (cnpj) where cnpj is not null;
alter table app.compras
  add column chave_nfe text check (chave_nfe ~ '^[0-9]{44}$'),
  add column valor_nota numeric(14,2) check (valor_nota >= 0);
create unique index compras_chave_nfe on app.compras (chave_nfe) where chave_nfe is not null;
alter table app.compra_itens
  add column ean text check (length(ean) <= 20),
  add column unidade_nota text check (length(unidade_nota) <= 10);

-- p: {fornecedor:{cnpj,nome}, numero, chave, data, marca, frete, desconto, valor_produtos, valor_nota, cambio,
--     itens:[{codigo, ean, unidade, descricao, quantidade, valor_unit, produto_id}],
--     duplicatas:[{numero, vencimento, valor}], gerar_contas, prazo_dias}
create or replace function app.importar_nfe(p jsonb) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_forn uuid; v_cnpj text := nullif(regexp_replace(coalesce(p #>> '{fornecedor,cnpj}', ''), '\D', '', 'g'), '');
        v_nome text := left(trim(coalesce(p #>> '{fornecedor,nome}', '')), 120); v_id uuid; v_pct numeric; v_prod numeric;
        v_chave text := nullif(regexp_replace(coalesce(p->>'chave', ''), '\D', '', 'g'), ''); v_num text := nullif(trim(p->>'numero'), '');
        v_data date := (p->>'data')::date; d jsonb; k int := 0; n int; v_total numeric;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono importa notas.'; end if;
  if v_chave is not null and exists (select 1 from app.compras where chave_nfe = v_chave) then
    raise exception 'A nota % já foi importada.', coalesce(v_num, v_chave);
  end if;
  if v_nome = '' and v_cnpj is null then raise exception 'A nota não tem o fornecedor (emitente).'; end if;
  -- fornecedor: pelo CNPJ; senão pelo nome (e grava o CNPJ); senão cria
  select id into v_forn from app.fornecedores where cnpj = v_cnpj;
  if v_forn is null and v_nome <> '' then
    select id into v_forn from app.fornecedores where lower(nome) = lower(v_nome) and (cnpj is null or cnpj = v_cnpj) limit 1;
    if v_forn is not null and v_cnpj is not null then update app.fornecedores set cnpj = v_cnpj where id = v_forn; end if;
  end if;
  if v_forn is null then
    insert into app.fornecedores (nome, cnpj) values (coalesce(nullif(v_nome, ''), 'CNPJ ' || v_cnpj), v_cnpj) returning id into v_forn;
  end if;
  v_prod := coalesce((p->>'valor_produtos')::numeric, 0);
  v_pct := case when v_prod > 0 then round(least(coalesce((p->>'desconto')::numeric, 0) / v_prod * 100, 99), 2) else 0 end;
  v_id := app.lancar_nota(v_forn, v_data, v_num, p->>'marca', coalesce((p->>'frete')::numeric, 0), v_pct,
                          nullif(p->>'cambio', '')::numeric, p->'itens', 'Importada do XML da NF-e');
  update app.compras set chave_nfe = v_chave, valor_nota = (p->>'valor_nota')::numeric where id = v_id;
  -- EAN e unidade da nota em cada item (mesma ordem)
  update app.compra_itens ci set ean = nullif(left(x.e->>'ean', 20), ''), unidade_nota = nullif(left(x.e->>'unidade', 10), '')
    from jsonb_array_elements(p->'itens') with ordinality as x(e, ord)
   where ci.compra_id = v_id and ci.ordem = x.ord;
  -- itens ainda sem produto: pelo EAN do cadastro, depois pelo código já ligado antes com este fornecedor
  update app.compra_itens ci set produto_id = (select pr.id from app.produtos pr where pr.gtin = ci.ean order by pr.ativo desc limit 1)
   where ci.compra_id = v_id and ci.produto_id is null and ci.ean is not null;
  update app.compra_itens ci set produto_id = (
           select ant.produto_id from app.compra_itens ant join app.compras c on c.id = ant.compra_id
            where c.fornecedor_id = v_forn and ant.codigo_nota = ci.codigo_nota and ant.produto_id is not null and ant.compra_id <> v_id
            order by c.data desc limit 1)
   where ci.compra_id = v_id and ci.produto_id is null and ci.codigo_nota is not null;
  -- contas a pagar
  if coalesce((p->>'gerar_contas')::boolean, true) then
    n := coalesce(jsonb_array_length(p->'duplicatas'), 0);
    v_total := coalesce((p->>'valor_nota')::numeric, v_prod);
    if n > 0 then
      for d in select * from jsonb_array_elements(p->'duplicatas') loop
        k := k + 1;
        insert into app.despesas (categoria, descricao, fornecedor, moeda, valor, competencia, vencimento, documento, compra_id)
        values ('mercadoria', left(format('NF %s %s (%s/%s)', coalesce(v_num, ''), v_nome, k, n), 200), left(v_nome, 120), 'BRL',
                (d->>'valor')::numeric, (d->>'vencimento')::date, (d->>'vencimento')::date,
                left(format('NF %s dup %s', coalesce(v_num, ''), coalesce(d->>'numero', k::text)), 80), v_id);
      end loop;
    elsif v_total > 0 then
      insert into app.despesas (categoria, descricao, fornecedor, moeda, valor, competencia, vencimento, documento, compra_id)
      values ('mercadoria', left(format('NF %s %s', coalesce(v_num, ''), v_nome), 200), left(v_nome, 120), 'BRL', v_total,
              v_data + coalesce((p->>'prazo_dias')::int, 30), v_data + coalesce((p->>'prazo_dias')::int, 30),
              left(format('NF %s', coalesce(v_num, '')), 80), v_id);
    end if;
  end if;
  return v_id;
end $$;

-- 3. Metas da empresa ---------------------------------------------------
create table app.metas_empresa (
  mes           date primary key check (extract(day from mes) = 1),
  vendas_brl    numeric(14,2) check (vendas_brl >= 0),
  vendas_gs     numeric(16,0) check (vendas_gs >= 0),
  compras_brl   numeric(14,2) check (compras_brl >= 0),
  lucro_brl     numeric(14,2),
  observacao    text check (length(observacao) <= 300),
  definido_por  uuid references app.usuarios(id),
  definido_em   timestamptz not null default now()
);
comment on table app.metas_empresa is 'Metas do mês: vender (R$ e Gs), teto de compras (R$) e lucro (R$).';
alter table app.metas_empresa enable row level security;
create policy ler on app.metas_empresa for select using (app.e_gestao());
grant select on app.metas_empresa to vc_app;
create trigger auditar after insert or update or delete on app.metas_empresa for each row execute function app.auditar('mes');

create or replace function app.salvar_meta_empresa(p_mes date, p_vendas_brl numeric, p_vendas_gs numeric, p_compras_brl numeric,
  p_lucro_brl numeric, p_obs text default null) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono define as metas.'; end if;
  insert into app.metas_empresa (mes, vendas_brl, vendas_gs, compras_brl, lucro_brl, observacao, definido_por)
  values (date_trunc('month', p_mes)::date, p_vendas_brl, p_vendas_gs, p_compras_brl, p_lucro_brl, nullif(trim(p_obs), ''), app.uid())
  on conflict (mes) do update set vendas_brl = excluded.vendas_brl, vendas_gs = excluded.vendas_gs, compras_brl = excluded.compras_brl,
     lucro_brl = excluded.lucro_brl, observacao = excluded.observacao, definido_por = excluded.definido_por, definido_em = now();
end $$;

-- 4. Itens vendidos em R$ (Gs convertido pelo câmbio de custo congelado no item) ---------------------
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
   where app.conta_como_venda(p.status_comercial) and p.data_pedido between p_inicio and p_fim;
end $$;

revoke execute on function app.gerar_despesas_recorrentes(date), app.importar_nfe(jsonb),
  app.salvar_meta_empresa(date, numeric, numeric, numeric, numeric, text), app.fin_itens(date, date) from public;
grant execute on function app.gerar_despesas_recorrentes(date), app.importar_nfe(jsonb),
  app.salvar_meta_empresa(date, numeric, numeric, numeric, numeric, text), app.fin_itens(date, date) to vc_app;
