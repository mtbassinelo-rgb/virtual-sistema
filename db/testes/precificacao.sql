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

\echo '== Frete pelas notas fiscais =='
reset role;
insert into app.fornecedores (id, nome) values ('00000000-0000-0000-0000-00000000f701', 'Fornecedor Notas');
insert into app.produtos (id, codigo, nome, marca) values ('00000000-0000-0000-0000-00000000c701', 'NOT-1', 'Produto Marca Nota', 'MARCA NOTA');
set role vc_app;
select teste.como(:'GERENTE');
select teste.falha($$select app.registrar_compra('00000000-0000-0000-0000-00000000f701', current_date, 100, 30, null, null, null, 100, null)$$, 'informe a marca', 'Quantidade sem marca é recusada');
select app.registrar_compra('00000000-0000-0000-0000-00000000f701', current_date - 5, 1000, 30, 1300, null, 'MARCA NOTA', 100, '123');
select teste.ok(app.frete_produto('00000000-0000-0000-0000-00000000c701') = 0.30, 'Uma nota: frete por produto = frete ÷ produtos');
select app.registrar_compra('00000000-0000-0000-0000-00000000f701', current_date - 1, 1000, 50, 1300, null, 'MARCA NOTA', 100, '124');
select teste.ok(app.frete_produto('00000000-0000-0000-0000-00000000c701') = 0.40, 'Duas notas: média ponderada (80 ÷ 200)');
select teste.ok((select notas = 2 and frete_unidade = 0.40 from app.frete_medio_notas() where marca = 'MARCA NOTA'), 'Resumo de frete por marca');
\echo '== Testes de frete por nota passaram =='

\echo '== Notas a chegar =='
reset role;
insert into app.produtos (id, codigo, nome, marca) values ('00000000-0000-0000-0000-00000000c801', 'NOTA-1', 'Pimenta Negra Teste', 'MARCA CHEGA');
select id as dep from app.depositos where codigo = 'cd-foz' \gset
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.lancar_nota('00000000-0000-0000-0000-00000000f701', current_date, '9992', 'MARCA CHEGA', 861, 10, null, '[{"descricao":"X","quantidade":1,"valor_unit":1}]')$$, 'gerente ou dono', 'Vendedora não lança nota');
select teste.como(:'GERENTE');
select app.lancar_nota('00000000-0000-0000-0000-00000000f701', current_date, '9992', 'MARCA CHEGA', 861, 10, null,
  '[{"codigo":"05","descricao":"PIMENTA NEGRA","quantidade":1200,"valor_unit":2.60,"produto_id":"00000000-0000-0000-0000-00000000c801"},
    {"codigo":"066","descricao":"SPRAY SEM CADASTRO","quantidade":648,"valor_unit":5.00}]') as nota \gset
select teste.ok((select coalesce(sum(quantidade), 0) from app.estoque_saldos where produto_id = '00000000-0000-0000-0000-00000000c801') = 0, 'Nota lançada não sobe estoque');
select teste.ok((select custo_unit from app.compra_itens where compra_id = :'nota' and codigo_nota = '05') = 2.34, 'Custo do item já com o desconto da nota');
select teste.ok((select count(*) from app.frete_medio_notas() where marca = 'MARCA CHEGA') = 0, 'Frete da nota a caminho ainda não entra na média');
select teste.ok((select count(*) from app.produtos where nome = 'SPRAY SEM CADASTRO') = 0, 'Nenhum produto novo é criado');
select teste.ok((app.receber_nota(:'nota', :'dep') ->> 'sem_produto')::int = 1, 'Chegada: avisa o item sem produto ligado');
select teste.ok((select quantidade from app.estoque_saldos where produto_id = '00000000-0000-0000-0000-00000000c801' and deposito_id = :'dep') = 1200, 'Chegada sobe o estoque do item ligado');
select teste.ok((select frete_unidade from app.frete_medio_notas() where marca = 'MARCA CHEGA') = round(861.0 / 1848, 4), 'Frete da nota entra na média da marca (861 ÷ 1848)');
select teste.falha($$select app.receber_nota('$$ || :'nota' || $$', '$$ || :'dep' || $$')$$, 'já foi recebida', 'Não recebe duas vezes');
\echo '== Testes de notas passaram =='

\echo '== Marcar separados em lote =='
reset role;
select id as cli from app.clientes limit 1 \gset
select id as vend from app.vendedoras limit 1 \gset
insert into app.pedidos (id, cliente_id, vendedora_id, deposito_id, moeda, data_pedido, status_comercial, origem, valor_total)
values ('00000000-0000-0000-0000-00000000e901', :'cli', :'vend', :'dep', 'GS', current_date - 2, 'em_separacao', 'manual', 0);
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.marcar_separados_ate(current_date)$$, 'gerente ou dono', 'Vendedora não marca em lote');
select teste.como(:'GERENTE');
select teste.ok(app.marcar_separados_ate(current_date - 1) >= 1, 'Marca os pedidos até a data');
select teste.ok((select separacao_conferida_em is not null from app.pedidos where id = '00000000-0000-0000-0000-00000000e901'), 'Pedido fica como separado');
\echo '== Testes de separados em lote passaram =='



\echo '== Vendas avulsas =='
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.lancar_venda_avulsa((select id from app.depositos where codigo = 'loja-cde'), current_date, 'GS', 1000, 'x')$$, 'gerente ou dono', 'Vendedora não lança venda avulsa');
select teste.como(:'GERENTE');
select teste.falha($$select app.lancar_venda_avulsa((select id from app.depositos where codigo = 'loja-cde'), current_date, 'GS', 0, 'x')$$, 'valor', 'Não aceita valor zero');
select app.lancar_venda_avulsa((select id from app.depositos where codigo = 'loja-cde'), current_date - 3, 'GS', 13000000, 'Vendas antigas pelos comprovantes') as va \gset
select teste.ok((select receita = 13000000 and receita_brl = round(13000000 / coalesce(app.param('cambio_custo_gs'), 1300), 2) and custo_brl is null
                   from app.fin_itens(current_date - 5, current_date) where marca = 'Venda avulsa'), 'Venda avulsa entra no financeiro sem custo');
select app.excluir_venda_avulsa(:'va');
select teste.ok(not exists (select 1 from app.vendas_avulsas where id = :'va'), 'Exclui a venda avulsa');
\echo '== Testes de vendas avulsas passaram =='
