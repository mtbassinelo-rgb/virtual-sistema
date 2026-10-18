-- Testes do estoque com o Bling como fonte oficial (migração 0030). Rodar depois dos outros testes.
\set QUIET on
reset role;
\set DONO    '00000000-0000-0000-0000-000000000001'
\set GERENTE '00000000-0000-0000-0000-000000000002'
\set KEILA   '00000000-0000-0000-0000-000000000003'
select id as cd from app.depositos where codigo = 'cd-foz' \gset
select id as cde from app.depositos where codigo = 'loja-cde' \gset

-- Produtos próprios deste teste
insert into app.produtos (id, codigo, nome, bling_produto_id) values
  ('00000000-0000-0000-0000-0000000bb001','TB-X','Produto X', 50001),
  ('00000000-0000-0000-0000-0000000bb002','TB-Y','Produto Y', 50002),
  ('00000000-0000-0000-0000-0000000bb003','TB-Z','Produto Z', 50003),
  ('00000000-0000-0000-0000-0000000bb004','TB-W','Produto W', 50004),
  ('00000000-0000-0000-0000-0000000bb005','TB-V','Produto V', 50005);
insert into app.produtos (id, codigo, nome, tipo, bling_produto_id) values
  ('00000000-0000-0000-0000-0000000bb010','TB-KIT','Kit X+Y', 'kit', 50010);
insert into app.kit_componentes values
  ('00000000-0000-0000-0000-0000000bb010','00000000-0000-0000-0000-0000000bb001',1),
  ('00000000-0000-0000-0000-0000000bb010','00000000-0000-0000-0000-0000000bb002',2);
insert into app.bling_situacoes values (6, 'Em aberto', 'aberto') on conflict (id) do nothing;
-- Keila vende do CD por padrão (pedidos dela vindos do Bling caem no CD)
update app.vendedora_depositos set padrao = false where vendedora_id = '00000000-0000-0000-0000-0000000000a1';
insert into app.vendedora_depositos values ('00000000-0000-0000-0000-0000000000a1', :'cd', true)
  on conflict (vendedora_id, deposito_id) do update set padrao = true;

\set X '00000000-0000-0000-0000-0000000bb001'
\set Y '00000000-0000-0000-0000-0000000bb002'
\set Z '00000000-0000-0000-0000-0000000bb003'
\set KIT '00000000-0000-0000-0000-0000000bb010'

\echo '== Fonte do estoque por depósito =='
select teste.ok((select fonte_estoque from app.depositos where id = :'cd') = 'sistema', 'Depósitos começam com estoque próprio: a migração não muda nada sozinha');
set role vc_app;
select teste.como(:'GERENTE');
select teste.falha(format($$select app.definir_fonte_estoque(%L, 'bling', 1001)$$, :'cd'), 'só o dono', 'Gerente não muda a fonte do estoque');
select teste.como(:'DONO');
select teste.falha(format($$select app.definir_fonte_estoque(%L, 'bling')$$, :'cd'), 'fonte_bling_tem_vinculo', 'Fonte Bling exige o ID do depósito no Bling');
select app.definir_fonte_estoque(:'cd', 'bling', 1001);
select teste.ok((select fonte_estoque from app.depositos where id = :'cd') = 'bling', 'Dono liga a fonte Bling no CD');
reset role;

\echo '== Leitura de saldos do Bling =='
set role vc_sync;
select app.sinc_iniciar('bling', 'saldos') as s1 \gset
select teste.ok((app.bling_registrar_saldos(:'cd', '[
  {"bling_produto_id": 50001, "codigo": "TB-X", "saldo_fisico": 10, "saldo_virtual": 10},
  {"bling_produto_id": 50002, "codigo": "TB-Y", "saldo_fisico": 6,  "saldo_virtual": 6},
  {"bling_produto_id": 50003, "codigo": "TB-Z", "saldo_fisico": 3,  "saldo_virtual": 3},
  {"bling_produto_id": 50010, "codigo": "TB-KIT", "saldo_fisico": 99, "saldo_virtual": 99}]', :s1)->>'lidos')::int = 4,
  'Leitura com 4 produtos aceita');
select app.sinc_finalizar(:s1, true, 4);
reset role;
select teste.ok(app.saldo_disponivel(:'cd', :'X') = 10, 'Disponível = saldo do Bling (10)');
select teste.ok(not exists (select 1 from app.bling_estoque_saldos where produto_id = :'KIT'), 'Saldo próprio do SKU de kit no Bling é ignorado');
select teste.ok(app.saldo_disponivel(:'cd', :'KIT') = 3, 'Kit = componentes: min(10 X, 6 Y / 2) = 3');
select teste.ok((select confiavel from app.disponibilidade(:'cd', :'X')), 'Saldo recém-lido é confiável');

set role vc_sync;
select teste.falha(format($$select app.bling_registrar_saldos(%L, '[{"bling_produto_id": 50001, "saldo_fisico": 0, "saldo_virtual": 0},
  {"bling_produto_id": 50002, "saldo_fisico": null, "saldo_virtual": 1}]')$$, :'cd'), 'incompleto', 'Resposta incompleta é rejeitada inteira');
reset role;
select teste.ok((select saldo_fisico from app.bling_estoque_saldos where deposito_id = :'cd' and produto_id = :'X') = 10,
  'Após resposta incompleta o saldo anterior fica (nada zerado)');

set role vc_sync;
select app.bling_registrar_saldos(:'cd', '[{"bling_produto_id": 50002, "codigo": "TB-Y", "saldo_fisico": 8, "saldo_virtual": 8}]');
reset role;
select teste.ok((select saldo_fisico from app.bling_estoque_saldos where deposito_id = :'cd' and produto_id = :'X') = 10
  and (select saldo_fisico from app.bling_estoque_saldos where deposito_id = :'cd' and produto_id = :'Y') = 8,
  'Leitura parcial só muda quem veio; produto ausente não vira zero');
select teste.ok((select count(*) from app.bling_estoque_historico where produto_id = :'Y') = 2, 'Mudança de saldo fica no histórico');

set role vc_sync;
select app.bling_registrar_saldos(:'cd', '[{"bling_produto_id": 50003, "codigo": "TB-Z", "saldo_fisico": -2, "saldo_virtual": -2},
  {"bling_produto_id": 77777, "codigo": "NAO-CADASTRADO", "saldo_fisico": 4, "saldo_virtual": 4}]');
reset role;
select teste.ok(app.saldo_disponivel(:'cd', :'Z') = 0, 'Saldo negativo no Bling vira disponível 0, nunca negativo');
select teste.ok(exists (select 1 from app.estoque_divergencias where tipo = 'negativo_no_bling' and produto_id = :'Z' and status = 'aberta'),
  'Saldo negativo no Bling vira divergência');
select teste.ok(exists (select 1 from app.estoque_divergencias where tipo = 'produto_sem_vinculo' and codigo = 'NAO-CADASTRADO' and status = 'aberta'),
  'Produto do Bling sem cadastro vira divergência');
set role vc_sync;
select app.bling_registrar_saldos(:'cd', '[{"bling_produto_id": 50003, "codigo": "TB-Z", "saldo_fisico": 3, "saldo_virtual": 3}]');
reset role;
select teste.ok(not exists (select 1 from app.estoque_divergencias where tipo = 'negativo_no_bling' and produto_id = :'Z' and status = 'aberta'),
  'Divergência de negativo fecha sozinha quando o saldo volta');

\echo '== Quarentena =='
update app.parametros set valor = 2 where chave = 'bling_quarentena_minimo';
set role vc_sync;
select app.bling_registrar_saldos(:'cd', '[{"bling_produto_id": 50004, "codigo": "TB-W", "saldo_fisico": 5, "saldo_virtual": 5},
  {"bling_produto_id": 50005, "codigo": "TB-V", "saldo_fisico": 5, "saldo_virtual": 5}]');
select teste.ok((app.bling_registrar_saldos(:'cd', '[
  {"bling_produto_id": 50001, "saldo_fisico": 0, "saldo_virtual": 0},
  {"bling_produto_id": 50002, "saldo_fisico": 0, "saldo_virtual": 0},
  {"bling_produto_id": 50004, "saldo_fisico": 0, "saldo_virtual": 0},
  {"bling_produto_id": 50005, "saldo_fisico": 0, "saldo_virtual": 0}]')->>'quarentena')::boolean,
  'Leitura que zera 4 de 5 produtos vai para quarentena');
reset role;
select teste.ok((select saldo_fisico from app.bling_estoque_saldos where deposito_id = :'cd' and produto_id = :'X') = 10,
  'Em quarentena nada é gravado');
select teste.ok(exists (select 1 from app.estoque_divergencias where tipo = 'quarentena' and status = 'aberta'), 'Quarentena aparece nas divergências');
set role vc_sync;
select app.bling_registrar_saldos(:'cd', '[{"bling_produto_id": 50004, "saldo_fisico": 0, "saldo_virtual": 0}]');
reset role;
select teste.ok((select saldo_fisico from app.bling_estoque_saldos where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-0000000bb004') = 0
  and not exists (select 1 from app.estoque_divergencias where tipo = 'quarentena' and status = 'aberta'),
  'Zerar 1 produto de verdade é aceito e fecha a quarentena');

\echo '== Dado velho e integração com falha não confirmam disponibilidade =='
update app.bling_estoque_saldos set lido_em = now() - interval '3 hours' where produto_id = :'X';
select teste.ok(app.saldo_disponivel(:'cd', :'X') = 0 and not (select confiavel from app.disponibilidade(:'cd', :'X')),
  'Saldo lido há 3 horas não confirma disponibilidade');
select teste.ok((select quantidade from app.disponibilidade(:'cd', :'X')) = 10, 'O último saldo conhecido continua guardado (não foi zerado)');
update app.bling_estoque_saldos set lido_em = now() where produto_id = :'X';
set role vc_sync;
select app.sinc_finalizar(app.sinc_iniciar('bling','saldos'), false, 0, 0, 0, 'HTTP 503');
select app.sinc_finalizar(app.sinc_iniciar('bling','saldos'), false, 0, 0, 0, 'HTTP 503');
select app.sinc_finalizar(app.sinc_iniciar('bling','saldos'), false, 0, 0, 0, 'timeout');
reset role;
select teste.ok(app.integracao_em_alerta('bling') and app.saldo_disponivel(:'cd', :'X') = 0,
  '3 falhas seguidas: integração em alerta e nada é confirmado');
select teste.ok((select falhas_seguidas from app.integracao_saude where fonte = 'bling') = 3
  and (select ultimo_erro from app.integracao_saude where fonte = 'bling') = 'timeout', 'Falhas e último erro ficam registrados');
set role vc_sync;
select app.sinc_finalizar(app.sinc_iniciar('bling','saldos'), true);
reset role;
select teste.ok(not app.integracao_em_alerta('bling') and app.saldo_disponivel(:'cd', :'X') = 10, 'Sincronização boa volta ao normal');

\echo '== Reservas =='
insert into app.pedidos (id, origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total, deposito_id)
  values ('00000000-0000-0000-0000-0000000be001','manual','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1', current_date, 'GS', 1, :'cd');
insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario)
  values ('00000000-0000-0000-0000-0000000be001', :'X', 'TB-X', 'Produto X', 3, 1);
select teste.ok(app.reservado(:'cd', :'X') = 3 and app.saldo_disponivel(:'cd', :'X') = 7, 'Pedido em separação reserva 3: disponível 10 - 3 = 7');
select app.recalcular_reservas('00000000-0000-0000-0000-0000000be001');
select app.recalcular_reservas('00000000-0000-0000-0000-0000000be001');
select teste.ok((select count(*) from app.estoque_reservas where pedido_id = '00000000-0000-0000-0000-0000000be001') = 1
  and app.reservado(:'cd', :'X') = 3, 'Recalcular de novo não duplica a reserva');
update app.pedidos set status_comercial = 'cancelado' where id = '00000000-0000-0000-0000-0000000be001';
select teste.ok(app.reservado(:'cd', :'X') = 0 and app.saldo_disponivel(:'cd', :'X') = 10
  and (select status from app.estoque_reservas where pedido_id = '00000000-0000-0000-0000-0000000be001') = 'liberada',
  'Cancelamento libera a reserva');

-- Pedido de kit reserva os componentes
insert into app.pedidos (id, origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total, deposito_id)
  values ('00000000-0000-0000-0000-0000000be002','manual','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1', current_date, 'GS', 1, :'cd');
insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario)
  values ('00000000-0000-0000-0000-0000000be002', :'KIT', 'TB-KIT', 'Kit', 2, 1);
select teste.ok(app.reservado(:'cd', :'X') = 2 and app.reservado(:'cd', :'Y') = 4, '2 kits reservam 2 X e 4 Y');
select teste.ok(app.saldo_disponivel(:'cd', :'KIT') = 2, 'Kits disponíveis: min(8 X, 4 Y / 2) = 2');

-- Enviado em depósito com fonte Bling: o extrato próprio está vazio; o envio não trava, vira pendência,
-- e a reserva continua até o pedido aparecer atendido no Bling
update app.pedidos set status_comercial = 'enviado' where id = '00000000-0000-0000-0000-0000000be002';
select teste.ok((select status_comercial from app.pedidos where id = '00000000-0000-0000-0000-0000000be002') = 'enviado',
  'Envio não é travado pela diferença do extrato próprio');
select teste.ok((select count(*) from app.estoque_pendencias where pedido_id = '00000000-0000-0000-0000-0000000be002' and tipo = 'sem_estoque') = 2,
  'A falta no extrato vira pendência para conferir');
select teste.ok(app.reservado(:'cd', :'X') = 2, 'Reserva continua até o estoque ser lançado no Bling');
select teste.ok(not exists (select 1 from app.estoque_saldos where deposito_id = :'cd' and quantidade < 0), 'Nenhum saldo negativo no extrato');

-- Reservas maiores que o saldo não deixam a disponibilidade negativa
insert into app.pedidos (id, origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total, deposito_id)
  values ('00000000-0000-0000-0000-0000000be003','manual','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1', current_date, 'GS', 1, :'cd');
insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario)
  values ('00000000-0000-0000-0000-0000000be003', :'Z', 'TB-Z', 'Produto Z', 50, 1);
select teste.ok(app.saldo_disponivel(:'cd', :'Z') = 0 and (select quantidade from app.disponibilidade(:'cd', :'Z')) = 0,
  'Encomenda maior que o saldo: disponível fica 0, não negativo');
update app.pedidos set status_comercial = 'cancelado' where id = '00000000-0000-0000-0000-0000000be003';

\echo '== Pedidos digitados no Bling reservam até serem atendidos =='
set role vc_sync;
\set BL1 '{"id": 90001, "numero": 7001, "data": "2026-10-18", "total": 100, "contato": {"id": 9001, "nome": "Julisa"}, "vendedor": {"id": 101}, "situacao": {"id": 6}, "itens": [{"codigo": "TB-X", "produto": {"id": 50001}, "quantidade": 4, "valor": 25}]}'
select app.bling_upsert_pedido(:'BL1');
reset role;
select teste.ok(app.reservado(:'cd', :'X') = 2 + 4, 'Pedido do Bling em aberto reserva 4 X (no depósito padrão da vendedora)');
set role vc_sync;
select teste.ok(app.bling_upsert_pedido(:'BL1') = 'sem_mudanca', 'O mesmo pedido lido de novo não muda nada');
reset role;
select teste.ok(app.reservado(:'cd', :'X') = 6, 'Leitura repetida não duplica a reserva');
set role vc_sync;
select app.bling_upsert_pedido(jsonb_set(:'BL1'::jsonb, '{situacao,id}', '9'));
reset role;
select teste.ok(app.reservado(:'cd', :'X') = 2
  and (select status from app.estoque_reservas r join app.pedidos p on p.id = r.pedido_id where p.bling_id = 90001) = 'consumida',
  'Pedido atendido no Bling (estoque lançado): reserva consumida, sem contar duas vezes');

\echo '== Fonte de estoque próprio: comportamento antigo =='
insert into app.estoque_movimentos (deposito_id, produto_id, tipo, quantidade, referencia_tipo, referencia_id)
  values (:'cde', :'Y', 'entrada_compra', 5, 'compra', 'teste-bling');
insert into app.pedidos (id, origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total, deposito_id)
  values ('00000000-0000-0000-0000-0000000be004','manual','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1', current_date, 'GS', 1, :'cde');
insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario)
  values ('00000000-0000-0000-0000-0000000be004', :'Y', 'TB-Y', 'Produto Y', 2, 1);
select teste.ok(app.saldo_disponivel(:'cde', :'Y') = 5, 'Na loja (estoque próprio) a reserva é só registrada; disponível igual a antes');
update app.parametros set valor = 1 where chave = 'reserva_estoque_proprio';
select teste.ok(app.saldo_disponivel(:'cde', :'Y') = 3, 'Com o parâmetro da fase C ligado, a reserva desconta também no estoque próprio');
update app.parametros set valor = 0 where chave = 'reserva_estoque_proprio';
update app.pedidos set status_comercial = 'enviado' where id = '00000000-0000-0000-0000-0000000be004';
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cde' and produto_id = :'Y') = 3
  and (select status from app.estoque_reservas where pedido_id = '00000000-0000-0000-0000-0000000be004') = 'consumida',
  'Envio no estoque próprio baixa o extrato e consome a reserva');
update app.pedidos set status_comercial = 'cancelado' where id = '00000000-0000-0000-0000-0000000be004';
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cde' and produto_id = :'Y') = 5, 'Cancelado após envio: devolve o que saiu');

\echo '== Eventos de webhook =='
set role vc_app;
\set EV '{"eventId": "01J-teste-1", "date": "2026-10-18T10:00:00-03:00", "version": "v1", "event": "stock.updated", "companyId": "abc", "data": {"produto": {"id": 50001}, "deposito": {"id": 1001}}}'
select teste.ok(app.bling_receber_evento(:'EV') = 'novo', 'Evento novo é guardado');
select teste.ok(app.bling_receber_evento(:'EV') = 'duplicado', 'O mesmo eventId de novo é reconhecido como duplicado');
select teste.falha($$select app.bling_receber_evento('{"event": "stock.updated", "data": {}}')$$, 'sem eventId', 'Evento sem eventId é recusado');
select teste.falha($$select app.bling_receber_evento('{"eventId": "x", "event": "drop table"}')$$, 'inválido', 'Nome de evento estranho é recusado');
reset role;
select teste.ok((select count(*) from app.bling_eventos where event_id = '01J-teste-1') = 1
  and (select recebimentos from app.bling_eventos where event_id = '01J-teste-1') = 2
  and (select recurso_id from app.bling_eventos where event_id = '01J-teste-1') = 50001,
  'Uma linha só, com 2 recebimentos e o ID do produto');
set role vc_sync;
select teste.ok((select count(*) from app.bling_pegar_eventos(10)) = 1, 'Processo pega o evento');
select teste.ok((select count(*) from app.bling_pegar_eventos(10)) = 0, 'Outro processo não pega o mesmo evento em andamento');
select app.bling_concluir_evento('01J-teste-1', 'HTTP 429');
select teste.ok((select count(*) from app.bling_pegar_eventos(10)) = 0, 'Falha temporária: espera antes de tentar de novo');
reset role;
update app.bling_eventos set proxima_tentativa = now() - interval '1 second' where event_id = '01J-teste-1';
set role vc_sync;
select teste.ok((select tentativas from app.bling_pegar_eventos(10)) = 2, 'Nova tentativa depois da espera');
select app.bling_concluir_evento('01J-teste-1');
reset role;
select teste.ok((select status from app.bling_eventos where event_id = '01J-teste-1') = 'processado', 'Evento processado');

\echo '== Divergências e reconciliação =='
set role vc_app;
select teste.como(:'GERENTE');
select teste.ok(app.comparar_estoque(:'cd') >= 1, 'Comparação encontra diferenças entre Bling e extrato próprio');
select id as dx from app.estoque_divergencias where tipo = 'saldo_diferente' and produto_id = :'X' and status = 'aberta' \gset
select teste.falha(format('select app.resolver_divergencia(%s, %L, %L)', :dx, 'igualar_ao_bling', ''), 'motivo', 'Resolver exige motivo');
select app.resolver_divergencia(:dx, 'igualar_ao_bling', 'contagem conferida');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'X') = 10,
  'Igualar ao Bling lança ajuste no extrato próprio (com motivo)');
select app.comparar_estoque(:'cd');
select teste.ok(not exists (select 1 from app.estoque_divergencias where tipo = 'saldo_diferente' and produto_id = :'X' and status = 'aberta'),
  'Depois de igualar, a comparação não acusa diferença');
select teste.como(:'KEILA');
select teste.ok((select count(*) from app.estoque_divergencias) = 0, 'Vendedora não vê divergências');
select teste.falha('select app.comparar_estoque(null)', 'só gerente', 'Vendedora não roda a comparação');
reset role;

\echo '== Importação por planilha não sobrescreve depósito com fonte Bling =='
set role vc_app;
select teste.como(:'GERENTE');
select teste.falha(format($$select app.importar_produtos_bling('[{"bling_id": 50002, "codigo": "TB-Y", "nome": "Produto Y", "estoque": 7}]', %L)$$, :'cd'),
  'fonte do estoque', 'Planilha não altera o estoque do depósito com fonte Bling');
reset role;

\echo '== Tokens só no backend =='
set role vc_app;
select teste.como(:'GERENTE');
select teste.falha($$select app.bling_salvar_tokens('a','b', now() + interval '1 hour')$$, 'só o dono', 'Gerente não grava tokens');
select teste.como(:'DONO');
select app.bling_salvar_tokens('cifrado-a', 'cifrado-r', now() + interval '1 hour', now() + interval '30 days');
select teste.falha('select * from app.bling_credenciais', 'permission denied', 'A aplicação não lê a tabela de tokens');
select teste.ok((select conectado from app.bling_conexao()), 'A tela vê que está conectado, sem ver os tokens');
reset role;
set role vc_sync;
select teste.ok((select access_token_cifrado from app.bling_credenciais) = 'cifrado-a', 'A sincronização lê os tokens');
select app.bling_salvar_tokens('cifrado-a2', 'cifrado-r2', now() + interval '1 hour');
select teste.ok((select refresh_token_cifrado from app.bling_credenciais) = 'cifrado-r2'
  and (select refresh_expira_em from app.bling_credenciais) > now() + interval '29 days',
  'Renovação grava os tokens novos e mantém a validade conhecida');
reset role;

\echo '== Testes do estoque com fonte Bling passaram =='
