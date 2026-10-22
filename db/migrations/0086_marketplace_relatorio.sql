-- =====================================================================
-- Vendas da Shopee e do Mercado Livre pelo relatório (planilha) do marketplace:
-- cada pedido do relatório vira um pedido do canal no sistema (entra no lucro e no financeiro) e dá baixa
-- no estoque da unidade (kits saem pelos componentes). SKU sem cadastro vai para as pendências do estoque.
-- O mesmo pedido nunca entra duas vezes (canal + número do pedido), inclusive se já veio pelo Bling.
-- =====================================================================
create table app.marketplace_importacoes (
  id          uuid primary key default gen_random_uuid(),
  canal       text not null references app.canais(codigo),
  deposito_id uuid not null references app.depositos(id),
  arquivo     text check (length(arquivo) <= 200),
  pedidos     int not null default 0,
  repetidos   int not null default 0,
  itens       int not null default 0,
  sem_sku     int not null default 0,
  total       numeric(14,2) not null default 0,
  criado_por  uuid references app.usuarios(id),
  criado_em   timestamptz not null default now()
);
alter table app.marketplace_importacoes enable row level security;
create policy ler on app.marketplace_importacoes for select using (app.e_gestao() or app.pode_operar_deposito(deposito_id));
grant select on app.marketplace_importacoes to vc_app;
create index on app.pedidos (canal, numero_externo) where numero_externo is not null;

-- p_pedidos: [{pedido, data, taxa, itens:[{sku, quantidade, valor, descricao}]}] (valor = preço unitário em R$)
create or replace function app.lancar_vendas_marketplace(p_canal text, p_deposito uuid, p_pedidos jsonb, p_arquivo text default null)
returns jsonb language plpgsql security definer set search_path = app, pg_temp as $$
declare v_can app.canais; v_vend uuid; p jsonb; it jsonb; v_itens_ok jsonb; v_estimado boolean; v_ped uuid; v_ref text; v_tot numeric; v_novos int := 0; v_rep int := 0; v_itens int := 0;
        v_sem_total int := 0; v_total numeric := 0; v_data date;
begin
  if not (coalesce(app.pode_gerir(), false) or app.pode_operar_deposito(p_deposito)) then
    raise exception 'Só gerente, dono ou quem opera o estoque da unidade lança vendas de marketplace.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_can from app.canais where codigo = p_canal and marketplace;
  if v_can.codigo is null then raise exception 'Canal de marketplace desconhecido.'; end if;
  v_vend := coalesce(v_can.vendedora_id, (select id from app.vendedoras where nome = 'Marketplace' limit 1));
  if v_vend is null then raise exception 'Cadastre a vendedora "Marketplace" para os pedidos dos canais.'; end if;
  if jsonb_typeof(p_pedidos) <> 'array' or jsonb_array_length(p_pedidos) = 0 then raise exception 'O relatório não tem pedidos.'; end if;
  for p in select * from jsonb_array_elements(p_pedidos) loop
    v_ref := nullif(left(trim(coalesce(p->>'pedido', '')), 60), '');
    if v_ref is null then raise exception 'Pedido sem número no relatório.'; end if;
    if exists (select 1 from app.pedidos where canal = p_canal and numero_externo = v_ref) then v_rep := v_rep + 1; continue; end if;
    v_data := coalesce(nullif(p->>'data', '')::date, current_date);
    -- sem preço no relatório: estima pelo preço Brasil Normal do produto (fica anotado no pedido)
    select jsonb_agg(jsonb_build_object('codigo', i->>'sku', 'quantidade', i->>'quantidade', 'descricao', i->>'descricao',
             'valor', coalesce(nullif(i->>'valor', '')::numeric,
                               (select z.valor from app.precos z where z.produto_id = app.produto_por_codigo(i->>'sku') and z.tabela = 'br_normal'
                                  and z.vigente_desde <= current_date order by z.vigente_desde desc limit 1), 0))),
           bool_or(nullif(i->>'valor', '') is null)
      into v_itens_ok, v_estimado from jsonb_array_elements(p->'itens') i;
    select coalesce(sum((i->>'quantidade')::numeric * (i->>'valor')::numeric), 0) into v_tot from jsonb_array_elements(v_itens_ok) i;
    insert into app.pedidos (origem, canal, numero_externo, vendedora_id, data_pedido, moeda, valor_total, status_comercial, deposito_id,
                             taxa_marketplace, repasse_previsto, entregue_em, enviado_em, observacoes, criado_por)
    values ('planilha', p_canal, v_ref, v_vend, v_data, 'BRL', round(v_tot, 2), 'entregue', p_deposito,
            nullif(p->>'taxa', '')::numeric, case when nullif(p->>'taxa', '') is not null then round(v_tot - (p->>'taxa')::numeric, 2) end,
            v_data, v_data, left('Relatório ' || v_can.nome || coalesce(' · ' || p_arquivo, '') || case when v_estimado then ' · valor estimado pelo preço Brasil Normal' else '' end, 300), app.uid())
    returning id into v_ped;
    perform app.baixar_pedido_marketplace(v_ped, v_itens_ok);
    -- itens sem cadastro não viram item do pedido: o total fica com o relatório
    update app.pedidos set valor_total = greatest(round(v_tot, 2), 0) where id = v_ped;
    v_sem_total := v_sem_total + (select count(*) from app.estoque_pendencias where pedido_id = v_ped and tipo = 'sku_desconhecido');
    v_itens := v_itens + jsonb_array_length(p->'itens');
    v_novos := v_novos + 1; v_total := v_total + v_tot;
  end loop;
  insert into app.marketplace_importacoes (canal, deposito_id, arquivo, pedidos, repetidos, itens, sem_sku, total, criado_por)
  values (p_canal, p_deposito, left(p_arquivo, 200), v_novos, v_rep, v_itens, v_sem_total, round(v_total, 2), app.uid());
  return jsonb_build_object('novos', v_novos, 'repetidos', v_rep, 'itens', v_itens, 'sem_sku', v_sem_total, 'total', round(v_total, 2));
end $$;

-- Ligar um SKU do marketplace a um produto: vale para as próximas importações e resolve as pendências desse SKU
-- (o item entra no pedido e o estoque sai agora). Devolve quantas pendências foram resolvidas.
create or replace function app.ligar_sku(p_codigo text, p_produto uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare pe record; c record; n int := 0;
begin
  if not (coalesce(app.pode_gerir(), false) or exists (select 1 from app.deposito_responsaveis where usuario_id = app.uid())) or app.perfil_atual() is null then
    raise exception 'Sem permissão para ligar SKU.' using errcode = 'insufficient_privilege';
  end if;
  if nullif(trim(p_codigo), '') is null then raise exception 'Informe o SKU.'; end if;
  if not exists (select 1 from app.produtos where id = p_produto) then raise exception 'Produto não encontrado.'; end if;
  insert into app.produto_codigos (codigo, produto_id) values (trim(p_codigo), p_produto)
  on conflict (codigo) do update set produto_id = excluded.produto_id;
  for pe in select * from app.estoque_pendencias where tipo = 'sku_desconhecido' and resolvida_em is null and codigo = trim(p_codigo) for update loop
    if pe.pedido_id is not null then
      insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario)
      values (pe.pedido_id, p_produto, pe.codigo, (select nome from app.produtos where id = p_produto), pe.quantidade, 0);
    end if;
    if pe.deposito_id is not null then
      for c in select * from app.componentes(p_produto, pe.quantidade) loop
        begin
          perform app._lancar(pe.deposito_id, c.produto_id, 'saida_venda', c.quantidade, 'pedido', coalesce(pe.pedido_id::text, 'pendencia'), 'SKU ligado: ' || pe.codigo);
        exception when others then
          insert into app.estoque_pendencias (tipo, pedido_id, deposito_id, produto_id, codigo, quantidade, detalhe)
          values ('sem_estoque', pe.pedido_id, pe.deposito_id, c.produto_id, (select codigo from app.produtos where id = c.produto_id), c.quantidade,
                  'Saída não lançada: estoque do sistema insuficiente');
        end;
      end loop;
    end if;
    update app.estoque_pendencias set resolvida_em = now(), resolvida_por = app.uid() where id = pe.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function app.lancar_vendas_marketplace(text, uuid, jsonb, text), app.ligar_sku(text, uuid) from public;
grant execute on function app.lancar_vendas_marketplace(text, uuid, jsonb, text), app.ligar_sku(text, uuid) to vc_app;
