-- Testes das unidades: solicitação de mercadoria entre unidades (pedido → separação → aprovação → recebimento).
\set QUIET on
reset role;
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set YESSICA  '00000000-0000-0000-0000-000000000004'
\set EST      '00000000-0000-0000-0000-0000000c0d07'
\set UP1 '00000000-0000-0000-0000-0000000c0d01'
select id as cd from app.depositos where codigo = 'cd-foz' \gset
select id as cde from app.depositos where codigo = 'loja-cde' \gset
insert into app.produtos (id, codigo, nome, marca, custo_unitario_brl) values (:'UP1', 'UNI-001', 'Creme Unidades', 'Marca Uni', 4);
insert into app.usuarios (id, email, nome, perfil, ativo) values (:'EST', 'est-foz@teste.local', 'Estoquista Foz', 'estoquista', true);
insert into app.deposito_responsaveis values (:'cd', :'EST') on conflict do nothing;
insert into app.deposito_responsaveis values (:'cde', :'YESSICA') on conflict do nothing;
insert into app.vendedora_depositos values ('00000000-0000-0000-0000-0000000000a2', :'cde', false) on conflict do nothing;
select app._lancar(:'cd', :'UP1', 'entrada_compra', 50, 'teste', 'unidades', null);

\echo '== Solicitação de CDE para Foz =='
set role vc_app;
select teste.como(:'YESSICA');
select set_config('teste.t1', app.solicitar_transferencia(:'cd', :'cde', format('[{"produto_id":"%s","quantidade":10}]', :'UP1')::jsonb, 'para cliente Ana')::text, false);
select teste.ok((select status = 'solicitada' from app.transferencias where id = current_setting('teste.t1')::uuid), 'Vendedora de CDE pede ao CD Foz');
select teste.falha(format($$select app.separar_transferencia(%L, '[]')$$, current_setting('teste.t1')), 'estoque de origem', 'Quem pediu não separa no CD Foz');
select teste.falha(format($$select app.solicitar_transferencia(%L, %L, '[{"produto_id":"%s","quantidade":1}]')$$, :'cde', :'cd', :'UP1'),
  'não trabalha', 'Só pede para a unidade em que trabalha');

select teste.como(:'EST');
select teste.falha(format($$select app.separar_transferencia(%L, '[{"produto_id":"%s","quantidade":80}]')$$, current_setting('teste.t1'), :'UP1'),
  'Não há', 'Não separa mais do que tem');
select app.separar_transferencia(current_setting('teste.t1')::uuid, format('[{"produto_id":"%s","quantidade":6}]', :'UP1')::jsonb);
select teste.ok((select status = 'separada' from app.transferencias where id = current_setting('teste.t1')::uuid)
            and (select quantidade_enviada = 6 and quantidade_solicitada = 10 from app.transferencia_itens where transferencia_id = current_setting('teste.t1')::uuid),
  'Estoquista separa o que tem (6 de 10)');
select teste.falha(format('select app.aprovar_transferencia(%L)', current_setting('teste.t1')), 'gerente', 'Estoquista não aprova o envio');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'UP1') = 50, 'Antes da aprovação o estoque não sai');

select teste.como(:'GERENTE');
select app.aprovar_transferencia(current_setting('teste.t1')::uuid);
select teste.ok((select status = 'enviada' and valor_custo = 24 from app.transferencias where id = current_setting('teste.t1')::uuid), 'Aprovado: enviado com o custo (6 × 4)');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'UP1') = 44, 'Saiu do CD Foz');

select teste.como(:'YESSICA');
select app.receber_transferencia(current_setting('teste.t1')::uuid, '[]', null);
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cde' and produto_id = :'UP1') = 6, 'Entrou no estoque de CDE');

\echo '== Encarregada aprova; quem pediu cancela =='
select set_config('teste.t2', app.solicitar_transferencia(:'cd', :'cde', format('[{"produto_id":"%s","quantidade":3}]', :'UP1')::jsonb)::text, false);
select app.cancelar_transferencia(current_setting('teste.t2')::uuid, 'cliente desistiu');
select teste.ok((select status = 'cancelada' and motivo_cancelamento = 'cliente desistiu' from app.transferencias where id = current_setting('teste.t2')::uuid),
  'Quem pediu cancela antes do envio');
select set_config('teste.t3', app.solicitar_transferencia(:'cd', :'cde', format('[{"produto_id":"%s","quantidade":2}]', :'UP1')::jsonb)::text, false);
select teste.como(:'EST');
select app.separar_transferencia(current_setting('teste.t3')::uuid, '[]');
reset role;
update app.usuarios set aprova_transferencias = true where id = :'KEILA';
set role vc_app;
select teste.como(:'KEILA');
select app.aprovar_transferencia(current_setting('teste.t3')::uuid);
select teste.ok((select status = 'enviada' from app.transferencias where id = current_setting('teste.t3')::uuid), 'Vendedora encarregada aprova o envio');
select teste.falha(format('select app.cancelar_transferencia(%L)', current_setting('teste.t3')), 'já enviada', 'Enviada não cancela');

\echo '== Caixa de CDE: banco de destino, confirmação, despesa e cofre =='
reset role;
insert into app.contas_bancarias (id, nome, banco, moeda, deposito_id) values ('00000000-0000-0000-0000-0000000c0db1', 'Itaú Gs CDE', 'Itaú', 'GS', :'cde');
set role vc_app;
select teste.como(:'YESSICA');
select app.abrir_caixa(:'cde', 0, 0) as cxu \gset
select teste.falha(format($$select app.venda_balcao(%L, null, 'GS', '[{"produto_id":"%s","quantidade":1,"preco":10000}]', '[{"modalidade":"transferencia","valor":10000}]')$$, :'cxu', :'UP1'),
  'qual conta', 'Transferência pede o banco de destino');
select app.venda_balcao(:'cxu', null, 'GS', format('[{"produto_id":"%s","quantidade":1,"preco":10000}]', :'UP1')::jsonb,
  '[{"modalidade":"transferencia","valor":10000,"conta_bancaria_id":"00000000-0000-0000-0000-0000000c0db1","referencia":"comp 77"}]'::jsonb) as vu \gset
select teste.ok((select confirmacao = 'pendente' and conta_bancaria_id = '00000000-0000-0000-0000-0000000c0db1' and referencia = 'comp 77'
                   from app.caixa_movimentos where pedido_id = :'vu'), 'Recebimento por transferência fica a confirmar, com a conta e o comprovante');
select teste.falha(format('select app.confirmar_recebimento_caixa(%s, true)', (select id from app.caixa_movimentos where pedido_id = :'vu')), 'gerente', 'Vendedora não confirma o próprio recebimento');
select app.movimento_caixa(:'cxu', 'despesa', 'GS', 25000, 'Limpeza da loja', null, 'administrativo');
select app.movimento_caixa(:'cxu', 'sangria', 'GS', 5000, null, 'cofre');
select teste.como(:'GERENTE');
select teste.ok((select count(*) = 1 from app.caixa_movimentos m join app.despesas d on d.id = m.despesa_id
                   where m.caixa_id = :'cxu' and d.deposito_id = :'cde' and d.pago_em = current_date and d.categoria = 'administrativo'),
  'Despesa do caixa vira conta paga da unidade');
select teste.ok((select destino = 'cofre' from app.caixa_movimentos where caixa_id = :'cxu' and tipo = 'sangria'), 'Transferência ao cofre registrada');
select app.confirmar_recebimento_caixa((select id from app.caixa_movimentos where pedido_id = :'vu'), true);
select teste.ok((select status_conferencia = 'conferido' from app.pagamentos where pedido_id = :'vu'), 'Gerente confirma no extrato: pagamento conferido');
select teste.falha(format('select app.confirmar_recebimento_caixa(%s, false)', (select id from app.caixa_movimentos where pedido_id = :'vu')), 'já foi', 'Não confirma duas vezes');

\echo '== Preço próprio de CDE =='
reset role;
insert into app.produtos (id, codigo, nome, marca) values ('00000000-0000-0000-0000-0000000c0d02', 'UNI-002', 'Shampoo Preço CDE', 'Marca Preco Uni');
insert into app.precos (produto_id, tabela, valor, vigente_desde) values
  ('00000000-0000-0000-0000-0000000c0d02', 'py_normal', 10000, current_date - 1), ('00000000-0000-0000-0000-0000000c0d02', 'cde_normal', 12000, current_date - 1),
  (:'UP1', 'py_normal', 8000, current_date - 1), ('00000000-0000-0000-0000-0000000c0d02', 'py_vip', 9000, current_date - 1);
select app._lancar(:'cd', '00000000-0000-0000-0000-0000000c0d02', 'entrada_compra', 50, 'teste', 'orc', null);
select app._lancar(:'cde', '00000000-0000-0000-0000-0000000c0d02', 'entrada_compra', 50, 'teste', 'orc', null);
insert into app.clientes (id, nome, vendedora_id, pais, deposito_id) values
  ('00000000-0000-0000-0000-0000000c0dc1', 'Cliente CDE', '00000000-0000-0000-0000-0000000000a2', 'PY', :'cde'),
  ('00000000-0000-0000-0000-0000000c0dc2', 'Cliente Foz', '00000000-0000-0000-0000-0000000000a2', 'PY', :'cd');
select teste.ok((select valor = 12000 and tabela = 'cde_normal' from app.preco_para_cliente('00000000-0000-0000-0000-0000000c0dc1', '00000000-0000-0000-0000-0000000c0d02')),
  'Cliente de CDE paga a tabela de CDE');
select teste.ok((select valor = 10000 from app.preco_para_cliente('00000000-0000-0000-0000-0000000c0dc2', '00000000-0000-0000-0000-0000000c0d02')),
  'Cliente de Foz paga a tabela do Paraguai');
select teste.ok((select valor = 8000 and tabela = 'py_normal' from app.preco_para_cliente('00000000-0000-0000-0000-0000000c0dc1', :'UP1')),
  'Sem preço de CDE: vale o do Paraguai (nunca fica sem preço)');
select teste.ok((select preco = 12000 from app.preco_final_moeda('00000000-0000-0000-0000-0000000c0dc1', '00000000-0000-0000-0000-0000000c0d02', 'GS')),
  'Preço final (loja e pedido) usa a tabela de CDE');

\echo '== Vendas de marketplace pelo relatório =='
reset role;
insert into app.produto_codigos (codigo, produto_id) values ('SHP-UNI-1', :'UP1') on conflict do nothing;
set role vc_app;
select teste.como(:'EST');
select app.lancar_vendas_marketplace('shopee', :'cd', jsonb_build_array(
  jsonb_build_object('pedido', 'SHP-9001', 'data', current_date, 'taxa', 3, 'itens', jsonb_build_array(
    jsonb_build_object('sku', 'SHP-UNI-1', 'quantidade', 2, 'valor', 15), jsonb_build_object('sku', 'NAO-EXISTE', 'quantidade', 1, 'valor', 9)))), 'teste.csv') as mk \gset
select teste.ok((:'mk'::jsonb->>'novos')::int = 1 and (:'mk'::jsonb->>'sem_sku')::int = 1, 'Pedido do relatório entra; SKU sem cadastro vira pendência');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'UP1') = 40, 'Baixou 2 do estoque do CD (42 → 40)');
select teste.ok((select canal = 'shopee' and valor_total = 39 and status_comercial = 'entregue' and repasse_previsto = 36 from app.pedidos where numero_externo = 'SHP-9001'),
  'Pedido do canal com total do relatório e repasse (total − taxa)');
select teste.ok((app.lancar_vendas_marketplace('shopee', :'cd', jsonb_build_array(jsonb_build_object('pedido', 'SHP-9001', 'itens', jsonb_build_array(jsonb_build_object('sku', 'SHP-UNI-1', 'quantidade', 2)))))->>'repetidos')::int = 1,
  'O mesmo pedido não entra duas vezes');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'UP1') = 40, 'Repetido não baixa de novo');
select teste.como(:'GERENTE');
select teste.ok(app.ligar_sku('NAO-EXISTE', :'UP1') = 1, 'Ligar o SKU resolve a pendência');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'UP1') = 39, 'E dá a baixa que faltou');
select teste.como(:'KEILA');
select teste.falha(format($$select app.lancar_vendas_marketplace('shopee', %L, '[{"pedido":"X","itens":[]}]')$$, :'cd'), 'Só gerente', 'Vendedora não lança relatório de marketplace');

\echo '== Inventário com venda no meio da contagem =='
select teste.como(:'YESSICA');
-- abriu a lista com 5 em CDE; contou 8; enquanto contava saiu 1 no balcão (saldo foi para 4) → fica 7
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cde' and produto_id = :'UP1') = 5, 'Antes: 5 em CDE');
reset role;
select app._lancar(:'cde', :'UP1', 'saida_venda', 1, 'teste', 'inv', null);
set role vc_app;
select teste.como(:'YESSICA');
select app.registrar_inventario(:'cde', format('[{"produto_id":"%s","contado":8,"base":5}]', :'UP1')::jsonb);
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cde' and produto_id = :'UP1') = 7, 'Contado 8 sobre a base 5 = +3 (a venda do meio não é desfeita)');
select app.registrar_inventario(:'cde', format('[{"produto_id":"%s","contado":2}]', :'UP1')::jsonb);
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cde' and produto_id = :'UP1') = 2, 'Sem base: fica igual ao contado');

\echo '== Orçamento: sem cliente, vincula e vira pedido =='
select teste.como(:'KEILA');
select app.salvar_orcamento(null, jsonb_build_object('contato_nome', 'Ana da loja', 'contato_whatsapp', '595981222333', 'tabela', 'py_normal',
  'itens', jsonb_build_array(jsonb_build_object('produto_id', '00000000-0000-0000-0000-0000000c0d02', 'quantidade', 3)))) as orc \gset
select teste.ok((select total = 30000 and status = 'aberto' and cliente_id is null from app.orcamentos where id = :'orc'), 'Orçamento sem cliente com a tabela escolhida (3 × 10.000)');
select teste.falha(format('select app.converter_orcamento(%L, null, null)', :'orc'), 'Vincule', 'Sem cliente não vira pedido');
select teste.como(:'YESSICA');
select teste.ok((select count(*) = 0 from app.orcamentos where id = :'orc'), 'Outra vendedora não vê o orçamento');
select teste.falha(format('select app.vincular_orcamento(%L, %L)', :'orc', '00000000-0000-0000-0000-0000000000c1'), 'outra vendedora', 'Outra vendedora não mexe');
select teste.como(:'KEILA');
select app.vincular_orcamento(:'orc', '00000000-0000-0000-0000-0000000000c1');
select teste.ok((select cliente_id = '00000000-0000-0000-0000-0000000000c1' from app.orcamentos where id = :'orc'), 'Vinculado ao cliente');
select app.converter_orcamento(:'orc', null, current_date + 2) as ped_orc \gset
select teste.ok((select status = 'convertido' and pedido_id = :'ped_orc' from app.orcamentos where id = :'orc')
            and (select count(*) = 1 from app.pedido_itens where pedido_id = :'ped_orc'), 'Virou pedido com os itens');

\echo '== Saldo anterior do cliente =='
select teste.como(:'KEILA');
select teste.falha($$select app.lancar_saldo_anterior('00000000-0000-0000-0000-0000000000c1', 'divida', 'GS', 500000)$$, 'de onde vem', 'Dívida pede a descrição');
select app.lancar_saldo_anterior('00000000-0000-0000-0000-0000000000c1', 'divida', 'GS', 500000, current_date - 30, current_date + 10, 'Saldo de setembro');
select app.lancar_saldo_anterior('00000000-0000-0000-0000-0000000000c1', 'pagamento', 'GS', 200000, null, null, 'Pagou em efetivo');
select teste.ok((select saldo = 300000 from app.v_saldo_anterior where cliente_id = '00000000-0000-0000-0000-0000000000c1' and moeda = 'GS'), 'Saldo = dívida − pagamento');
select teste.falha($$select app.lancar_saldo_anterior('00000000-0000-0000-0000-0000000000c2', 'divida', 'GS', 1000, null, null, 'x')$$, 'outra vendedora', 'Não lança em cliente de outra vendedora');
select teste.como(:'YESSICA');
select teste.ok((select count(*) = 0 from app.saldos_anteriores where cliente_id = '00000000-0000-0000-0000-0000000000c1'), 'Outra vendedora não vê');

\echo '== Kits de marketplace pelos componentes =='
reset role;
select app.registrar_kit_marketplace('KC-TESTE-2', 'Kit teste 2 un', '[{"codigo":"UNI-001","quantidade":2}]') as rk \gset
select teste.ok(:'rk' = 'ok', 'Kit de marketplace criado com componentes');
select teste.ok(app.registrar_kit_marketplace('KC-TESTE-X', 'x', '[{"codigo":"NAO-HA","quantidade":1}]') like 'faltando%', 'Kit com componente sem cadastro não é criado');
select teste.ok(app.ligar_codigo_marketplace('ANUNCIO-ANTIGO', 'KC-TESTE-2') = 'ok', 'Código antigo do anúncio ligado ao kit');
set role vc_app;
select teste.como(:'EST');
select (select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'UP1') as antes \gset
select app.lancar_vendas_marketplace('mercado_livre', :'cd', '[{"pedido":"ML-777","itens":[{"sku":"ANUNCIO-ANTIGO","quantidade":3,"valor":20}]}]'::jsonb);
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'UP1') = :antes - 6, 'Venda do kit pelo código antigo baixa 3 × 2 unidades');
select teste.ok(app.cancelar_vendas_marketplace('mercado_livre', array['ML-777']) = 1, 'Cancelado no marketplace');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'UP1') = :antes
            and (select status_comercial = 'cancelado' from app.pedidos where numero_externo = 'ML-777'), 'Cancelamento devolve o estoque');
select teste.ok(app.cancelar_vendas_marketplace('mercado_livre', array['ML-777']) = 0, 'Cancelar de novo não devolve duas vezes');
select teste.como(:'KEILA');
select teste.falha($$select app.cancelar_vendas_marketplace('shopee', array['X'])$$, 'Sem permissão', 'Vendedora não cancela venda de marketplace');

\echo '== Caixa de venda sempre com 12 =='
reset role;
insert into app.produtos (codigo, nome, unidades_caixa) values ('CX-24', 'Produto caixa 24', 24), ('CX-6', 'Produto caixa 6', 6);
select teste.ok((select unidades_caixa = 12 and unidades_caixa_fornecedor = 24 from app.produtos where codigo = 'CX-24'), 'Caixa do fornecedor 24 → cliente compra caixa de 12');
select teste.ok((select unidades_caixa = 12 and unidades_caixa_fornecedor = 6 from app.produtos where codigo = 'CX-6'), 'Caixa do fornecedor 6 → cliente compra caixa de 12');
update app.produtos set unidades_caixa_fornecedor = 36 where codigo = 'CX-24';
select teste.ok((select unidades_caixa = 12 and unidades_caixa_fornecedor = 36 from app.produtos where codigo = 'CX-24'), 'Mudar a caixa do fornecedor mantém a de venda em 12');
update app.produtos set unidades_caixa_fornecedor = null where codigo = 'CX-6';
select teste.ok((select unidades_caixa is null from app.produtos where codigo = 'CX-6'), 'Sem caixa do fornecedor: vende por unidade');

reset role;
\echo '== Testes das unidades passaram =='
