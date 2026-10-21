-- Testes da lista de recompra. Rodar depois de inteligencia.sql (usa os mesmos usuários e produtos).
\set QUIET on
reset role;
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set R1 '00000000-0000-0000-0000-00000000e101'
\set R2 '00000000-0000-0000-0000-00000000e102'
\set R3 '00000000-0000-0000-0000-00000000e103'
\set R4 '00000000-0000-0000-0000-00000000e104'
insert into app.clientes (id, nome, vendedora_id, pais, whatsapp) values
  (:'R1', 'Recompra Atrasada', '00000000-0000-0000-0000-0000000000a1', 'PY', '595981111111'),
  (:'R2', 'Recompra Nova',     '00000000-0000-0000-0000-0000000000a1', 'PY', null),
  (:'R3', 'Recompra Inativa',  '00000000-0000-0000-0000-0000000000a2', 'PY', null),
  (:'R4', 'Recompra Voltou',   '00000000-0000-0000-0000-0000000000a1', 'PY', null);
-- R1: compra a cada 30 dias e está há 40 sem comprar
insert into app.pedidos (id, origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total, status_comercial) values
  ('00000000-0000-0000-0000-00000000e201', 'planilha', :'R1', '00000000-0000-0000-0000-0000000000a1', current_date - 100, 'GS', 300000, 'em_separacao'),
  ('00000000-0000-0000-0000-00000000e202', 'planilha', :'R1', '00000000-0000-0000-0000-0000000000a1', current_date - 70,  'GS', 300000, 'em_separacao'),
  ('00000000-0000-0000-0000-00000000e203', 'planilha', :'R1', '00000000-0000-0000-0000-0000000000a1', current_date - 40,  'GS', 300000, 'em_separacao'),
  ('00000000-0000-0000-0000-00000000e204', 'planilha', :'R2', '00000000-0000-0000-0000-0000000000a1', current_date - 10,  'GS', 100000, 'em_separacao'),
  ('00000000-0000-0000-0000-00000000e205', 'planilha', :'R3', '00000000-0000-0000-0000-0000000000a2', current_date - 300, 'GS', 100000, 'em_separacao'),
  ('00000000-0000-0000-0000-00000000e206', 'planilha', :'R3', '00000000-0000-0000-0000-0000000000a2', current_date - 150, 'GS', 100000, 'em_separacao'),
  ('00000000-0000-0000-0000-00000000e207', 'planilha', :'R4', '00000000-0000-0000-0000-0000000000a1', current_date - 400, 'GS', 100000, 'em_separacao'),
  ('00000000-0000-0000-0000-00000000e208', 'planilha', :'R4', '00000000-0000-0000-0000-0000000000a1', current_date - 5,   'GS', 100000, 'em_separacao'),
  ('00000000-0000-0000-0000-00000000e209', 'planilha', :'R1', '00000000-0000-0000-0000-0000000000a1', current_date - 2,   'GS', 999000, 'cancelado');
insert into app.pedido_itens (pedido_id, produto_id, descricao, quantidade, preco_unitario)
select p, '00000000-0000-0000-0000-00000000f101', 'Sebo de Carneiro Teste', 12, 7000
  from unnest(array['00000000-0000-0000-0000-00000000e201','00000000-0000-0000-0000-00000000e202','00000000-0000-0000-0000-00000000e203']::uuid[]) p;

\echo '== Recompra =='
set role vc_app;
select teste.como('');
select teste.falha($$select * from app.recompra_clientes()$$, 'não identificado', 'Sem usuário não vê a lista');
select teste.como(:'KEILA');
select teste.ok((select situacao from app.recompra_clientes() where cliente_id = :'R1') = 'atrasado', 'Compra a cada 30 dias e está há 40: atrasado');
select teste.ok((select intervalo_dias from app.recompra_clientes() where cliente_id = :'R1') = 30, 'Intervalo normal calculado pelos pedidos');
select teste.ok((select atraso_dias from app.recompra_clientes() where cliente_id = :'R1') = 10, 'Atraso = dias desde a última − intervalo');
select teste.ok((select pedidos from app.recompra_clientes() where cliente_id = :'R1') = 3, 'Pedido cancelado não conta');
select teste.ok((select 'Sebo de Carneiro Teste' = any(produtos) from app.recompra_clientes() where cliente_id = :'R1'), 'Mostra o que o cliente costuma levar');
select teste.ok((select situacao from app.recompra_clientes() where cliente_id = :'R2') = 'novo', 'Um pedido recente: cliente novo');
select teste.ok((select recuperado and situacao = 'em_dia' from app.recompra_clientes() where cliente_id = :'R4'), 'Voltou a comprar depois de inativo: recuperado');
select teste.ok((select count(*) from app.recompra_clientes() where cliente_id = :'R3') = 0, 'Vendedora não vê cliente de outra vendedora');
select teste.como(:'GERENTE');
select teste.ok((select situacao from app.recompra_clientes() where cliente_id = :'R3') = 'inativo', 'Gerente vê todos; 150 dias sem comprar: inativo');
reset role;
\echo '== Testes da recompra passaram =='
