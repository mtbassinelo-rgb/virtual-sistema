-- Testes das marcas-gatilho e sugestões de preço. Rodar depois de custos.sql (usa os produtos CUS-*).
\set QUIET on
reset role;
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set KEILA    '00000000-0000-0000-0000-000000000003'

\echo '== Marcas-gatilho =='
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.definir_marca_inteligencia('MARCA C', true, 'rentabilidade')$$, 'gerente ou dono', 'Vendedora não escolhe marcas do motor');
select teste.falha($$select app.sugestoes_preco_py()$$, 'gestão', 'Vendedora não vê sugestões de preço');
select teste.como(:'GERENTE');
select teste.falha($$select app.definir_marca_inteligencia('MARCA C', true, 'rentabilidade', 20, 30)$$, 'VIP não pode', 'Margem VIP maior que a normal é recusada');
select app.definir_marca_inteligencia('MARCA C', true, 'rentabilidade', 35, 25, 'teste');
select teste.ok((select gatilho and papel = 'rentabilidade' from app.marcas_resumo_py() where marca = 'MARCA C'), 'Marca aparece marcada como gatilho no resumo');
select teste.ok((select count(*) from app.sugestoes_preco_py() where marca = 'MARCA C') >= 1, 'Gera sugestão para produto da marca-gatilho');
select teste.ok((select motivo = 'margem_acima_alvo' and vip_sugerido < preco_vip and normal_sugerido >= preco_minimo
                   from app.sugestoes_preco_py() where codigo = 'CUS-A'), 'Preço muito acima do alvo vira sugestão de baixar, nunca abaixo do mínimo');
select teste.ok((select count(*) from app.sugestoes_preco_py() where marca <> 'MARCA C' or marca is null) = 0, 'Só marcas marcadas entram');
select teste.ok(app.gerar_sugestoes_preco_py() >= 1, 'Registra sugestões pendentes');
select teste.ok(app.gerar_sugestoes_preco_py() = (select count(*) from app.sugestoes_preco where status = 'pendente'), 'Gerar de novo renova sem duplicar');
select app.decidir_sugestao_preco((select id from app.sugestoes_preco where status = 'pendente' and produto_id = '00000000-0000-0000-0000-00000000c501'), 'aceita');
select teste.ok((select valor from app.precos where produto_id = '00000000-0000-0000-0000-00000000c501' and tabela = 'py_vip' order by vigente_desde desc limit 1) = 8500,
  'Aceitar sugestão NÃO altera o preço de venda');
select teste.falha($$select app.decidir_sugestao_preco((select id from app.sugestoes_preco where status = 'aceita' limit 1), 'recusada')$$, 'já decidida', 'Sugestão decidida não muda de novo');
select app.definir_marca_inteligencia('MARCA C', false, 'acompanhar');
select teste.ok((select count(*) from app.sugestoes_preco_py()) = 0, 'Desmarcar a marca tira do motor');
reset role;
select teste.ok((select count(*) from app.auditoria where tabela = 'marcas_inteligencia') >= 2, 'Escolha de marcas fica na auditoria');
\echo '== Testes de marcas passaram =='
