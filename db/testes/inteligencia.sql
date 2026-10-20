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

\echo '== Testes da inteligência comercial passaram =='
