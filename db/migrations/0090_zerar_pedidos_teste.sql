-- =====================================================================
-- Pedido do Mateus (22/10/2026): todos os pedidos que existiam até agora eram testes das vendedoras.
-- Apaga os pedidos (e itens, pagamentos, caixa, links) criados até 22/10/2026 09:50 (Paraguai) e mantém os cadastros
-- (clientes, produtos, preços). O estoque que esses pedidos tinham baixado volta para a unidade.
-- Segurança: só roda se forem no máximo 40 pedidos (os testes); com mais, não apaga nada e avisa.
-- =====================================================================
do $$
declare v_ids uuid[]; n int; m record;
begin
  select coalesce(array_agg(id), '{}') into v_ids from app.pedidos where criado_em < timestamptz '2026-10-22 12:50:00+00';
  n := coalesce(array_length(v_ids, 1), 0);
  if n = 0 then raise notice 'Nenhum pedido de teste para apagar.'; return; end if;
  if n > 40 then raise notice 'Encontrados % pedidos: mais do que os testes esperados. Nada foi apagado.', n; return; end if;

  -- estoque que esses pedidos baixaram volta (saídas − devoluções já feitas)
  for m in select deposito_id, produto_id,
                  sum(case when tipo = 'saida_venda' then quantidade when tipo = 'devolucao_cliente' then -quantidade else 0 end) q
             from app.estoque_movimentos
            where referencia_tipo = 'pedido' and referencia_id = any(select x::text from unnest(v_ids) x)
            group by 1, 2 loop
    if m.q > 0 then
      perform app._lancar(m.deposito_id, m.produto_id, 'ajuste_entrada', m.q, 'pedido_teste', null, 'Pedido de teste apagado: estoque devolvido');
    end if;
  end loop;

  -- o que aponta para os pedidos
  update app.planilha_vendas set pedido_id = null where pedido_id = any(v_ids);
  update app.atendimentos set pedido_id = null where pedido_id = any(v_ids);
  update app.tarefas set pedido_id = null where pedido_id = any(v_ids);
  update app.metas_cliente set premio_pedido_id = null where premio_pedido_id = any(v_ids);
  update app.transferencias set pedido_id = null where pedido_id = any(v_ids);
  update app.transferencias set pedido_origem_id = null where pedido_origem_id = any(v_ids);
  update app.orcamentos set pedido_id = null, status = 'cancelado' where pedido_id = any(v_ids);
  delete from app.estoque_pendencias where pedido_id = any(v_ids);
  delete from app.caixa_movimentos where pedido_id = any(v_ids)
     or pagamento_id in (select id from app.pagamentos where pedido_id = any(v_ids));
  delete from app.comprovantes where pagamento_id in (select id from app.pagamentos where pedido_id = any(v_ids));
  delete from app.pagamentos where pedido_id = any(v_ids);
  delete from app.pedido_links where pedido_id = any(v_ids);
  delete from app.pedido_itens_indisponiveis where pedido_id = any(v_ids);
  delete from app.pedido_itens where pedido_id = any(v_ids);
  delete from app.pedidos where id = any(v_ids);
  raise notice '% pedido(s) de teste apagados; cadastros mantidos.', n;
end $$;
