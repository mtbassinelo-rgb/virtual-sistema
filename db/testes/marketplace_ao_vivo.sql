-- Testes da fila ao vivo dos pedidos de marketplace (área do estoquista).
\set QUIET on
reset role;
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set ESTMK    '00000000-0000-0000-0000-0000000e0a01'
\set ESTCDE   '00000000-0000-0000-0000-0000000e0a02'
select id as cd from app.depositos where codigo = 'cd-foz' \gset
select id as cde from app.depositos where codigo = 'loja-cde' \gset
update app.canais set deposito_id = :'cd' where codigo in ('shopee', 'mercado_livre');
insert into app.usuarios (id, email, nome, perfil, ativo) values (:'ESTMK', 'est-mk@teste.local', 'Estoquista MK', 'estoquista', true),
                                                                  (:'ESTCDE', 'est-cde@teste.local', 'Estoquista CDE', 'estoquista', true);
insert into app.deposito_responsaveis values (:'cd', :'ESTMK') on conflict do nothing;
insert into app.deposito_responsaveis values (:'cde', :'ESTCDE') on conflict do nothing;
delete from app.deposito_responsaveis where usuario_id = :'ESTCDE' and deposito_id = :'cd';

\echo '== Fila ao vivo do marketplace =='
set role vc_app;
-- webhook: sem usuário logado
select teste.como('');
select teste.ok(app.marketplace_receber('shopee', '2610ABC', 'shopee-1', 'READY_TO_SHIP', 'a_separar', '{"code":3}',
  '{"comprador":"ana","itens":[{"sku":"SKU-1","descricao":"Creme","quantidade":2,"valor":15.5}],"total":31}') is not null, 'Aviso novo entra na fila');
select teste.ok(app.marketplace_receber('shopee', '2610ABC', 'shopee-1', 'READY_TO_SHIP', 'a_separar', '{"code":3}') is null, 'Aviso repetido é ignorado');
select teste.ok(app.marketplace_receber('mercado_livre', '2000001', 'ml-1', null, null, '{"topic":"orders_v2"}') is not null, 'Aviso sem situação entra a separar');
select teste.falha($$select app.marketplace_receber('direto', '1', 'x', null, null, '{}')$$, 'desconhecido', 'Só canal de marketplace');
select teste.falha($$select app.marketplace_receber('shopee', '  ', 'x2', null, null, '{}')$$, 'sem número', 'Precisa do número');

select teste.como(:'ESTMK');
select id as f1 from app.marketplace_fila where numero_externo = '2610ABC' \gset
select teste.ok((select situacao = 'a_separar' and deposito_id = :'cd' and com_detalhes and total = 31 from app.marketplace_fila where id = :f1),
  'Pedido vai para o depósito do canal, com itens');
select teste.ok((select count(*) from app.marketplace_fila) = 2, 'Estoquista do CD Foz vê a fila do CD');
select teste.como(:'ESTCDE');
select teste.ok((select count(*) from app.marketplace_fila) = 0, 'Estoquista de outra unidade não vê');
select teste.falha(format('select app.marketplace_marcar_separado(%s)', :f1), 'opera o estoque', 'Nem marca como separado');
select teste.como(:'KEILA');
select teste.falha(format('select app.marketplace_marcar_separado(%s)', :f1), 'opera o estoque', 'Vendedora sem o depósito não marca');

select teste.como(:'ESTMK');
select app.marketplace_marcar_separado(:f1);
select teste.ok((select situacao = 'separado' and separado_por = :'ESTMK' from app.marketplace_fila where id = :f1), 'Estoquista marca separado');
select teste.como('');
select app.marketplace_receber('shopee', '2610ABC', 'shopee-2', 'PROCESSED', 'a_separar', '{"code":3}');
select teste.como(:'ESTMK');
select teste.ok((select situacao from app.marketplace_fila where id = :f1) = 'separado', 'Aviso posterior não devolve o separado à fila');
select teste.como('');
select app.marketplace_receber('shopee', '2610ABC', 'shopee-3', 'CANCELLED', 'cancelado', '{"code":3}');
select teste.como(:'ESTMK');
select teste.ok((select situacao = 'cancelado' and cancelado_depois_de_separar from app.marketplace_fila where id = :f1), 'Cancelado depois de separado fica marcado para devolver');
select app.marketplace_confirmar_devolucao(:f1);
select teste.ok(not (select cancelado_depois_de_separar from app.marketplace_fila where id = :f1), 'Estoquista confirma a devolução');
select teste.como('');
select app.marketplace_receber('shopee', '2610ABC', 'shopee-4', 'READY_TO_SHIP', 'a_separar', '{"code":3}');
select teste.como(:'ESTMK');
select teste.ok((select situacao from app.marketplace_fila where id = :f1) = 'cancelado', 'Cancelado não volta');
select id as f2 from app.marketplace_fila where numero_externo = '2000001' \gset
select teste.como('');
select app.marketplace_receber('mercado_livre', '2000001', 'ml-2', 'cancelled', 'cancelado', '{}');
select teste.como(:'ESTMK');
select teste.falha(format('select app.marketplace_marcar_separado(%s)', :f2), 'cancelado', 'Não separa pedido cancelado');
reset role;
\echo '== Testes da fila ao vivo do marketplace passaram =='
