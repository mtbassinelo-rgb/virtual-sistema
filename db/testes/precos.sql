-- Testes de preços por moeda e tabela. Rodar depois de regras.sql (usa os mesmos dados).
\set QUIET on
reset role;
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set P1 '00000000-0000-0000-0000-0000000000d1'
insert into app.vendedoras (id, nome, pais, moeda) values ('00000000-0000-0000-0000-0000000000a3','Crislaine','BR','BRL');
insert into app.clientes (id, nome, vendedora_id) values ('00000000-0000-0000-0000-0000000000c3','Tainara','00000000-0000-0000-0000-0000000000a3');
insert into app.produtos (id, codigo, nome, fornecedor) values ('00000000-0000-0000-0000-0000000000b1','RHE-001','Sebo de Carneiro','Rhenuks');
insert into app.precos (produto_id, tabela, valor, vigente_desde) values
  ('00000000-0000-0000-0000-0000000000b1','py_normal',7000,current_date - 30),
  ('00000000-0000-0000-0000-0000000000b1','py_vip',6500,current_date - 30),
  ('00000000-0000-0000-0000-0000000000b1','br_normal',3.59,current_date - 30),
  ('00000000-0000-0000-0000-0000000000b1','br_vip',3.12,current_date - 30);

\echo '== Preços por moeda e tabela =='
set role vc_app;
select teste.como(:'KEILA');
select teste.ok((select tabela_preco from app.clientes where id='00000000-0000-0000-0000-0000000000c1') = 'py_normal',
  'Cliente do Paraguai recebe a tabela normal em Gs');
select teste.ok((select (app.preco_para_cliente('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1')).valor) = 7000,
  'Cliente normal vê Gs 7.000');
update app.clientes set categoria_preco = 'vip' where id = '00000000-0000-0000-0000-0000000000c1';
select teste.ok((select (app.preco_para_cliente('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1')).valor) = 6500,
  'Cliente VIP vê Gs 6.500');
select teste.ok((select (app.preco_para_cliente('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1')).moeda) = 'GS',
  'Preço do cliente paraguaio vem em Gs');
reset role;
select teste.ok((select (app.preco_para_cliente('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000b1')).valor) = 3.59
  and (select (app.preco_para_cliente('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000b1')).moeda) = 'BRL',
  'Cliente do Brasil, normal, vê R$ 3,59');
update app.clientes set categoria_preco = 'vip' where id = '00000000-0000-0000-0000-0000000000c3';
select teste.ok((select (app.preco_para_cliente('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000b1')).valor) = 3.12,
  'Cliente do Brasil, VIP, vê R$ 3,12');
select teste.ok((select moeda from app.clientes where id = '00000000-0000-0000-0000-0000000000c3') = 'BRL'
  and (select moeda from app.clientes where id = '00000000-0000-0000-0000-0000000000c1') = 'GS', 'Moeda do cliente segue o país do cadastro');
select teste.falha($$update app.clientes set tabela_preco = 'py_vip' where id = '00000000-0000-0000-0000-0000000000c3'$$, null,
  'Tabela não é digitada à mão: sai de país + categoria');

set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$insert into app.precos (produto_id, tabela, valor) values ('00000000-0000-0000-0000-0000000000b1','py_vip',1)$$,
  'row-level security', 'Vendedora não altera preços');
insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco)
  values (:'P1','00000000-0000-0000-0000-0000000000b1','RHE-001','Sebo de Carneiro',12,6500,'py_vip');
select teste.ok((select total from app.pedido_itens where pedido_id = :'P1') = 78000, 'Item calcula o total (12 × Gs 6.500)');
select teste.falha($$insert into app.pedido_itens (pedido_id, descricao, quantidade, preco_unitario, tabela_preco)
  values ('00000000-0000-0000-0000-0000000000d1','Teste',1,3.59,'br_normal')$$, 'não pode entrar',
  'Preço em R$ não entra em pedido em Gs');
select teste.falha($$insert into app.pedido_itens (pedido_id, descricao, quantidade, preco_unitario)
  select id, 'Teste', 1, 1 from app.pedidos where bling_id = 70001$$, 'só mudam no bling', 'Itens de pedido do Bling não são editados no sistema');

select teste.como(:'GERENTE');
insert into app.precos (produto_id, tabela, valor, vigente_desde) values ('00000000-0000-0000-0000-0000000000b1','py_vip',7000,current_date + 1);
select teste.ok((select (app.preco_para_cliente('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1')).valor) = 6500,
  'Reajuste com data futura não muda o preço de hoje');
select teste.ok((select (app.preco_para_cliente('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1', current_date + 1)).valor) = 7000,
  'Reajuste vale a partir da data definida');
select teste.ok((select preco_unitario from app.pedido_itens where pedido_id = :'P1') = 6500, 'Preço do pedido já feito fica congelado');
select teste.ok((select count(*) from app.auditoria where tabela = 'precos') >= 4, 'Mudanças de preço ficam na auditoria');
reset role;
\echo '== Testes de preços passaram =='
