-- =====================================================================
-- Nada impede o cliente de fechar o pedido:
--  · produto sem preço na tabela do cliente entra com valor 0, marcado "SEM PREÇO" para a vendedora completar;
--  · promoção com limite: até o limite com desconto, o resto pelo preço normal (antes dava erro);
--  · produto que saiu do catálogo fica de fora do pedido e é avisado na observação.
-- E no site: produto sem preço fica oculto (lista "Sem preço (fora do site)" no sistema para arrumar).
-- =====================================================================
create or replace function app.portal_criar_pedido(p_sessao_hash text, p_itens jsonb, p_obs text default null)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_cli app.clientes; v_dep app.depositos; v_ped uuid; it jsonb; v_qtd numeric; f record;
  v_local numeric; v_abast numeric; q_local numeric; q_abast numeric; q_enc numeric; v_enc boolean; v_prod app.produtos; v_total numeric := 0; n int := 0;
  v_preco numeric; v_tab text; v_rot text; v_fora text[] := '{}';
begin
  select * into v_cli from app.clientes where id = app.portal_cliente_id(p_sessao_hash);
  if v_cli.id is null then raise exception 'Sessão expirada. Peça um novo link para a sua vendedora.'; end if;
  select * into v_dep from app.depositos where id = app.deposito_do_cliente(v_cli.id);
  -- unidade que vende só o próprio estoque (ex.: loja de CDE): não oferece o estoque do CD que a abastece
  if not v_dep.mostra_abastecedor then v_dep.abastecido_por := null; end if;
  insert into app.pedidos (origem, canal, cliente_id, vendedora_id, data_pedido, moeda, valor_total, status_comercial, deposito_id, observacoes)
  values ('portal', 'portal', v_cli.id, v_cli.vendedora_id, current_date, v_cli.moeda, 0, 'aguardando_aprovacao', v_dep.id,
          nullif(trim(coalesce(p_obs,'')), ''))
  returning id into v_ped;
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    v_qtd := (it->>'quantidade')::numeric;
    continue when v_qtd is null or v_qtd <= 0;
    select * into v_prod from app.produtos where id = (it->>'produto_id')::uuid and ativo;
    -- nada impede o cliente de fechar: produto que saiu do sistema fica de fora (avisado na observação)
    if v_prod.id is null then
      v_fora := v_fora || coalesce((select nome from app.produtos where id = (it->>'produto_id')::uuid), 'produto removido');
      continue;
    end if;
    select * into f from app.preco_final(v_cli.id, v_prod.id);
    v_preco := f.preco; v_tab := f.tabela;
    v_rot := v_prod.nome || case when f.promocao_id is not null then ' (promoção -' || f.desconto_pct::int || '%)' else '' end;
    if v_preco is null then
      -- sem preço na tabela do cliente: entra com valor 0 para a vendedora completar
      v_preco := 0; v_tab := null; v_rot := v_prod.nome || ' · SEM PREÇO (vendedora confirma o valor)';
    elsif f.limite_qtd is not null and v_qtd > f.limite_qtd then
      -- promoção limitada: até o limite com desconto, o resto pelo preço normal (preço médio na linha)
      v_preco := round((f.limite_qtd * f.preco + (v_qtd - f.limite_qtd) * f.preco_tabela) / v_qtd, 2);
      v_rot := v_prod.nome || ' (promoção -' || f.desconto_pct::int || '% em ' || f.limite_qtd::int || ' un; o resto pelo preço normal)';
    end if;
    v_local := app.saldo_disponivel(v_dep.id, v_prod.id);
    v_abast := case when v_dep.abastecido_por is null then 0 else app.saldo_disponivel(v_dep.abastecido_por, v_prod.id) end;
    v_enc := coalesce((it->>'encomenda')::boolean, false);
    -- sem bloqueio por estoque: o que passar do disponível entra no pedido marcado para a vendedora conferir e avisar o cliente
    q_local := least(v_qtd, v_local);
    q_abast := least(v_qtd - q_local, v_abast);
    q_enc := v_qtd - q_local - q_abast;          -- o que falta vira encomenda (a vendedora confirma o prazo)
    if q_local > 0 then
      insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
      values (v_ped, v_prod.id, v_prod.codigo,
              v_rot, q_local, v_preco, v_tab, v_dep.id);
    end if;
    if q_abast > 0 then
      insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
      values (v_ped, v_prod.id, v_prod.codigo,
              v_rot || ' · vem de ' || (select nome from app.depositos where id = v_dep.abastecido_por)
                    || coalesce(' (' || v_dep.prazo_abastecimento || ')', ''),
              q_abast, v_preco, v_tab, v_dep.abastecido_por);
    end if;
    if q_enc > 0 then
      insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
      values (v_ped, v_prod.id, v_prod.codigo,
              v_rot || ' · SEM ESTOQUE (vendedora confirma com o cliente)',
              q_enc, v_preco, v_tab, v_dep.id);
    end if;
    v_total := v_total + v_qtd * v_preco; n := n + 1;
  end loop;
  if n = 0 then
    raise exception '%', case when cardinality(v_fora) > 0 then 'Esses produtos não estão mais disponíveis. Atualize a página e escolha de novo.' else 'Escolha pelo menos um produto.' end;
  end if;
  update app.pedidos set valor_total = round(v_total, 2),
         observacoes = case when cardinality(v_fora) > 0 then trim(both ' ' from coalesce(observacoes, '') || ' [Fora do pedido, não estão mais no catálogo: ' || array_to_string(v_fora, ', ') || ']') else observacoes end
   where id = v_ped;
  return v_ped;
end $$;

-- Vitrine para visitante: produtos que têm preço normal em alguma tabela (R$ ou Gs). Os outros ficam ocultos.
create or replace function app.vitrine_com_preco() returns setof uuid
language sql stable security definer set search_path = app, pg_temp as $$
  select distinct produto_id from app.precos where tabela in ('br_normal', 'py_normal') and vigente_desde <= current_date and valor > 0
$$;
grant execute on function app.vitrine_com_preco() to vc_app;
