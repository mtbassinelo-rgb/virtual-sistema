-- Pedidos vindos direto da Shopee/ML: venda com baixa no estoque, envio para o estoquista, cancelamento e repetição.
\set QUIET on
reset role;
\set GERENTE '00000000-0000-0000-0000-000000000002'
\set KEILA   '00000000-0000-0000-0000-000000000003'
select id as cd from app.depositos where codigo = 'cd-foz' \gset
update app.canais set deposito_id = :'cd' where codigo = 'shopee';
insert into app.produtos (id, codigo, nome, marca) values ('00000000-0000-0000-0000-00000000f001', 'MKT-API-01', 'Gel Teste API', 'TESTE');
select app._lancar(:'cd', '00000000-0000-0000-0000-00000000f001', 'entrada_compra', 10, 'teste', 'mkt', null);

\echo '== Pedido da Shopee pela API =='
set role vc_app;
select teste.como(:'GERENTE');
select app.mkt_salvar_conta('shopee', '999', 'Loja Teste', 'tok', 'ref', 14400, 2592000, null) as conta \gset
select teste.ok(app.mkt_registrar_pedido(:'conta', '{"ref":"API-001","data":"2026-10-29","comprador":"maria","status":"READY_TO_SHIP","prazo":"2026-10-30T23:59:00-03:00","etapa":"a_preparar",
  "itens":[{"sku":"MKT-API-01","descricao":"Gel","quantidade":3,"valor":20}]}') = 'novo', 'Pedido novo entra');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-00000000f001') = 7, 'Baixa no estoque (10 - 3)');
select teste.ok((select etapa from app.marketplace_envios where numero_externo = 'API-001') = 'a_preparar', 'Envio aparece para preparar');
select teste.ok(app.mkt_registrar_pedido(:'conta', '{"ref":"API-001","status":"READY_TO_SHIP","etapa":"a_preparar","itens":[{"sku":"MKT-API-01","quantidade":3,"valor":20}]}') = 'atualizado',
  'Mesmo pedido de novo não duplica');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-00000000f001') = 7, 'Repetição não baixa de novo');
select teste.ok((select count(*) from app.pedidos where canal = 'shopee' and numero_externo = 'API-001') = 1, 'Um pedido só');

\echo '== Estoquista marca embalado =='
select id as env from app.marketplace_envios where numero_externo = 'API-001' \gset
select teste.como(:'KEILA');
select teste.falha(format($$select app.mkt_marcar_envio(%L, true)$$, :'env'),
  'estoque desta unidade', 'Vendedora sem estoque não marca envio');
select teste.como(:'GERENTE');
select app.mkt_marcar_envio((select id from app.marketplace_envios where numero_externo = 'API-001'), true);
select teste.ok((select etapa from app.marketplace_envios where numero_externo = 'API-001') = 'preparado', 'Marcado como embalado');
select app.mkt_registrar_pedido(:'conta', '{"ref":"API-001","status":"READY_TO_SHIP","etapa":"a_preparar","itens":[]}');
select teste.ok((select etapa from app.marketplace_envios where numero_externo = 'API-001') = 'preparado', 'Sincronizar de novo não desfaz o embalado');
select app.mkt_registrar_pedido(:'conta', '{"ref":"API-001","status":"SHIPPED","etapa":"enviado","itens":[]}');
select teste.ok((select etapa from app.marketplace_envios where numero_externo = 'API-001') = 'enviado', 'Plataforma enviou: sai da lista');

\echo '== Cancelado na plataforma devolve o estoque =='
select app.mkt_registrar_pedido(:'conta', '{"ref":"API-002","status":"READY_TO_SHIP","etapa":"a_preparar","itens":[{"sku":"MKT-API-01","quantidade":2,"valor":20}]}');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-00000000f001') = 5, 'Segundo pedido baixa');
select teste.ok(app.mkt_registrar_pedido(:'conta', '{"ref":"API-002","status":"CANCELLED","etapa":"cancelado"}') = 'cancelado', 'Cancelamento reconhecido');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-00000000f001') = 7, 'Estoque devolvido');
select teste.ok((select status_comercial::text from app.pedidos where canal = 'shopee' and numero_externo = 'API-002') = 'cancelado', 'Pedido cancelado');
select teste.ok((select etapa from app.marketplace_envios where numero_externo = 'API-002') = 'cancelado', 'Envio cancelado');

\echo '== Relatório do Bling depois não duplica =='
select teste.como(:'GERENTE');
select teste.ok((app.lancar_vendas_marketplace('shopee', :'cd', '[{"pedido":"API-001","itens":[{"sku":"MKT-API-01","quantidade":3,"valor":20}]}]')->>'repetidos')::int = 1,
  'Relatório ignora o pedido que veio pela API');
select teste.como(:'KEILA');
select teste.falha($$select * from app.mkt_contas_situacao()$$, 'gerente', 'Vendedora não vê as contas');
select teste.ok(not exists (select 1 from app.marketplace_envios), 'Vendedora não vê os envios');
reset role;
\echo '== Testes do marketplace pela API passaram =='
