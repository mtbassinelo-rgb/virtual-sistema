-- Testes da lista de inventário para conferir (CDE). Rodar depois dos outros testes.
\set QUIET on
reset role;
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set PL1 '00000000-0000-0000-0000-00000000e101'
select id as cde from app.depositos where codigo = 'loja-cde' \gset
insert into app.produtos (id, codigo, nome, marca) values (:'PL1', 'LST-ICE', 'COLORS MATIZADOR ICE BLUE 100G MARIA ESCANDALOSA', 'MARIA ESCANDALOSA');
select id as l_ice from app.inventario_lista where lista = 'CDE 23/10/2026' and descricao like 'COLORS MATIZADOR ICE BLUE%' \gset
select id as l_bohi from app.inventario_lista where lista = 'CDE 23/10/2026' and descricao like 'MASCARA CAPILAR BOHIKARI%' \gset
select id as l_agua from app.inventario_lista where lista = 'CDE 23/10/2026' and descricao = 'AGUA MICELAR' \gset

\echo '== Lista de inventário =='
select teste.ok((select count(*) from app.inventario_lista where lista = 'CDE 23/10/2026') = 72, 'A lista de CDE tem 72 linhas');
set role vc_app;
select teste.como(:'KEILA');
select teste.falha(format($$select app.inventario_lista_decidir('[{"id":"%s","decisao":"novo"}]')$$, :'l_bohi'), 'gerente ou dono', 'Vendedora não confere a lista');
select teste.falha($$select app.inventario_lista_lancar('CDE 23/10/2026')$$, 'gerente ou dono', 'Vendedora não lança a lista');
select teste.ok((select count(*) from app.inventario_lista) = 0, 'Vendedora não lê a lista');

select teste.como(:'GERENTE');
select teste.falha(format($$select app.inventario_lista_decidir('[{"id":"%s","decisao":"existente"}]')$$, :'l_ice'), 'Escolha o produto', 'Produto existente exige o produto');
select app.inventario_lista_decidir(format('[{"id":"%s","decisao":"existente","produto_id":"%s","quantidade":"36"},{"id":"%s","decisao":"novo","quantidade":"4"},{"id":"%s","decisao":"ignorar"}]',
  :'l_ice', :'PL1', :'l_bohi', :'l_agua')::jsonb);
select app.inventario_lista_lancar('CDE 23/10/2026') as r \gset
select teste.ok((:'r'::jsonb->>'existentes')::int = 1 and (:'r'::jsonb->>'novos')::int = 1 and (:'r'::jsonb->>'ignorados')::int = 1, 'Lança 1 existente, 1 novo e ignora 1');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cde' and produto_id = :'PL1') = 36, 'Existente: soma 36 em CDE');
select teste.ok((select count(*) from app.produtos where nome like 'MASCARA CAPILAR BOHIKARI%' and codigo like 'CDE-%') = 1, 'Novo: produto cadastrado com código CDE-');
select teste.ok((select s.quantidade from app.estoque_saldos s join app.produtos p on p.id = s.produto_id
                  where p.nome like 'MASCARA CAPILAR BOHIKARI%' and s.deposito_id = :'cde') = 4, 'Novo: 4 unidades em CDE');
select teste.ok(not exists (select 1 from app.estoque_saldos s join app.produtos p on p.id = s.produto_id join app.depositos dp on dp.id = s.deposito_id
                  where p.nome like 'MASCARA CAPILAR BOHIKARI%' and dp.codigo = 'cd-foz' and s.quantidade <> 0), 'Novo: Brasil fica com 0');
select teste.ok(jsonb_array_length(:'r'::jsonb->'fotos') = 2, 'Os dois produtos sem foto recebem a foto da lista');
-- lançar de novo não soma duas vezes
select app.inventario_lista_lancar('CDE 23/10/2026');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cde' and produto_id = :'PL1') = 36, 'Lançar de novo não duplica');
select teste.ok((select count(*) from app.inventario_lista where lista = 'CDE 23/10/2026' and status = 'aberto') = 69, 'As outras 69 linhas continuam abertas');
reset role;
\echo '== Testes da lista de inventário passaram =='
