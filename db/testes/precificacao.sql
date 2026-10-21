-- Testes da tela de precificação. Rodar depois de marcas.sql (usa os produtos CUS-*).
\set QUIET on
reset role;
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set KEILA    '00000000-0000-0000-0000-000000000003'
insert into app.custo_planilha (produto_id, custo_brl, origem, confirmado)
values ('00000000-0000-0000-0000-00000000c502', 4.5, 'parecido: ABA TESTE › linha 9', false);

\echo '== Precificação =='
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.precificacao_py()$$, 'gestão', 'Vendedora não vê a precificação');
select teste.como(:'GERENTE');
select teste.ok((select count(*) from app.precificacao_py() where codigo like 'CUS-%') = 2, 'Mostra os produtos ativos (o desativado fica fora)');
select teste.ok((select custo_brl = 2.34 and sugerido_vip >= preco_minimo and sugerido_normal >= sugerido_vip and situacao = 'margem_alta'
                   from app.precificacao_py() where codigo = 'CUS-A'), 'Calcula sugestão e situação com o custo real');
select teste.ok((select planilha_custo = 4.5 and planilha_origem like 'parecido:%' from app.precificacao_py() where codigo = 'CUS-B'),
  'Custo da planilha diferente do atual aparece para conferir');
select app.definir_marca_inteligencia('MARCA C', true, 'atracao', 20, 15);
select teste.ok((select motor and alvo_vip = 0.15 from app.precificacao_py() where codigo = 'CUS-A'), 'Margem-alvo da marca do motor substitui o padrão');
select teste.ok((select (app.importar_custos('[{"codigo":"CUS-B","custo":4.5,"origem":"Editado na precificação"}]'::jsonb) ->> 'custos')::int) = 1, 'Editar custo na tela grava');
select teste.ok((select planilha_custo is null and custo_origem = 'Editado na precificação' from app.precificacao_py() where codigo = 'CUS-B'),
  'Depois de usar o custo da planilha a dica some e a origem fica registrada');
\echo '== Testes de precificação passaram =='

\echo '== Frete padrão e kits =='
reset role;
insert into app.produtos (id, codigo, nome, marca) values
  ('00000000-0000-0000-0000-00000000c601', 'FRE-1', 'Creme Maycrene', 'MAYCRENE'),
  ('00000000-0000-0000-0000-00000000c602', 'FRE-2', 'Kit Maycrene Biotina (Shampoo + Condicionador + Máscara)', 'MAYCRENE'),
  ('00000000-0000-0000-0000-00000000c603', 'FRE-3', 'KIT CAPILAR 2 ITENS ARRUDA', 'MARCA SEM FRETE');
insert into app.frete_marca (marca, frete_unidade_brl) values ('MAYCRENE', 0.80) on conflict (marca) do update set frete_unidade_brl = 0.80;
select teste.ok(app.frete_produto('00000000-0000-0000-0000-00000000c601') = 0.80, 'Maycrene: R$ 0,80 por produto');
select teste.ok(app.frete_produto('00000000-0000-0000-0000-00000000c602') = 2.40, 'Kit Maycrene de 3 produtos: 3 × 0,80');
select teste.ok(app.frete_produto('00000000-0000-0000-0000-00000000c603') = 0.70, 'Kit de 2 itens sem frete da marca: 2 × padrão 0,35');
\echo '== Testes de frete passaram =='
