-- Testes do caixa diário e do inventário por unidade. Rodar depois dos outros testes.
\set QUIET on
reset role;
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set PROD2    '00000000-0000-0000-0000-0000000000b2'
select id as cde from app.depositos where codigo = 'loja-cde' \gset

\echo '== Inventário da loja de CDE =='
set role vc_app;
select teste.como(:'KEILA');
select teste.falha(format($$select app.registrar_inventario(%L, '[{"produto_id":"%s","contado":"5"}]')$$, :'cde', :'PROD2'),
  'responsável', 'Vendedora sem responsabilidade não registra inventário');
select teste.como(:'GERENTE');
select teste.ok(app.registrar_inventario(:'cde', format('[{"produto_id":"%s","contado":"10"}]', :'PROD2')::jsonb) = 1, 'Inventário grava o saldo contado');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cde' and produto_id = :'PROD2') = 10, 'Saldo de CDE fica igual ao contado (10)');

\echo '== Caixa diário =='
select teste.como(:'KEILA');
select app.abrir_caixa(:'cde', 100000, 0) as caixa \gset
select teste.falha(format($$select app.abrir_caixa(%L, 0, 0)$$, :'cde'), 'Já existe um caixa aberto', 'Só um caixa aberto por unidade');
select teste.falha(format($$select app.venda_balcao(%L, null, 'GS', '[{"produto_id":"%s","quantidade":2}]', '[{"modalidade":"efetivo","valor":20000}]')$$, :'caixa', :'PROD2'),
  'Falta receber', 'Cliente avulso precisa pagar a venda inteira');
select teste.falha(format($$select app.venda_balcao(%L, null, 'GS', '[{"produto_id":"%s","quantidade":2}]', '[{"modalidade":"efetivo","valor":99000}]')$$, :'caixa', :'PROD2'),
  'maior que o total', 'Não recebe mais que o total (o troco sai do caixa)');
select app.venda_balcao(:'caixa', null, 'GS', format('[{"produto_id":"%s","quantidade":2}]', :'PROD2')::jsonb,
  '[{"modalidade":"efetivo","valor":20000},{"modalidade":"pix","valor":14000}]'::jsonb) as venda \gset
select teste.ok((select status_comercial::text from app.pedidos where id = :'venda') = 'entregue', 'Venda de balcão já sai entregue');
select teste.ok((select valor_total from app.pedidos where id = :'venda') = 34000, 'Preço da tabela normal em Gs (2 × 17.000)');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cde' and produto_id = :'PROD2') = 8, 'Venda baixa o estoque de CDE (10 - 2)');
select teste.ok((select count(*) from app.pagamentos where pedido_id = :'venda') = 2, 'As duas formas de pagamento ficam no pedido');
select teste.ok(app.caixa_esperado(:'caixa', 'GS') = 120000, 'Gaveta: fundo 100.000 + 20.000 em efetivo (Pix não entra na gaveta)');
select app.movimento_caixa(:'caixa', 'sangria', 'GS', 50000, 'Depósito no banco');
select teste.falha(format($$select app.movimento_caixa(%L, 'despesa', 'GS', 1000, '')$$, :'caixa'), 'motivo', 'Despesa precisa de motivo');
select teste.ok(app.caixa_esperado(:'caixa', 'GS') = 70000, 'Sangria sai da gaveta');
select teste.falha(format($$select app.fechar_caixa(%L, 60000, 0, '')$$, :'caixa'), 'não bate', 'Diferença no fechamento exige explicação');
select teste.ok((app.fechar_caixa(:'caixa', 70000, 0, null)->>'diferenca_gs')::numeric = 0, 'Fechamento sem diferença');
select teste.falha(format($$select app.movimento_caixa(%L, 'reforco', 'GS', 1000, 'troco')$$, :'caixa'), 'já foi fechado', 'Caixa fechado não aceita lançamento');
reset role;

\echo '== Grupos de fragrância =='
set role vc_app;
select teste.como(:'KEILA');
select teste.falha(format($$select app.definir_grupos('[{"produto_id":"%s","grupo":"X","variante":"Y"}]')$$, :'PROD2'), 'Só gerente', 'Vendedora não agrupa produtos');
select teste.como(:'GERENTE');
select teste.ok(app.definir_grupos(format('[{"produto_id":"%s","grupo":"MOUSSE RHENUKS","variante":"Rosa"}]', :'PROD2')::jsonb) = 1, 'Gerente agrupa');
select teste.ok((select variante from app.grupos_publicos() where produto_id = :'PROD2') = 'Rosa', 'Site enxerga o grupo e a fragrância');
select app.definir_grupos(format('[{"produto_id":"%s","grupo":"","variante":"Rosa"}]', :'PROD2')::jsonb);
select teste.ok((select grupo is null and variante is null from app.produtos where id = :'PROD2'), 'Grupo vazio desfaz o agrupamento');
reset role;
\echo '== Testes do caixa passaram =='
