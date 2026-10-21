-- Testes da importação de custos reais (planilha). Rodar depois de inteligencia.sql.
\set QUIET on
reset role;
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set KEILA    '00000000-0000-0000-0000-000000000003'
insert into app.produtos (id, codigo, nome, marca, custo, unidades_caixa) values
  ('00000000-0000-0000-0000-00000000c501', 'CUS-A', 'Produto Custo A', 'MARCA C', 500, 12),
  ('00000000-0000-0000-0000-00000000c502', 'CUS-B', 'Produto Custo B sem preço', 'MARCA C', 0, 12);
insert into app.produtos (id, codigo, nome, marca, ativo) values ('00000000-0000-0000-0000-00000000c503', 'CUS-C', 'Produto Custo C inativo', 'MARCA C', false);
insert into app.precos (produto_id, tabela, valor, vigente_desde) values
  ('00000000-0000-0000-0000-00000000c501', 'py_normal', 9000, current_date - 10), ('00000000-0000-0000-0000-00000000c501', 'py_vip', 8500, current_date - 10);

\echo '== Custos reais da planilha =='
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.importar_custos('[{"codigo":"CUS-A","custo":2}]')$$, 'gerente ou dono', 'Vendedora não importa custos');
select teste.como(:'GERENTE');
select teste.ok((select (app.importar_custos('[
  {"codigo":"CUS-A","custo":2.34,"frete":0.35,"normal":7000,"vip":6500},
  {"codigo":"CUS-B","custo":4.00,"frete":0.35,"normal":11000,"vip":10500},
  {"codigo":"CUS-C","custo":5.00,"frete":0.35,"normal":12000,"vip":11000},
  {"codigo":"NAO-EXISTE","custo":1}]'::jsonb) ->> 'custos')::int) = 3, 'Grava o custo dos 3 produtos encontrados');
select teste.ok(app.custo_produto('00000000-0000-0000-0000-00000000c501') = 2.34, 'Custo real da planilha substitui o custo errado do Bling');
select teste.ok(app.frete_produto('00000000-0000-0000-0000-00000000c501') = 0.35, 'Frete por unidade gravado');
select teste.ok((select valor from app.precos where produto_id = '00000000-0000-0000-0000-00000000c501' and tabela = 'py_vip' order by vigente_desde desc limit 1) = 8500,
  'Preço de venda existente NÃO muda');
select teste.ok((select valor from app.precos where produto_id = '00000000-0000-0000-0000-00000000c502' and tabela = 'py_normal' order by vigente_desde desc limit 1) = 11000,
  'Preço em branco é preenchido com o sugerido');
select teste.ok((select not ativo from app.produtos where id = '00000000-0000-0000-0000-00000000c503'), 'Produto desativado continua desativado');
select teste.ok((select (app.importar_custos('[{"codigo":"NAO-EXISTE","custo":1}]'::jsonb) -> 'nao_encontrados') ? 'NAO-EXISTE'), 'Código não encontrado é informado');
reset role;
update app.produtos set custo = 999 where id = '00000000-0000-0000-0000-00000000c501';
select teste.ok(app.custo_produto('00000000-0000-0000-0000-00000000c501') = 2.34, 'Nova importação do Bling (custo) não apaga o custo real');
select teste.ok((select count(*) from app.auditoria where tabela = 'produtos' and registro_id = '00000000-0000-0000-0000-00000000c501' and depois ? 'custo_unitario_brl') >= 1,
  'Mudança de custo fica na auditoria');
\echo '== Testes de custos passaram =='
