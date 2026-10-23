-- Testes da troca de produto sem estoque (com print) e da remoção autorizada (vai para os procurados).
\set QUIET on
reset role;
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set YESSICA  '00000000-0000-0000-0000-000000000004'
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set JULISA   '00000000-0000-0000-0000-0000000000c1'
\set PROD     '00000000-0000-0000-0000-0000000000b1'
\set SUBST    '00000000-0000-0000-0000-0000000000e7'
\set PED      '00000000-0000-0000-0000-0000000000e8'
insert into app.produtos (id, codigo, nome, marca) values (:'SUBST', 'TROCA-01', 'Sebo de Carneiro Morango', 'RHENUKS');
insert into app.precos (produto_id, tabela, valor, vigente_desde) values
  (:'SUBST', 'py_normal', 8000, current_date - 30), (:'SUBST', 'py_vip', 7500, current_date - 30);
insert into app.pedidos (id, origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total)
  values (:'PED', 'manual', :'JULISA', '00000000-0000-0000-0000-0000000000a1', current_date, 'GS', 0);
insert into app.pedido_itens (id, pedido_id, produto_id, codigo, descricao, quantidade, quantidade_pedida, preco_unitario, tabela_preco) values
  ('00000000-0000-0000-0000-0000000000e1', :'PED', :'PROD', 'X1', 'Sebo de Carneiro', 2, 2, 6500, 'py_vip'),
  ('00000000-0000-0000-0000-0000000000e2', :'PED', :'PROD', 'X1', 'Sebo de Carneiro (2)', 3, 3, 6500, 'py_vip');
update app.pedidos set valor_total = 32500 where id = :'PED';

\echo '== Troca de produto sem estoque =='
set role vc_app;
select teste.como(:'YESSICA');
select teste.falha($$select app.trocar_item_pedido('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e7', 2, 'a.jpg', 'a.jpg', 'image/jpeg', 10, 'abc')$$,
  'vendedora do pedido', 'Outra vendedora não troca produto do pedido');
select teste.como(:'KEILA');
select teste.falha($$select app.trocar_item_pedido('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e7', 2, '', null, 'image/jpeg', 0, '')$$,
  'print', 'Troca sem print da conversa é barrada');
select app.trocar_item_pedido('00000000-0000-0000-0000-0000000000e1', :'SUBST', 2, 'a.jpg', 'a.jpg', 'image/jpeg', 10, 'abc', 'cliente aceitou morango');
select teste.ok((select produto_id from app.pedido_itens where id = '00000000-0000-0000-0000-0000000000e1') = :'SUBST'::uuid,
  'Item passa a ser o produto substituto');
select teste.ok((select preco_unitario from app.pedido_itens where id = '00000000-0000-0000-0000-0000000000e1')
               = (select f.preco from app.preco_final_moeda(:'JULISA', :'SUBST', 'GS') f),
  'Preço do substituto é o da tabela do cliente');
select teste.ok((select valor_total from app.pedidos where id = :'PED') = (select sum(total) from app.pedido_itens where pedido_id = :'PED'),
  'Total do pedido é recalculado');
select teste.ok((select count(*) from app.pedido_trocas where pedido_id = :'PED') = 1, 'Troca fica registrada com o print');

\echo '== Remoção autorizada vai para os procurados =='
select teste.falha($$select app.pedir_remocao_item('00000000-0000-0000-0000-0000000000e2', '')$$, 'motivo', 'Pedido de remoção exige motivo');
select app.pedir_remocao_item('00000000-0000-0000-0000-0000000000e2', 'cliente não quis outro aroma');
select teste.falha($$select app.pedir_remocao_item('00000000-0000-0000-0000-0000000000e2', 'de novo')$$, 'aguardando', 'Não duplica pedido de remoção pendente');
select teste.falha(format($$select app.decidir_remocao_item(%L, true)$$, (select id from app.pedido_remocoes where item_id = '00000000-0000-0000-0000-0000000000e2')),
  'gerente ou dono', 'Vendedora não autoriza a própria remoção');
select teste.ok(exists (select 1 from app.pedido_itens where id = '00000000-0000-0000-0000-0000000000e2'), 'Item continua no pedido até autorizar');
select teste.como(:'GERENTE');
select app.decidir_remocao_item((select id from app.pedido_remocoes where item_id = '00000000-0000-0000-0000-0000000000e2'), true, null);
select teste.ok(not exists (select 1 from app.pedido_itens where id = '00000000-0000-0000-0000-0000000000e2'), 'Autorizado: item sai do pedido');
select teste.ok((select valor_total from app.pedidos where id = :'PED') = (select sum(total) from app.pedido_itens where pedido_id = :'PED'),
  'Total recalculado depois da remoção');
select teste.ok(exists (select 1 from app.pedido_itens_indisponiveis where pedido_id = :'PED' and descricao = 'Sebo de Carneiro (2)'),
  'Cliente vê o item como indisponível');
select teste.ok(exists (select 1 from app.procuras where pedido_id = :'PED' and origem = 'pedido' and produto_id = :'PROD' and quantidade = 3
                        and criado_por = :'KEILA'::uuid and cliente_id = :'JULISA'::uuid),
  'Produto tirado entra nos procurados (cliente, quantidade, vendedora)');
select teste.como(:'KEILA');
select teste.ok(exists (select 1 from app.procuras where pedido_id = :'PED'), 'A vendedora vê o registro na lista dela');

\echo '== Depois do total confirmado não muda =='
reset role;
update app.pedidos set total_confirmado_em = now() where id = :'PED';
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.trocar_item_pedido('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 2, 'b.jpg', 'b.jpg', 'image/jpeg', 10, 'def')$$,
  'total já foi confirmado', 'Depois do total confirmado ao cliente não troca');
reset role;
\echo '== Testes de trocas passaram =='
