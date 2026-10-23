-- Testes do acompanhamento do WhatsApp. Rodar depois de regras.sql (usa Keila, Yessica, gerente e a cliente Julisa).
\set QUIET on
reset role;
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set YESSICA  '00000000-0000-0000-0000-000000000004'

\echo '== WhatsApp =='
update app.clientes set whatsapp = '0981 123-456' where id = '00000000-0000-0000-0000-0000000000c1';
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$insert into app.whatsapp_conexoes (nome, instancia, pais) values ('X', 'vc-x', 'PY')$$, null, 'Vendedora não cria conexão');
select teste.como(:'GERENTE');
insert into app.whatsapp_conexoes (id, nome, instancia, pais, vendedora_id)
  values ('00000000-0000-0000-0000-0000000000d1', 'Paraguai', 'vc-paraguai-teste', 'PY', '00000000-0000-0000-0000-0000000000a1');
select teste.ok((select count(*) from app.whatsapp_conexoes) = 1, 'Gerente cria conexão');

-- Webhook (sem usuário logado)
select teste.como(null);
select app.whatsapp_estado('vc-paraguai-teste', 'aguardando_qr', null, 'data:image/png;base64,AAA');
select app.whatsapp_estado('vc-paraguai-teste', 'conectado', '595 994 000111', null);
select teste.ok(app.whatsapp_registrar('vc-paraguai-teste', '[
  {"id":"A1","contato":"595981123456","nome":"Julisa","enviada":false,"tipo":"texto","texto":"Hola, tienen Rhenuks?","em":1761000000},
  {"id":"A2","contato":"595981123456","enviada":true,"tipo":"texto","texto":"Sí! Te paso precios","em":1761000300},
  {"id":"A3","contato":"595971999888","nome":"Lead nuevo","enviada":false,"tipo":"imagem","em":1761000400},
  {"id":"ruim","contato":"abc","enviada":false,"tipo":"texto","em":1761000500}
]'::jsonb) = 3, 'Registra mensagens válidas e ignora contato inválido');
select teste.ok(app.whatsapp_registrar('vc-paraguai-teste', '[{"id":"A1","contato":"595981123456","enviada":false,"tipo":"texto","em":1761000000}]'::jsonb) = 0,
  'Mensagem repetida não duplica');
select teste.ok(app.whatsapp_registrar('outra-instancia', '[{"id":"Z","contato":"595981123456","enviada":false,"tipo":"texto","em":1761000000}]'::jsonb) = 0,
  'Instância desconhecida é ignorada');
reset role;
select teste.ok((select estado = 'conectado' and numero = '595994000111' and qr is null from app.whatsapp_conexoes), 'Conectado grava o número e apaga o QR');
select teste.ok((select nome from app.whatsapp_contatos where contato = '595981123456') = 'Julisa', 'Nome do contato vem da mensagem recebida');
select teste.ok((select count(*) from app.clientes c where app.zap8(c.whatsapp) = app.zap8('595981123456')) = 1, 'Número com DDI casa com o cadastro sem DDI');

set role vc_app;
select teste.como(:'KEILA');
select teste.ok((select count(*) from app.whatsapp_mensagens) = 3, 'Vendedora vê as mensagens da conexão dela');
update app.whatsapp_conexoes set nome = 'Y';
select teste.ok((select nome from app.whatsapp_conexoes) = 'Paraguai', 'Vendedora não altera conexão');
select teste.como(:'YESSICA');
select teste.ok((select count(*) from app.whatsapp_mensagens) = 0, 'Outra vendedora não vê as mensagens');
select teste.ok((select count(*) from app.whatsapp_conexoes) = 0, 'Outra vendedora não vê a conexão');
reset role;
\echo '== Testes do WhatsApp passaram =='
