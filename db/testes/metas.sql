-- Testes de metas com premiação. Rodar depois de regras.sql e precos.sql.
\set QUIET on
reset role;
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set YESSICA  '00000000-0000-0000-0000-000000000004'
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set GABRIEL  '00000000-0000-0000-0000-0000000000c5'
\set LAURA    '00000000-0000-0000-0000-0000000000c6'
\set M1 '00000000-0000-0000-0000-0000000000f5'
\set M2 '00000000-0000-0000-0000-0000000000f6'
insert into app.clientes (id, nome, vendedora_id) values
  (:'GABRIEL','Gabriel','00000000-0000-0000-0000-0000000000a1'),
  (:'LAURA','Laura','00000000-0000-0000-0000-0000000000a1');
insert into app.pedidos (id, origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total) values
  ('00000000-0000-0000-0000-0000000000d5','planilha',:'GABRIEL','00000000-0000-0000-0000-0000000000a1', current_date - 20, 'GS', 15000000),
  ('00000000-0000-0000-0000-0000000000d6','planilha',:'GABRIEL','00000000-0000-0000-0000-0000000000a1', current_date - 10, 'GS', 6000000),
  ('00000000-0000-0000-0000-0000000000d7','planilha',:'LAURA','00000000-0000-0000-0000-0000000000a1', current_date - 10, 'GS', 5000000);

\echo '== Metas com premiação =='
set role vc_app;
select teste.como(:'KEILA');
insert into app.metas_cliente (id, cliente_id, vendedora_id, inicio, fim, moeda, valor_meta, valor_premio, descricao_premio)
  values (:'M1', :'GABRIEL', '00000000-0000-0000-0000-0000000000a2', current_date - 25, current_date - 1, 'BRL',
          20000000, 1000000, 'Gs 1.000.000 em mercadoria');
select teste.ok((select status from app.metas_cliente where id = :'M1') = 'proposta', 'Meta nova fica aguardando o gerente');
select teste.ok((select vendedora_id from app.metas_cliente where id = :'M1') = '00000000-0000-0000-0000-0000000000a1'
  and (select moeda from app.metas_cliente where id = :'M1') = 'GS', 'Vendedora e moeda vêm do cadastro do cliente');
select teste.falha($$update app.metas_cliente set status = 'aprovada' where id = '00000000-0000-0000-0000-0000000000f5'$$,
  'gerente', 'Vendedora não aprova a própria meta');
select teste.falha($$select app.decidir_meta('00000000-0000-0000-0000-0000000000f5', true)$$, 'gerente', 'Vendedora não usa a aprovação');
select teste.falha($$insert into app.metas_cliente (cliente_id, vendedora_id, inicio, fim, moeda, valor_meta, valor_premio)
  values ('00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000a1', current_date - 5, current_date + 5, 'GS', 100, 10)$$,
  'uma_meta_por_periodo', 'Cliente não tem duas metas no mesmo período');
select teste.falha($$insert into app.metas_cliente (cliente_id, vendedora_id, inicio, fim, moeda, valor_meta, valor_premio)
  values ('00000000-0000-0000-0000-0000000000c6','00000000-0000-0000-0000-0000000000a1', current_date, current_date + 30, 'GS', 100, 200)$$,
  'premio_menor_que_meta', 'Prêmio não pode ser maior que a meta');
update app.metas_cliente set valor_premio = 900000 where id = :'M1';
update app.metas_cliente set valor_premio = 1000000 where id = :'M1';
select teste.ok(true, 'Vendedora ajusta a proposta enquanto não foi decidida');
insert into app.metas_cliente (id, cliente_id, vendedora_id, inicio, fim, moeda, valor_meta, valor_premio)
  values (:'M2', :'LAURA', '00000000-0000-0000-0000-0000000000a1', current_date - 25, current_date - 1, 'GS', 10000000, 500000);
select teste.ok((select falta from app.v_metas where id = :'M1') = 0 and (select vendido from app.v_metas where id = :'M1') = 21000000,
  'Acompanhamento soma as compras do período (Gs 21 milhões de 20)');
select teste.ok((select falta from app.v_metas where id = :'M2') = 5000000, 'Mostra quanto falta para a meta');

select teste.como(:'YESSICA');
select teste.ok((select count(*) from app.metas_cliente) = 0, 'Outra vendedora não vê metas da Keila');

select teste.como(:'GERENTE');
select teste.ok(app.avaliar_metas() = 0, 'Meta ainda não aprovada não é avaliada');
select teste.falha($$select app.decidir_meta('00000000-0000-0000-0000-0000000000f5', false, '')$$, 'motivo', 'Recusa exige motivo');
select app.decidir_meta(:'M1', true);
select app.decidir_meta(:'M2', true);
select teste.ok((select decidida_por from app.metas_cliente where id = :'M1') = :'GERENTE'::uuid, 'Aprovação registra o gerente');

select teste.como(:'KEILA');
select teste.falha($$update app.metas_cliente set valor_meta = 1000 where id = '00000000-0000-0000-0000-0000000000f5'$$,
  'já decidida', 'Meta aprovada não pode ser alterada');

select teste.como(:'GERENTE');
select teste.ok(app.avaliar_metas() = 2, 'Ao fim do prazo, metas aprovadas são avaliadas');
select teste.ok((select status from app.metas_cliente where id = :'M1') = 'atingida', 'Gabriel atingiu a meta');
select teste.ok((select valor_atingido from app.metas_cliente where id = :'M1') = 21000000, 'Valor atingido fica congelado');
select teste.ok((select status from app.metas_cliente where id = :'M2') = 'nao_atingida', 'Laura não atingiu a meta');
select teste.ok(not (select premio_liberado from app.v_metas where id = :'M1'), 'Prêmio bloqueado enquanto as compras não estão pagas');
select teste.falha($$select app.entregar_premio('00000000-0000-0000-0000-0000000000f5')$$, 'ainda há', 'Não entrega prêmio com compras em aberto');
select teste.falha($$select app.entregar_premio('00000000-0000-0000-0000-0000000000f6')$$, 'meta atingida', 'Não entrega prêmio de meta não atingida');

select teste.como(:'KEILA');
insert into app.pagamentos (id, pedido_id, valor, data, modalidade) values
  ('00000000-0000-0000-0000-0000000000e5','00000000-0000-0000-0000-0000000000d5', 15000000, current_date, 'transferencia'),
  ('00000000-0000-0000-0000-0000000000e6','00000000-0000-0000-0000-0000000000d6', 6000000, current_date, 'transferencia');
select teste.falha($$select app.entregar_premio('00000000-0000-0000-0000-0000000000f5')$$, 'gerente', 'Vendedora não registra entrega de prêmio');
select teste.como(:'GERENTE');
select app.conferir_pagamento('00000000-0000-0000-0000-0000000000e5', 1001);
select app.conferir_pagamento('00000000-0000-0000-0000-0000000000e6', 1002);
select teste.ok((select premio_liberado from app.v_metas where id = :'M1'), 'Com tudo pago e conferido, o prêmio é liberado');
select app.entregar_premio(:'M1', null, 'Entregue em mercadoria Rhenuks');
select teste.ok((select status from app.metas_cliente where id = :'M1') = 'premio_entregue', 'Entrega do prêmio registrada');
select teste.ok((select count(*) from app.auditoria where tabela = 'metas_cliente' and registro_id = '00000000-0000-0000-0000-0000000000f5') >= 5,
  'Proposta, ajustes, aprovação, avaliação e entrega ficaram na auditoria');
reset role;
\echo '== Testes de metas passaram =='
