-- Testes dos produtos pendentes enviados pela vendedora.
\set QUIET on
reset role;
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set YESSICA  '00000000-0000-0000-0000-000000000004'
\set GERENTE  '00000000-0000-0000-0000-000000000002'
select id as cde from app.depositos where codigo = 'loja-cde' \gset
\echo '== Produtos pendentes =='
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.enviar_produto_pendente((select id from app.depositos where codigo = 'loja-cde'), 'Shampoo Uva', 'maycrene', 6, 25000, 22000, '', 'image/jpeg', null)$$,
  'foto', 'Sem foto não envia');
select app.enviar_produto_pendente(:'cde', 'Shampoo Babalu Uva 500ml', 'maycrene', 6, 25000, 22000, 'pend-x.jpg', 'image/jpeg', 'frasco roxo') as pend \gset
select teste.ok((select status from app.produtos_pendentes where id = :'pend') = 'pendente', 'Pendente criado');
select teste.como(:'YESSICA');
select teste.ok(not exists (select 1 from app.produtos_pendentes where id = :'pend'), 'Outra vendedora não vê o pendente');
select teste.como(:'KEILA');
select teste.falha(format($$select app.aprovar_produto_pendente(%L, null, null, null, 6, 25000, 22000)$$, :'pend'), 'gerente ou dono', 'Vendedora não atualiza');
select teste.como(:'GERENTE');
select app.aprovar_produto_pendente(:'pend', null, 'Shampoo Babalu Uva 500ml', 'maycrene', 6, 25000, 22000) as r \gset
select teste.ok((select quantidade from app.estoque_saldos s join app.produtos p on p.id = s.produto_id
                  where p.codigo like 'VEND-%' and s.deposito_id = :'cde') = 6, 'Quantidade entra no estoque da loja CDE');
select teste.ok((select valor from app.precos z join app.produtos p on p.id = z.produto_id where p.codigo like 'VEND-%' and z.tabela = 'cde_normal') = 25000,
  'Preço normal vai para a tabela CDE');
select teste.ok((select valor from app.precos z join app.produtos p on p.id = z.produto_id where p.codigo like 'VEND-%' and z.tabela = 'cde_vip') = 22000,
  'Preço VIP vai para a tabela CDE VIP');
select teste.ok((select mostrar_no_site and ativo from app.produtos where codigo like 'VEND-%'), 'Produto novo fica ativo e no catálogo');
select teste.falha(format($$select app.aprovar_produto_pendente(%L, null, null, null, 6, 25000, 22000)$$, :'pend'), 'já foi decidido', 'Não atualiza duas vezes');
reset role;
\echo '== Testes de pendentes passaram =='
