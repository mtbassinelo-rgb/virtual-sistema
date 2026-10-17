-- Pedido do cliente com itens "por encomenda": produto esgotado pode ser pedido (o item marcado
-- "encomenda" não é recusado por falta de estoque; a parte que falta entra como ENCOMENDA para a vendedora confirmar o prazo).
create or replace function app.portal_criar_pedido(p_sessao_hash text, p_itens jsonb, p_obs text default null)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_cli app.clientes; v_dep app.depositos; v_ped uuid; it jsonb; v_qtd numeric; f record;
  v_local numeric; v_abast numeric; q_local numeric; q_abast numeric; q_enc numeric; v_enc boolean; v_prod app.produtos; v_total numeric := 0; n int := 0;
begin
  select * into v_cli from app.clientes where id = app.portal_cliente_id(p_sessao_hash);
  if v_cli.id is null then raise exception 'Sessão expirada. Peça um novo link para a sua vendedora.'; end if;
  select * into v_dep from app.depositos where id = app.deposito_do_cliente(v_cli.id);
  insert into app.pedidos (origem, canal, cliente_id, vendedora_id, data_pedido, moeda, valor_total, status_comercial, deposito_id, observacoes)
  values ('portal', 'portal', v_cli.id, v_cli.vendedora_id, current_date, v_cli.moeda, 0, 'aguardando_aprovacao', v_dep.id,
          nullif(trim(coalesce(p_obs,'')), ''))
  returning id into v_ped;
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    v_qtd := (it->>'quantidade')::numeric;
    continue when v_qtd is null or v_qtd <= 0;
    select * into v_prod from app.produtos where id = (it->>'produto_id')::uuid and ativo;
    if v_prod.id is null then raise exception 'Produto não encontrado.'; end if;
    select * into f from app.preco_final(v_cli.id, v_prod.id);
    if f.preco is null then raise exception 'Produto sem preço na sua tabela.'; end if;
    if f.limite_qtd is not null and v_qtd > f.limite_qtd then
      raise exception 'Promoção de % limitada a % unidades por pedido.', v_prod.nome, f.limite_qtd;
    end if;
    v_local := app.saldo_disponivel(v_dep.id, v_prod.id);
    v_abast := case when v_dep.abastecido_por is null then 0 else app.saldo_disponivel(v_dep.abastecido_por, v_prod.id) end;
    v_enc := coalesce((it->>'encomenda')::boolean, false);
    if v_local + v_abast < v_qtd and not v_enc then
      raise exception 'Quantidade maior que a disponível de % (disponível: %).', v_prod.nome, v_local + v_abast;
    end if;
    q_local := least(v_qtd, v_local);
    q_abast := least(v_qtd - q_local, v_abast);
    q_enc := v_qtd - q_local - q_abast;          -- o que falta vira encomenda (a vendedora confirma o prazo)
    if q_local > 0 then
      insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
      values (v_ped, v_prod.id, v_prod.codigo,
              v_prod.nome || case when f.promocao_id is not null then ' (promoção -' || f.desconto_pct::int || '%)' else '' end,
              q_local, f.preco, f.tabela, v_dep.id);
    end if;
    if q_abast > 0 then
      insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
      values (v_ped, v_prod.id, v_prod.codigo,
              v_prod.nome || case when f.promocao_id is not null then ' (promoção -' || f.desconto_pct::int || '%)' else '' end
                          || ' · vem de ' || (select nome from app.depositos where id = v_dep.abastecido_por)
                          || coalesce(' (' || v_dep.prazo_abastecimento || ')', ''),
              q_abast, f.preco, f.tabela, v_dep.abastecido_por);
    end if;
    if q_enc > 0 then
      insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
      values (v_ped, v_prod.id, v_prod.codigo,
              v_prod.nome || case when f.promocao_id is not null then ' (promoção -' || f.desconto_pct::int || '%)' else '' end
                          || ' · ENCOMENDA (sem estoque: confirmar prazo)',
              q_enc, f.preco, f.tabela, v_dep.id);
    end if;
    v_total := v_total + v_qtd * f.preco; n := n + 1;
  end loop;
  if n = 0 then raise exception 'Escolha pelo menos um produto.'; end if;
  update app.pedidos set valor_total = round(v_total, 2) where id = v_ped;
  return v_ped;
end $$;
