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
select app.trocar_item_pedido('00000000-0000-0000-0000-0000000000e1', :'SUBST', 2, '', null, '', 0, '', 'cliente aceitou morango');
select teste.ok((select arquivo is null from app.pedido_trocas where item_id = '00000000-0000-0000-0000-0000000000e1'),
  'Troca sem print é aceita (print opcional)');
select teste.ok((select produto_id from app.pedido_itens where id = '00000000-0000-0000-0000-0000000000e1') = :'SUBST'::uuid,
  'Item passa a ser o produto substituto');
select teste.ok((select preco_unitario from app.pedido_itens where id = '00000000-0000-0000-0000-0000000000e1')
               = (select f.preco from app.preco_final_moeda(:'JULISA', :'SUBST', 'GS') f),
  'Preço do substituto é o da tabela do cliente');
select teste.ok((select valor_total from app.pedidos where id = :'PED') = (select sum(total) from app.pedido_itens where pedido_id = :'PED'),
  'Total do pedido é recalculado');
select teste.ok((select count(*) from app.pedido_trocas where pedido_id = :'PED') = 1, 'Troca fica registrada');

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

\echo '== Vendedora ajusta o pedido antes da separação =='
reset role;
update app.pedidos set status_comercial = 'aguardando_aprovacao' where id = :'PED';
insert into app.produtos (id, codigo, nome, marca) values ('00000000-0000-0000-0000-0000000000e9', 'EDIT-01', 'Máscara Nova', 'RHENUKS');
insert into app.precos (produto_id, tabela, valor, vigente_desde) values
  ('00000000-0000-0000-0000-0000000000e9', 'py_normal', 9000, current_date - 30), ('00000000-0000-0000-0000-0000000000e9', 'py_vip', 8500, current_date - 30);
set role vc_app;
select teste.como(:'YESSICA');
select teste.falha($$select app.editar_itens_pedido('00000000-0000-0000-0000-0000000000e8', '[{"item_id":"00000000-0000-0000-0000-0000000000e1","quantidade":5}]')$$,
  'vendedora do pedido', 'Outra vendedora não edita o pedido');
select teste.como(:'KEILA');
select app.editar_itens_pedido(:'PED', '[{"item_id":"00000000-0000-0000-0000-0000000000e1","quantidade":5},{"produto_id":"00000000-0000-0000-0000-0000000000e9","quantidade":4}]');
select teste.ok((select quantidade from app.pedido_itens where id = '00000000-0000-0000-0000-0000000000e1') = 5, 'Vendedora muda a quantidade');
select teste.ok(exists (select 1 from app.pedido_itens where pedido_id = :'PED' and produto_id = '00000000-0000-0000-0000-0000000000e9' and quantidade = 4), 'Vendedora acrescenta produto');
select teste.ok((select valor_total from app.pedidos where id = :'PED') = (select sum(total) from app.pedido_itens where pedido_id = :'PED'),
  'Total recalculado depois do ajuste');
select teste.falha($$select app.editar_itens_pedido('00000000-0000-0000-0000-0000000000e8',
  (select jsonb_agg(jsonb_build_object('item_id', id, 'quantidade', 0)) from app.pedido_itens where pedido_id = '00000000-0000-0000-0000-0000000000e8'))$$,
  'sem itens', 'Não deixa o pedido sem itens');
select app.decidir_pedido_portal(:'PED', true, null);
select teste.ok((select status_comercial::text from app.pedidos where id = :'PED') = 'em_separacao', 'A própria vendedora manda para a separação');

\echo '== Vendedora ajusta na separação (parâmetro vendedora_ajusta_separacao) =='
reset role;
update app.parametros set valor = 0 where chave = 'vendedora_ajusta_separacao';
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.editar_itens_pedido('00000000-0000-0000-0000-0000000000e8', '[]')$$, 'separação', 'Desligado: na separação não edita por aqui');
reset role;
update app.parametros set valor = 1 where chave = 'vendedora_ajusta_separacao';
set role vc_app;
select teste.como(:'KEILA');
select app.editar_itens_pedido(:'PED', '[{"item_id":"00000000-0000-0000-0000-0000000000e1","quantidade":3}]');
select teste.ok((select quantidade = 3 and quantidade_pedida = 3 from app.pedido_itens where id = '00000000-0000-0000-0000-0000000000e1'),
  'Ligado: vendedora diminui a quantidade na separação');
select teste.falha($$select app.editar_itens_pedido('00000000-0000-0000-0000-0000000000e8', '[{"item_id":"00000000-0000-0000-0000-0000000000e1","quantidade":9}]')$$,
  'só dá para diminuir', 'Na separação não aumenta');
select teste.falha($$select app.editar_itens_pedido('00000000-0000-0000-0000-0000000000e8', '[{"produto_id":"00000000-0000-0000-0000-0000000000b1","quantidade":2}]')$$,
  'acrescentar', 'Na separação não acrescenta produto');
reset role;
update app.pedidos set separacao_conferida_em = now() where id = :'PED';
set role vc_app;
select teste.como(:'KEILA');
select app.editar_itens_pedido(:'PED', (select jsonb_build_array(jsonb_build_object('item_id', id, 'quantidade', 0))
  from app.pedido_itens where pedido_id = :'PED' and produto_id = '00000000-0000-0000-0000-0000000000e9'));
select teste.ok(not exists (select 1 from app.pedido_itens where pedido_id = :'PED' and produto_id = '00000000-0000-0000-0000-0000000000e9'),
  'Depois da expedição conferir, vendedora tira o item');
select teste.ok((select valor_total from app.pedidos where id = :'PED') = (select sum(total) from app.pedido_itens where pedido_id = :'PED'),
  'Total recalculado depois do ajuste na separação');
select teste.como(:'YESSICA');
select teste.falha($$select app.editar_itens_pedido('00000000-0000-0000-0000-0000000000e8', '[{"item_id":"00000000-0000-0000-0000-0000000000e1","quantidade":1}]')$$,
  'vendedora do pedido', 'Outra vendedora não ajusta na separação');

\echo '== Depois do total confirmado não muda =='
reset role;
update app.pedidos set total_confirmado_em = now() where id = :'PED';
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.trocar_item_pedido('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 2, 'b.jpg', 'b.jpg', 'image/jpeg', 10, 'def')$$,
  'total já foi confirmado', 'Depois do total confirmado ao cliente não troca');
reset role;

\echo '== Cancelar pedido =='
insert into app.pedidos (id, origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total, status_comercial) values
  ('00000000-0000-0000-0000-0000000000f1', 'manual', :'JULISA', '00000000-0000-0000-0000-0000000000a1', current_date, 'GS', 0, 'em_separacao'),
  ('00000000-0000-0000-0000-0000000000f2', 'manual', :'JULISA', '00000000-0000-0000-0000-0000000000a1', current_date, 'GS', 0, 'em_separacao'),
  ('00000000-0000-0000-0000-0000000000f3', 'manual', :'JULISA', '00000000-0000-0000-0000-0000000000a1', current_date, 'GS', 0, 'enviado');
insert into app.pagamentos (pedido_id, valor, data, modalidade) values ('00000000-0000-0000-0000-0000000000f2', 1000, current_date, 'pix');
update app.parametros set valor = 0 where chave = 'vendedora_cancela_pedido';
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.cancelar_pedido('00000000-0000-0000-0000-0000000000f1', 'cliente desistiu')$$, 'só para o gerente', 'Desligado: vendedora não cancela');
reset role;
update app.parametros set valor = 1 where chave = 'vendedora_cancela_pedido';
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.cancelar_pedido('00000000-0000-0000-0000-0000000000f1', '  ')$$, 'motivo', 'Cancelar exige motivo');
select teste.como(:'YESSICA');
select teste.falha($$select app.cancelar_pedido('00000000-0000-0000-0000-0000000000f1', 'x')$$, 'vendedora do pedido', 'Outra vendedora não cancela');
select teste.como(:'KEILA');
select app.cancelar_pedido('00000000-0000-0000-0000-0000000000f1', 'cliente desistiu');
select teste.ok((select status_comercial::text = 'cancelado' and observacoes like '%cliente desistiu%' from app.pedidos where id = '00000000-0000-0000-0000-0000000000f1'),
  'Vendedora cancela o próprio pedido em separação (motivo fica registrado)');
select teste.falha($$select app.cancelar_pedido('00000000-0000-0000-0000-0000000000f1', 'de novo')$$, 'já está cancelado', 'Não cancela duas vezes');
select teste.falha($$select app.cancelar_pedido('00000000-0000-0000-0000-0000000000f2', 'cliente desistiu')$$, 'pagamento', 'Com pagamento registrado só o gerente cancela');
select teste.falha($$select app.cancelar_pedido('00000000-0000-0000-0000-0000000000f3', 'cliente desistiu')$$, 'já saiu', 'Pedido enviado: vendedora não cancela');
select teste.como(:'GERENTE');
select app.cancelar_pedido('00000000-0000-0000-0000-0000000000f2', 'cliente desistiu, devolver pix');
select app.cancelar_pedido('00000000-0000-0000-0000-0000000000f3', 'devolvido pelo cliente');
select teste.ok((select count(*) from app.pedidos where id in ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3') and status_comercial = 'cancelado') = 2,
  'Gerente cancela com pagamento e depois de enviado');
reset role;
\echo '== Testes de trocas passaram =='
