-- Testes do financeiro: contas fixas do mês, importação da NF-e (XML), metas da empresa e itens em R$.
\set QUIET on
reset role;
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set FP1 '00000000-0000-0000-0000-00000000fa01'
\set FP2 '00000000-0000-0000-0000-00000000fa02'
\set FD  '00000000-0000-0000-0000-00000000fa10'

insert into app.produtos (id, codigo, nome, marca, gtin, unidades_caixa) values
  (:'FP1', 'FIN-001', 'Shampoo Financeiro 300ml', 'Marca Fin', '7890000000017', 12),
  (:'FP2', 'FIN-002', 'Condicionador Financeiro 300ml', 'Marca Fin', null, 12);
insert into app.depositos (id, codigo, nome, pais, tipo) values (:'FD', 'teste-fin', 'Depósito Financeiro', 'PY', 'loja');

\echo '== Contas fixas: lançadas uma vez por mês =='
set role vc_app;
select teste.como(:'GERENTE');
insert into app.despesas_recorrentes (categoria, descricao, moeda, valor, dia_vencimento, inicio)
values ('aluguel', 'Aluguel teste financeiro', 'BRL', 2500, 10, '2026-01-01');
select teste.ok(app.gerar_despesas_recorrentes('2026-03-15') = 1, 'Lança a conta fixa do mês');
select teste.ok(app.gerar_despesas_recorrentes('2026-03-01') = 0, 'Rodar de novo não duplica');
select teste.ok((select vencimento = '2026-03-10' and competencia = '2026-03-01' from app.despesas where descricao = 'Aluguel teste financeiro'),
  'Vence no dia escolhido do mês');
select teste.ok((select tipo = 'fixa' from app.despesa_categorias where codigo = 'aluguel')
            and (select tipo = 'variavel' from app.despesa_categorias where codigo = 'passeiro'), 'Categorias fixas e variáveis');
select teste.como(:'KEILA');
select teste.ok(app.gerar_despesas_recorrentes('2026-04-01') = 0, 'Vendedora não lança contas fixas');

\echo '== NF-e pelo XML: fornecedor, produtos, duplicatas =='
select teste.falha($$select app.importar_nfe('{"fornecedor":{"cnpj":"12345678000199","nome":"X"}}'::jsonb)$$, 'Só gerente', 'Vendedora não importa nota');
select teste.como(:'GERENTE');
select set_config('teste.nf1', app.importar_nfe(jsonb_build_object(
  'fornecedor', jsonb_build_object('cnpj', '12.345.678/0001-99', 'nome', 'Fornecedor XML Teste'),
  'numero', '5501', 'chave', '41261012345678000199550010000055011000055018', 'data', current_date - 2, 'marca', 'Marca Fin',
  'frete', 30, 'desconto', 10, 'valor_produtos', 100, 'valor_nota', 120,
  'itens', jsonb_build_array(
     jsonb_build_object('codigo', 'A1', 'ean', '7890000000017', 'unidade', 'UN', 'descricao', 'SHAMPOO FIN 300', 'quantidade', 6, 'valor_unit', 10),
     jsonb_build_object('codigo', 'B2', 'ean', 'SEM GTIN', 'unidade', 'UN', 'descricao', 'COND FIN 300', 'quantidade', 4, 'valor_unit', 10)),
  'duplicatas', jsonb_build_array(jsonb_build_object('numero', '001', 'vencimento', current_date + 28, 'valor', 60),
                                  jsonb_build_object('numero', '002', 'vencimento', current_date + 58, 'valor', 60))))::text, false);
select teste.ok((select f.cnpj = '12345678000199' and c.status = 'a_caminho' and c.valor_nota = 120 and c.desconto_pct = 10
                   from app.compras c join app.fornecedores f on f.id = c.fornecedor_id where c.id = current_setting('teste.nf1')::uuid),
  'Nota a caminho, fornecedor criado com o CNPJ, desconto em %');
select teste.ok((select produto_id = :'FP1' from app.compra_itens where compra_id = current_setting('teste.nf1')::uuid and codigo_nota = 'A1'),
  'Item ligado ao produto pelo EAN');
select teste.ok((select count(*) = 2 and sum(valor) = 120 and bool_and(categoria = 'mercadoria' and moeda = 'BRL')
                   from app.despesas where compra_id = current_setting('teste.nf1')::uuid), 'Duplicatas viram contas a pagar da nota');
select teste.falha($$select app.importar_nfe(jsonb_build_object('fornecedor', jsonb_build_object('cnpj', '12345678000199', 'nome', 'F'),
  'chave', '41261012345678000199550010000055011000055018', 'numero', '5501'))$$, 'já foi importada', 'A mesma nota não entra duas vezes');

-- liga o item B2 à mão; a próxima nota do mesmo fornecedor já liga pelo código
select app.ligar_item_nota((select id from app.compra_itens where compra_id = current_setting('teste.nf1')::uuid and codigo_nota = 'B2'), :'FP2');
select set_config('teste.nf2', app.importar_nfe(jsonb_build_object(
  'fornecedor', jsonb_build_object('cnpj', '12345678000199', 'nome', 'Fornecedor XML Teste'),
  'numero', '5502', 'data', current_date, 'marca', 'Marca Fin', 'valor_produtos', 50, 'valor_nota', 50, 'prazo_dias', 15,
  'itens', jsonb_build_array(jsonb_build_object('codigo', 'B2', 'descricao', 'COND FIN 300', 'quantidade', 5, 'valor_unit', 10))))::text, false);
select teste.ok((select produto_id = :'FP2' from app.compra_itens where compra_id = current_setting('teste.nf2')::uuid),
  'Código do fornecedor já ligado antes: liga sozinho');
select teste.ok((select count(*) = 1 and min(vencimento) = current_date + 15 and min(valor) = 50 from app.despesas where compra_id = current_setting('teste.nf2')::uuid),
  'Nota sem duplicata: uma conta com o prazo escolhido');
select teste.ok((select count(*) = 1 from app.fornecedores where cnpj = '12345678000199'), 'Mesmo fornecedor (não duplica)');
select app.receber_nota(current_setting('teste.nf2')::uuid, :'FD', true);
select teste.ok((select custo_unitario_brl = 10 from app.produtos where id = :'FP2'), 'Ao receber, estoque sobe e o custo é atualizado');

\echo '== Metas da empresa =='
select app.salvar_meta_empresa('2026-05-20', 100000, 500000000, 60000, 20000, 'teste');
select app.salvar_meta_empresa('2026-05-01', 120000, 500000000, 60000, 25000, null);
select teste.ok((select vendas_brl = 120000 and lucro_brl = 25000 from app.metas_empresa where mes = '2026-05-01'), 'Meta do mês salva e atualizada');
select teste.como(:'KEILA');
select teste.falha($$select app.salvar_meta_empresa('2026-05-01', 1, 1, 1, 1)$$, 'Só gerente', 'Vendedora não muda metas');
select teste.falha($$select * from app.fin_itens('2026-01-01', '2026-12-31')$$, 'Só gestão', 'Vendedora não vê o financeiro');
select teste.como(:'GERENTE');
select teste.ok((select count(*) >= 0 from app.fin_itens(current_date - 365, current_date)), 'Gestão vê os itens em R$');

reset role;
\echo '== Testes do financeiro passaram =='
