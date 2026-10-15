-- Testes de estoque, transferências e permissão de depósito. Rodar depois dos outros testes.
\set QUIET on
reset role;
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set YESSICA  '00000000-0000-0000-0000-000000000004'
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set PROD     '00000000-0000-0000-0000-0000000000b1'
select id as cd from app.depositos where codigo = 'cd-foz' \gset
select id as cde from app.depositos where codigo = 'loja-cde' \gset
-- Yessica atende na loja de CDE
insert into app.deposito_responsaveis values (:'cde', :'YESSICA');

\echo '== Estoque e transferências =='
set role vc_app;
select teste.como(:'KEILA');
select teste.falha(format($$select app.entrada_compra(%L, '[{"produto_id":"%s","quantidade":100}]', 'NF 123')$$, :'cd', :'PROD'),
  'sem permissão', 'Vendedora sem responsabilidade não lança entrada no CD');
select teste.como(:'GERENTE');
select app.entrada_compra(:'cd', format('[{"produto_id":"%s","quantidade":120}]', :'PROD')::jsonb, 'NF Rhenuks 4521');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'PROD') = 120, 'Entrada de compra soma no CD (120)');
select teste.falha(format($$select app.entrada_compra(%L, '[{"produto_id":"%s","quantidade":1}]', '')$$, :'cd', :'PROD'),
  'referência', 'Entrada exige referência da compra');

-- Transferência CD Foz -> Loja CDE
select app.criar_transferencia(:'cd', :'cde', format('[{"produto_id":"%s","quantidade":48}]', :'PROD')::jsonb, 'Reposição semanal') as tr \gset
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'PROD') = 120, 'Rascunho não mexe no estoque');
select app.enviar_transferencia(:'tr');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'PROD') = 72, 'Envio tira do CD (72)');
select teste.ok((select a_receber from app.v_estoque where deposito_id = :'cde' and produto_id = :'PROD') = 48, 'Loja vê 48 em trânsito para receber');
select teste.falha(format($$select app.cancelar_transferencia(%L)$$, :'tr'), 'já enviada', 'Transferência enviada não é cancelada');

select teste.como(:'KEILA');
select teste.falha(format($$select app.receber_transferencia(%L)$$, :'tr'), 'sem permissão', 'Quem não é da loja não recebe');
select teste.como(:'YESSICA');
select teste.ok(app.receber_transferencia(:'tr', format('[{"produto_id":"%s","quantidade":46}]', :'PROD')::jsonb, 'Chegaram 2 a menos')
  = 'recebida_com_divergencia', 'Loja recebe 46 de 48 e a divergência fica registrada');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cde' and produto_id = :'PROD') = 46, 'Loja fica com 46');
select teste.ok((select quantidade_recebida from app.transferencia_itens where transferencia_id = :'tr') = 46, 'Item guarda enviado e recebido');

select teste.como(:'GERENTE');
select app.criar_transferencia(:'cde', :'cd', format('[{"produto_id":"%s","quantidade":500}]', :'PROD')::jsonb) as tr2 \gset
select teste.falha(format($$select app.enviar_transferencia(%L)$$, :'tr2'), 'estoque insuficiente', 'Não envia mais do que tem (estoque nunca fica negativo)');
select app.cancelar_transferencia(:'tr2');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cde' and produto_id = :'PROD') = 46, 'Tentativa barrada não mexe no saldo');

select teste.falha(format($$select app.ajustar_estoque(%L, %L, 70, '')$$, :'cd', :'PROD'), 'motivo', 'Ajuste exige motivo');
select teste.ok(app.ajustar_estoque(:'cd', :'PROD', 70, 'Inventário mensal') = -2, 'Inventário ajusta a diferença (72 -> 70)');
reset role;
select teste.falha($$update app.estoque_movimentos set quantidade = 1$$, 'não pode ser alterado', 'Lançamento de estoque não se altera');
select teste.falha($$delete from app.estoque_movimentos$$, 'não pode ser alterado', 'Lançamento de estoque não se apaga');

\echo '== Permissão de depósito por vendedora e baixa por pedido =='
insert into app.vendedora_depositos values ('00000000-0000-0000-0000-0000000000a1', :'cd', true);
set role vc_app;
select teste.como(:'KEILA');
insert into app.pedidos (id, origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total)
  values ('00000000-0000-0000-0000-0000000000d8','manual','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1', current_date, 'GS', 78000);
select teste.ok((select deposito_id from app.pedidos where id = '00000000-0000-0000-0000-0000000000d8') = :'cd'::uuid, 'Pedido usa o depósito padrão da vendedora');
select teste.falha(format($$insert into app.pedidos (origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total, deposito_id)
  values ('manual','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1', current_date, 'GS', 1, %L)$$, :'cde'),
  'permissão para vender', 'Keila não vende do estoque da loja de CDE sem autorização');
insert into app.pedido_itens (pedido_id, produto_id, descricao, quantidade, preco_unitario, tabela_preco)
  values ('00000000-0000-0000-0000-0000000000d8', :'PROD', 'Sebo de Carneiro', 12, 6500, 'py_vip');
update app.pedidos set status_comercial = 'enviado' where id = '00000000-0000-0000-0000-0000000000d8';
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'PROD') = 58, 'Pedido enviado baixa o estoque (70 - 12 = 58)');
update app.pedidos set status_comercial = 'cancelado' where id = '00000000-0000-0000-0000-0000000000d8';
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'PROD') = 70, 'Cancelado após envio devolve ao estoque');
select teste.ok((select count(*) from app.estoque_movimentos where referencia_id = '00000000-0000-0000-0000-0000000000d8') = 2,
  'Saída e devolução ficam no extrato do produto');
reset role;
insert into app.vendedora_depositos values ('00000000-0000-0000-0000-0000000000a1', :'cde', false);
set role vc_app;
select teste.como(:'KEILA');
insert into app.pedidos (origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total, deposito_id)
  values ('manual','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1', current_date, 'GS', 1, :'cde');
select teste.ok(true, 'Com autorização do gerente, Keila vende também da loja de CDE');
select teste.falha(format($$insert into app.vendedora_depositos values ('00000000-0000-0000-0000-0000000000a2', %L, false)$$, :'cd'),
  'row-level security', 'Vendedora não se autoriza sozinha');
reset role;
\echo '== Testes de estoque passaram =='
