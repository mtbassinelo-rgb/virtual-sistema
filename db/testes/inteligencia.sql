-- Testes do motor de inteligência comercial, fase 1 (custos, frete, rentabilidade do Paraguai).
-- Rodar depois dos outros testes (usa os mesmos usuários).
\set QUIET on
reset role;
\set DONO     '00000000-0000-0000-0000-000000000001'
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set CONSULTA '00000000-0000-0000-0000-000000000005'
\set PI1 '00000000-0000-0000-0000-00000000f101'
\set PI2 '00000000-0000-0000-0000-00000000f102'
\set PI3 '00000000-0000-0000-0000-00000000f103'
\set KIT '00000000-0000-0000-0000-00000000f104'

-- Câmbio de custo fixo para o teste (outros testes podem ter mudado)
create temp table cambio_antes as select valor from app.parametros where chave = 'cambio_custo_gs';
update app.parametros set valor = 1300 where chave = 'cambio_custo_gs';

-- Produtos de teste: sebo (com caixa e preços), shampoo sem marca com frete, kit de dois
insert into app.produtos (id, codigo, nome, marca, custo, unidades_caixa) values
  (:'PI1', 'INT-SEBO', 'Sebo de Carneiro Teste', 'MARCA INT', 2.34, 12),
  (:'PI2', 'INT-SHAMP', 'Shampoo Teste', 'MARCA SEM FRETE', 5.00, 12),
  (:'PI3', 'INT-COND', 'Condicionador Teste', 'MARCA INT', 4.00, 12);
insert into app.produtos (id, codigo, nome, marca, tipo, unidades_caixa) values (:'KIT', 'INT-KIT', 'Kit Teste', 'MARCA INT', 'kit', 6);
insert into app.kit_componentes (kit_id, componente_id, quantidade) values (:'KIT', :'PI1', 1), (:'KIT', :'PI3', 1);
insert into app.precos (produto_id, tabela, valor, vigente_desde) values
  (:'PI1', 'py_normal', 7000, current_date - 10), (:'PI1', 'py_vip', 6500, current_date - 10),
  (:'PI2', 'py_normal', 9000, current_date - 10);

\echo '== Inteligência comercial: frete e custos =='
set role vc_app;
select teste.como('');
select teste.falha($$select * from app.rentabilidade_py()$$, 'gestão', 'Sem usuário identificado não vê a rentabilidade');
select teste.falha($$select app.definir_frete_marca('MARCA INT', 0.35)$$, 'gerente ou dono', 'Sem usuário identificado não altera o frete');
select teste.como(:'KEILA');
select teste.falha($$select app.definir_frete_marca('MARCA INT', 0.35)$$, 'gerente ou dono', 'Vendedora não altera o frete');
select teste.falha($$select * from app.rentabilidade_py()$$, 'gestão', 'Vendedora não vê a rentabilidade');
select teste.ok((select count(*) from app.custos_variaveis) = 0, 'Vendedora não lê os custos variáveis');

select teste.como(:'CONSULTA');
select teste.falha($$select app.definir_frete_marca('MARCA INT', 0.35)$$, 'gerente ou dono', 'Consulta não altera o frete');
select teste.ok((select count(*) from app.rentabilidade_py()) > 0, 'Consulta vê a rentabilidade');

select teste.como(:'GERENTE');
select app.definir_frete_marca('MARCA INT', 0.35, 'teste');
select teste.ok(app.frete_produto(:'PI1') = 0.35, 'Produto sem exceção usa o frete da marca');
select teste.ok(app.frete_produto(:'PI2') is null, 'Marca sem frete cadastrado: frete desconhecido');
select teste.ok(app.frete_produto(:'KIT') = 0.70, 'Kit soma o frete dos componentes');
select app.definir_frete_produto(:'PI3', 0.50);
select teste.ok(app.frete_produto(:'PI3') = 0.50, 'Exceção por produto vale sobre a marca');
select teste.ok(app.frete_produto(:'KIT') = 0.85, 'Kit acompanha a exceção do componente');
select teste.falha($$select app.definir_frete_marca('MARCA INT', -1)$$, 'negativo', 'Frete negativo é recusado');
select teste.ok((select sum(percentual) from app.custos_variaveis_vigentes('PY') where base = 'venda') = 4, 'Imposto do Paraguai vigente: 4%');
select teste.ok((select valor from app.custos_variaveis_vigentes('PY') where tipo = 'entrega' and base = 'caixa') = 7000, 'Pasero: 7.000 Gs por caixa');

\echo '== Inteligência comercial: rentabilidade do Paraguai =='
-- Sebo: custo real 2,69 × 1.300 = 3.497 Gs; entrega 7.000 ÷ 12 = 583 Gs; imposto 4%
select teste.ok((select custo_real_gs from app.rentabilidade_py() where produto_id = :'PI1') = 3497, 'Custo real em Gs = (custo + frete) × câmbio de custo');
select teste.ok((select entrega_unidade_gs from app.rentabilidade_py() where produto_id = :'PI1') = 583, 'Entrega por unidade = custo da caixa ÷ unidades');
select teste.ok((select margem_bruta_vip from app.rentabilidade_py() where produto_id = :'PI1') = 0.4620, 'Margem bruta VIP = (preço − custo real) ÷ preço');
select teste.ok((select contribuicao_vip from app.rentabilidade_py() where produto_id = :'PI1') = 0.3323, 'Margem de contribuição VIP desconta imposto e entrega');
select teste.ok((select preco_minimo from app.rentabilidade_py() where produto_id = :'PI1') = 4500, 'Preço mínimo para empatar, arredondado para cima em 500');
select teste.ok((select completo and alertas = '{}' from app.rentabilidade_py() where produto_id = :'PI1'), 'Produto com todos os dados: completo e sem alertas');
select teste.ok((select margem_bruta_vip_cambio_real > margem_bruta_vip from app.rentabilidade_py() where produto_id = :'PI1'),
  'No câmbio real de compra a margem é maior (folga do câmbio)');
select teste.ok((select 'sem_frete' = any(alertas) and 'sem_preco_vip' = any(alertas) and not completo
  from app.rentabilidade_py() where produto_id = :'PI2'), 'Sem frete e sem preço VIP: alertas e cálculo incompleto');
select teste.ok((select contribuicao_vip is null from app.rentabilidade_py() where produto_id = :'PI2'), 'Sem dados, a margem não é inventada');

-- Margem mínima de 20% (só o dono altera parâmetros) e preço abaixo do mínimo
reset role;
update app.parametros set valor = 20 where chave = 'margem_minima_contribuicao';
set role vc_app;
select teste.como(:'GERENTE');
select teste.ok((select preco_minimo from app.rentabilidade_py() where produto_id = :'PI1') = 5500, 'Com margem mínima de 20% o preço mínimo sobe');
reset role;
insert into app.precos (produto_id, tabela, valor, vigente_desde) values (:'PI1', 'py_vip', 4000, current_date);
set role vc_app;
select teste.como(:'GERENTE');
select teste.ok((select 'abaixo_minimo' = any(alertas) and 'contribuicao_negativa' = any(alertas)
  from app.rentabilidade_py() where produto_id = :'PI1'), 'Preço VIP abaixo do mínimo e contribuição negativa são sinalizados');

-- Nova vigência de imposto vale a partir da data e mantém o histórico
select app.definir_custo_variavel('PY', 'imposto', 'venda', 10, null, null, current_date, 'teste');
select teste.ok((select sum(percentual) from app.custos_variaveis_vigentes('PY') where base = 'venda') = 10, 'Nova vigência do imposto passa a valer');
select teste.ok((select sum(percentual) from app.custos_variaveis_vigentes('PY', current_date - 1) where base = 'venda') = 4, 'Data anterior continua com o imposto antigo');
reset role;
select teste.ok((select count(*) from app.auditoria where tabela = 'frete_marca') >= 1, 'Alteração de frete fica na auditoria');
select teste.ok((select count(*) from app.auditoria where tabela = 'custos_variaveis' and acao = 'INSERT') >= 1, 'Alteração de custos fica na auditoria');
update app.parametros set valor = 0 where chave = 'margem_minima_contribuicao';
update app.parametros set valor = (select valor from cambio_antes) where chave = 'cambio_custo_gs';


\echo '== Fornecedores e compras =='
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.definir_fornecedor(null, 'Fornecedor X', 7, null, null)$$, 'gerente ou dono', 'Vendedora não cadastra fornecedor');
select teste.ok((select count(*) from app.compras) = 0, 'Vendedora não lê compras');
select teste.como(:'GERENTE');
select app.definir_fornecedor(null, 'Fornecedor Teste', 10, 1000, 'teste') as forn \gset
select teste.ok((select prazo_reposicao_dias from app.fornecedores where id = :'forn') = 10, 'Gerente cadastra fornecedor com prazo de reposição');
select app.registrar_compra(:'forn', current_date - 3, 1000, 100, 1150, 'nota 1') as compra1 \gset
select app.registrar_compra(:'forn', current_date - 2, 500, 0, 1120, null) as compra2 \gset
select teste.ok((select total from app.compras where id = :'compra1') = 1100, 'Total da compra = produtos + frete');
select teste.ok((select total_brl from app.v_compras_mensal where mes = to_char(current_date - 2, 'YYYY-MM')) >= 1600, 'Resumo mensal soma as compras do mês');
select teste.ok((select total_gs from app.v_compras_mensal where mes = to_char(current_date - 2, 'YYYY-MM')) >= 1100 * 1150 + 500 * 1120, 'Resumo mensal converte em Gs pelo câmbio de cada compra');
select teste.falha($$select app.registrar_compra('$$ || :'forn' || $$', current_date + 30, 10, 0, null, null)$$, 'data', 'Compra com data no futuro é recusada');
select app.excluir_compra(:'compra2');
select teste.ok((select count(*) from app.compras where id = :'compra2') = 0, 'Gerente exclui compra lançada errada');
reset role;
select teste.ok((select count(*) from app.auditoria where tabela = 'compras' and acao = 'DELETE') >= 1, 'Exclusão de compra fica na auditoria');

\echo '== Classificação dos produtos =='
-- Kit com preços: diferenciação. Produto com estoque e sem venda: parado. Shampoo sem dados: incompleto.
insert into app.precos (produto_id, tabela, valor, vigente_desde) values
  (:'KIT', 'py_normal', 30000, current_date - 10), (:'KIT', 'py_vip', 28000, current_date - 10),
  (:'PI3', 'py_normal', 15000, current_date - 10), (:'PI3', 'py_vip', 14000, current_date - 10);
insert into app.estoque_movimentos (deposito_id, produto_id, tipo, quantidade, observacao)
values ((select id from app.depositos where codigo = 'cd-foz'), :'PI3', 'ajuste_entrada', 48, 'teste');
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select * from app.classificacao_py()$$, 'gestão', 'Vendedora não vê a classificação');
select teste.como(:'GERENTE');
select teste.ok((select categoria from app.classificacao_py() where produto_id = :'KIT') = 'diferenciacao', 'Kit completo é produto de diferenciação');
select teste.ok((select categoria from app.classificacao_py() where produto_id = :'PI3') = 'parado', 'Com estoque e sem venda em 90 dias: estoque parado');
select teste.ok((select categoria from app.classificacao_py() where produto_id = :'PI2') = 'incompleto', 'Sem dados completos: não classifica');
select teste.ok((select recomendacao is not null from app.classificacao_py() where produto_id = :'PI3'), 'Todo produto recebe uma recomendação');
select teste.ok(app.registrar_classificacao_py() > 0, 'Foto do dia é gravada');
select teste.ok(app.registrar_classificacao_py() = 0, 'Foto do dia é gravada uma vez só');
select teste.ok((select categoria from app.produto_classificacao where data = current_date and produto_id = :'KIT') = 'diferenciacao', 'Foto guarda a categoria');
reset role;

\echo '== Retire em Foz: cliente local e simulação =='
set role vc_app;
select teste.como(:'KEILA');
select teste.ok(app.sugerir_cliente_local('00000000-0000-0000-0000-0000000000c1') = 'sugerido', 'Vendedora sugere cliente local');
select teste.ok((select not cliente_local and cliente_local_sugerido_por is not null from app.clientes where id = '00000000-0000-0000-0000-0000000000c1'),
  'Sugestão não marca o cliente: espera o gerente');
select teste.falha($$select app.sugerir_cliente_local('00000000-0000-0000-0000-0000000000c2')$$, 'permissão', 'Vendedora não sugere cliente de outra vendedora');
select teste.falha($$select app.decidir_cliente_local('00000000-0000-0000-0000-0000000000c1', true)$$, 'gerente ou dono', 'Vendedora não aprova cliente local');
select teste.falha($$update app.clientes set cliente_local = true where id = '00000000-0000-0000-0000-0000000000c1'$$, null, 'Vendedora não marca cliente local direto');
select teste.como(:'GERENTE');
select app.decidir_cliente_local('00000000-0000-0000-0000-0000000000c1', true);
select teste.ok((select cliente_local and cliente_local_sugerido_por is null from app.clientes where id = '00000000-0000-0000-0000-0000000000c1'), 'Gerente aprova: cliente local');
select teste.falha($$select app.decidir_cliente_local('00000000-0000-0000-0000-0000000000c3', true)$$, 'Paraguai', 'Cliente do Brasil não vira cliente local');
reset role;
insert into app.pedidos (id, origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total)
values ('00000000-0000-0000-0000-00000000f201', 'planilha', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', current_date, 'GS', 168000);
insert into app.pedido_itens (pedido_id, produto_id, descricao, quantidade, preco_unitario)
values ('00000000-0000-0000-0000-00000000f201', :'PI1', 'Sebo de Carneiro Teste', 24, 7000);
update app.pedidos set status_comercial = 'em_separacao' where id = '00000000-0000-0000-0000-00000000f201';
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select * from app.simular_retirada_foz(current_date - 30, current_date)$$, 'gestão', 'Vendedora não vê a simulação');
select teste.como(:'GERENTE');
select teste.ok((select caixas >= 2 and desconto >= 14000 from app.simular_retirada_foz(current_date - 30, current_date) where mes = to_char(current_date, 'YYYY-MM')),
  'Simulação: 24 unidades em caixas de 12 = 2 caixas × 7.000 Gs de desconto');
reset role;
update app.parametros set valor = 5000 where chave = 'retirada_foz_teto_mes';
set role vc_app;
select teste.como(:'GERENTE');
select teste.ok((select desconto from app.simular_retirada_foz(current_date - 30, current_date) where mes = to_char(current_date, 'YYYY-MM')) = 5000,
  'Teto mensal limita o desconto simulado');
reset role;
update app.parametros set valor = 0 where chave = 'retirada_foz_teto_mes';

\echo '== Testes da inteligência comercial passaram =='
