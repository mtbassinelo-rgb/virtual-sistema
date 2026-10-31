-- Testes do pedido de compra por marca, da caixa de 12 da Rhenuks e do custo dos kits Maycrene.
\set QUIET on
reset role;
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set KEILA    '00000000-0000-0000-0000-000000000003'
insert into app.produtos (id, codigo, nome, marca, unidades_caixa) values
  ('00000000-0000-0000-0000-00000000d601', 'PC-RH-1', 'Sabonete Teste Rhenuks', 'RHENUKS', 24),
  ('00000000-0000-0000-0000-00000000d602', 'PC-MY-1', 'Produto Teste Maycrene', 'MAYCRENE', 12);
insert into app.precos (produto_id, tabela, valor, vigente_desde) values
  ('00000000-0000-0000-0000-00000000d602', 'py_normal', 9000, current_date - 5);

\echo '== Pedido de compra =='
select teste.ok((select unidades_caixa_fornecedor from app.produtos where codigo = 'PC-RH-1') = 12, 'Rhenuks novo nasce com caixa de 12');
update app.produtos set unidades_caixa_fornecedor = 36 where codigo = 'PC-RH-1';
select teste.ok((select unidades_caixa_fornecedor from app.produtos where codigo = 'PC-RH-1') = 12, 'Rhenuks continua com caixa de 12 ao alterar');
update app.produtos set unidades_caixa_fornecedor = 24 where codigo = 'PC-MY-1';
select teste.ok((select unidades_caixa_fornecedor from app.produtos where codigo = 'PC-MY-1') = 24, 'Outras marcas mantêm a caixa do fornecedor');

set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.compra_definir_qtd('00000000-0000-0000-0000-00000000d601', 12)$$, 'gerente', 'Vendedora não monta pedido de compra');
select teste.falha($$select app.compra_definir_custo('00000000-0000-0000-0000-00000000d601', 2)$$, 'gerente', 'Vendedora não altera custo');
select teste.ok(not exists (select 1 from app.compra_lista), 'Vendedora não vê a lista de compra');

select teste.como(:'GERENTE');
select app.compra_definir_qtd('00000000-0000-0000-0000-00000000d601', 120);
select app.compra_definir_qtd('00000000-0000-0000-0000-00000000d602', 24);
select teste.ok((select quantidade from app.compra_lista where produto_id = '00000000-0000-0000-0000-00000000d601') = 120, 'Quantidade fica salva');
select app.compra_definir_qtd('00000000-0000-0000-0000-00000000d601', 60);
select teste.ok((select quantidade from app.compra_lista where produto_id = '00000000-0000-0000-0000-00000000d601') = 60, 'Quantidade pode ser trocada');
select teste.falha($$select app.compra_definir_qtd('00000000-0000-0000-0000-00000000d601', -1)$$, 'inválida', 'Quantidade negativa é bloqueada');
select app.compra_definir_custo('00000000-0000-0000-0000-00000000d602', 3.5);
select teste.ok(app.custo_produto('00000000-0000-0000-0000-00000000d602') = 3.5, 'Custo de compra (sem frete) gravado');
select teste.ok((select valor from app.precos where produto_id = '00000000-0000-0000-0000-00000000d602' and tabela = 'py_normal' order by vigente_desde desc limit 1) = 9000,
  'Preço de venda não muda');
select teste.ok(app.compra_zerar('RHENUKS') = 1, 'Zerar a marca tira só os produtos dela');
select teste.ok(exists (select 1 from app.compra_lista where produto_id = '00000000-0000-0000-0000-00000000d602'), 'A outra marca continua na lista');
select app.compra_definir_qtd('00000000-0000-0000-0000-00000000d602', 0);
select teste.ok(not exists (select 1 from app.compra_lista), 'Quantidade zero tira da lista');
reset role;
\echo '== Testes do pedido de compra passaram =='
