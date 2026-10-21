-- =====================================================================
-- Notas a chegar: a nota do fornecedor é lançada antes da mercadoria chegar (não mexe no estoque).
-- Cada item é ligado a um produto que JÁ EXISTE (nunca cria produto). Quando chega, o gerente confirma:
-- sobe o estoque dos itens ligados no depósito escolhido e o frete da nota entra na média da marca.
-- =====================================================================
alter table app.compras
  add column status text not null default 'recebida' check (status in ('a_caminho','recebida')),
  add column deposito_id uuid references app.depositos(id),
  add column desconto_pct numeric(5,2) check (desconto_pct between 0 and 100),
  add column recebida_em timestamptz,
  add column recebida_por uuid references app.usuarios(id);

create table app.compra_itens (
  id            uuid primary key default gen_random_uuid(),
  compra_id     uuid not null references app.compras(id) on delete cascade,
  ordem         int not null,
  codigo_nota   text check (length(codigo_nota) <= 40),
  descricao     text not null check (length(descricao) between 1 and 200),
  quantidade    numeric(12,3) not null check (quantidade > 0),
  valor_unit    numeric(14,4) check (valor_unit >= 0),
  custo_unit    numeric(14,4) check (custo_unit >= 0),
  produto_id    uuid references app.produtos(id)
);
comment on column app.compra_itens.custo_unit is 'Valor unitário da nota já com o desconto da nota (R$).';
create index on app.compra_itens (compra_id);

-- Frete médio por marca: só notas que já chegaram
create or replace function app.frete_medio_notas()
returns table (marca text, notas int, unidades bigint, frete_total numeric, frete_unidade numeric, ultima date)
language sql stable security definer set search_path = app, pg_temp as $$
  select x.marca, count(*)::int, sum(x.unidades), sum(x.frete), round(sum(x.frete) / nullif(sum(x.unidades), 0), 4), max(x.data)
    from (select c.*, row_number() over (partition by c.marca order by c.data desc, c.criado_em desc) as ord
            from app.compras c where c.marca is not null and c.unidades is not null and c.status = 'recebida') x
   where x.ord <= greatest(1, coalesce(app.param('frete_media_notas'), 5))::int
   group by x.marca
$$;

-- Lança a nota (a caminho). itens: [{codigo, descricao, quantidade, valor_unit, produto_id}]
create or replace function app.lancar_nota(p_fornecedor uuid, p_data date, p_nfe text, p_marca text, p_frete numeric,
  p_desconto_pct numeric, p_cambio numeric, p_itens jsonb, p_observacao text default null)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id uuid; i jsonb; k int := 0; v_tot numeric := 0; v_un numeric := 0; v_desc numeric := coalesce(p_desconto_pct, 0) / 100;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono lança notas.'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'A nota não tem itens.'; end if;
  if nullif(trim(p_marca), '') is null then raise exception 'Informe a marca da nota (para o frete por produto).'; end if;
  if p_data is null or p_data > current_date + 1 then raise exception 'Data da nota inválida.'; end if;
  if coalesce(p_desconto_pct, 0) < 0 or coalesce(p_desconto_pct, 0) >= 100 then raise exception 'Desconto da nota inválido.'; end if;
  for i in select * from jsonb_array_elements(p_itens) loop
    v_tot := v_tot + (i->>'quantidade')::numeric * coalesce((i->>'valor_unit')::numeric, 0);
    v_un := v_un + (i->>'quantidade')::numeric;
  end loop;
  insert into app.compras (fornecedor_id, data, valor_produtos, frete, cambio, observacao, criado_por, marca, unidades, nfe, status, desconto_pct)
  values (p_fornecedor, p_data, greatest(round(v_tot * (1 - v_desc), 2), 0.01), coalesce(p_frete, 0), p_cambio, nullif(trim(p_observacao), ''), app.uid(),
          trim(p_marca), ceil(v_un)::int, nullif(trim(p_nfe), ''), 'a_caminho', p_desconto_pct)
  returning id into v_id;
  for i in select * from jsonb_array_elements(p_itens) loop
    k := k + 1;
    insert into app.compra_itens (compra_id, ordem, codigo_nota, descricao, quantidade, valor_unit, custo_unit, produto_id)
    values (v_id, k, nullif(trim(i->>'codigo'), ''), left(trim(i->>'descricao'), 200), (i->>'quantidade')::numeric,
            (i->>'valor_unit')::numeric, round((i->>'valor_unit')::numeric * (1 - v_desc), 4),
            (select id from app.produtos where id = nullif(i->>'produto_id', '')::uuid));
  end loop;
  return v_id;
end $$;

create or replace function app.ligar_item_nota(p_item uuid, p_produto uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono altera a nota.'; end if;
  update app.compra_itens i set produto_id = p_produto
    from app.compras c where c.id = i.compra_id and i.id = p_item and c.status = 'a_caminho';
  if not found then raise exception 'Item não encontrado ou nota já recebida.'; end if;
end $$;

-- Chegou: sobe o estoque dos itens ligados e marca a nota como recebida (o frete entra na média pela trigger)
create or replace function app.receber_nota(p_compra uuid, p_deposito uuid, p_atualizar_custo boolean default false)
returns jsonb language plpgsql security definer set search_path = app, pg_temp as $$
declare c record; v_itens jsonb; n int; v_sem int; v_ref text;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono confirma a chegada.'; end if;
  select * into c from app.compras where id = p_compra for update;
  if not found then raise exception 'Nota não encontrada.'; end if;
  if c.status <> 'a_caminho' then raise exception 'Esta nota já foi recebida.'; end if;
  select jsonb_agg(jsonb_build_object('produto_id', produto_id, 'quantidade', q)) into v_itens
    from (select produto_id, sum(quantidade) q from app.compra_itens where compra_id = p_compra and produto_id is not null group by produto_id) s;
  select count(*) into v_sem from app.compra_itens where compra_id = p_compra and produto_id is null;
  if v_itens is null then raise exception 'Nenhum item da nota está ligado a um produto.'; end if;
  v_ref := 'NF ' || coalesce(c.nfe, left(p_compra::text, 8));
  n := app.entrada_compra(p_deposito, v_itens, v_ref, 'Nota a chegar recebida');
  if p_atualizar_custo then
    update app.produtos p set custo_unitario_brl = s.custo, custo_origem = left('Nota ' || v_ref, 120), custo_atualizado_em = now()
      from (select produto_id, round(sum(custo_unit * quantidade) / sum(quantidade), 4) custo from app.compra_itens
             where compra_id = p_compra and produto_id is not null and custo_unit is not null group by produto_id) s
     where p.id = s.produto_id;
  end if;
  update app.compras set status = 'recebida', deposito_id = p_deposito, recebida_em = now(), recebida_por = app.uid() where id = p_compra;
  return jsonb_build_object('produtos', n, 'sem_produto', v_sem);
end $$;

alter table app.compra_itens enable row level security;
create policy ler on app.compra_itens for select using (app.e_gestao());
grant select on app.compra_itens to vc_app;
create trigger auditar after insert or update or delete on app.compra_itens for each row execute function app.auditar('id');

revoke execute on function app.lancar_nota(uuid, date, text, text, numeric, numeric, numeric, jsonb, text), app.ligar_item_nota(uuid, uuid),
  app.receber_nota(uuid, uuid, boolean) from public;
grant execute on function app.lancar_nota(uuid, date, text, text, numeric, numeric, numeric, jsonb, text), app.ligar_item_nota(uuid, uuid),
  app.receber_nota(uuid, uuid, boolean) to vc_app;
