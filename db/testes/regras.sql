-- =====================================================================
-- Testes das regras do banco. Rodar num banco de TESTE, nunca em produção:
--   psql "$DATABASE_URL_TESTE" -v ON_ERROR_STOP=1 -f db/testes/regras.sql
-- Qualquer falha interrompe com a mensagem "FALHOU: ...".
-- =====================================================================
\set QUIET on
reset role;
create schema if not exists teste;
create or replace function teste.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;
create or replace function teste.falha(cmd text, contem text, msg text) returns void language plpgsql as $$
begin
  begin
    execute cmd;
  exception when others then
    if contem is null or position(lower(contem) in lower(sqlerrm)) > 0 then
      raise notice 'ok - % (bloqueado: %)', msg, sqlerrm; return;
    end if;
    raise exception 'FALHOU: % (erro inesperado: %)', msg, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido bloqueado)', msg;
end $$;
grant usage on schema teste to vc_app, vc_sync;
grant execute on all functions in schema teste to vc_app, vc_sync;

-- ---------- Dados de teste (como administrador do banco) ----------
insert into app.vendedoras (id, nome, pais, moeda, whatsapp, bling_vendedor_id) values
  ('00000000-0000-0000-0000-0000000000a1','Keila','PY','GS','595981000001',101),
  ('00000000-0000-0000-0000-0000000000a2','Yessica','PY','GS','595981000002',102);
insert into app.usuarios (id, nome, email, perfil, vendedora_id) values
  ('00000000-0000-0000-0000-000000000001','Dono','dono@t','dono',null),
  ('00000000-0000-0000-0000-000000000002','Gerente','ger@t','gerente',null),
  ('00000000-0000-0000-0000-000000000003','Keila','keila@t','vendedora','00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-000000000004','Yessica','yes@t','vendedora','00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-000000000005','Consulta','con@t','consulta',null);
insert into app.clientes (id, nome, vendedora_id, bling_contato_id) values
  ('00000000-0000-0000-0000-0000000000c1','Julisa','00000000-0000-0000-0000-0000000000a1', 9001),
  ('00000000-0000-0000-0000-0000000000c2','Mirna','00000000-0000-0000-0000-0000000000a2', 9002);
insert into app.pedidos (id, origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total, previsao_envio) values
  ('00000000-0000-0000-0000-0000000000d1','planilha','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1', current_date - 5, 'GS', 1000000, current_date - 1),
  ('00000000-0000-0000-0000-0000000000d2','planilha','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000a2', current_date - 5, 'GS', 500000, current_date + 3);

-- Atalhos para agir como cada pessoa
create or replace function teste.como(p_usuario text) returns void language plpgsql as $$
begin perform set_config('app.usuario_id', p_usuario, false); end $$;
grant execute on function teste.como(text) to vc_app, vc_sync;
\set DONO     '00000000-0000-0000-0000-000000000001'
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set YESSICA  '00000000-0000-0000-0000-000000000004'
\set CONSULTA '00000000-0000-0000-0000-000000000005'
\set P1 '00000000-0000-0000-0000-0000000000d1'
\set P2 '00000000-0000-0000-0000-0000000000d2'

\echo '== Permissões por perfil =='
set role vc_app;
select teste.como(:'KEILA');
select teste.ok((select count(*) from app.pedidos) = 1, 'Keila vê só o próprio pedido');
select teste.ok((select count(*) from app.clientes) = 1, 'Keila vê só os próprios clientes');
select teste.falha($$insert into app.pedidos (origem, vendedora_id, data_pedido, moeda, valor_total)
  values ('manual','00000000-0000-0000-0000-0000000000a2', current_date, 'GS', 10)$$, 'row-level security',
  'Keila não cria pedido em nome da Yessica');
select teste.falha($$update app.pedidos set vendedora_id = '00000000-0000-0000-0000-0000000000a2'
  where id = '00000000-0000-0000-0000-0000000000d1'$$, 'row-level security', 'Keila não passa pedido para outra vendedora');
select teste.ok((select count(*) from app.auditoria) = 0, 'Vendedora não lê a auditoria');
select teste.como(:'YESSICA');
select teste.ok((select count(*) from app.pedidos where id = :'P1') = 0, 'Yessica não vê pedido da Keila');
select teste.como(:'CONSULTA');
select teste.ok((select count(*) from app.pedidos) = 2, 'Consulta vê todos os pedidos');
select teste.falha($$insert into app.pagamentos (pedido_id, valor, data, modalidade)
  values ('00000000-0000-0000-0000-0000000000d1', 1, current_date, 'pix')$$, 'row-level security', 'Consulta não registra pagamento');

\echo '== Pagamento: vendedora registra, gerente confere com o nº do Bling =='
select teste.como(:'KEILA');
insert into app.pagamentos (id, pedido_id, valor, data, modalidade) values
  ('00000000-0000-0000-0000-0000000000e1', :'P1', 400000, current_date, 'transferencia');
select teste.ok((select registrado_por from app.pagamentos where id='00000000-0000-0000-0000-0000000000e1') = :'KEILA'::uuid,
  'Pagamento fica registrado em nome de quem lançou');
select teste.ok((select status_pagamento from app.v_pedidos where id = :'P1') = 'aguardando',
  'Comprovante/pagamento lançado não conta como recebido antes da conferência');
select teste.ok((select a_conferir from app.v_pedidos where id = :'P1') = 400000, 'Valor aparece como a conferir');
select teste.falha($$update app.pagamentos set status_conferencia='conferido'
  where id='00000000-0000-0000-0000-0000000000e1'$$, null, 'Vendedora não marca o próprio pagamento como conferido');
select teste.falha($$select app.conferir_pagamento('00000000-0000-0000-0000-0000000000e1', 555)$$, 'gerente', 'Vendedora não usa a função de conferência');
update app.pagamentos set valor = 450000 where id='00000000-0000-0000-0000-0000000000e1';
select teste.ok(true, 'Vendedora corrige o próprio pagamento enquanto pendente');

select teste.como(:'GERENTE');
-- o nº do Bling é opcional na conferência (0123); quando informado, liga o pedido
select app.conferir_pagamento('00000000-0000-0000-0000-0000000000e1', 555);
select teste.ok((select bling_numero from app.pedidos where id = :'P1') = 555, 'Conferência liga o pedido ao nº 555 do Bling');
select teste.ok((select status_pagamento from app.v_pedidos where id = :'P1') = 'parcial', 'Pedido fica parcialmente pago');
select teste.ok((select saldo from app.v_pedidos where id = :'P1') = 550000, 'Saldo pendente correto');

select teste.como(:'KEILA');
select teste.falha($$update app.pagamentos set valor = 1 where id='00000000-0000-0000-0000-0000000000e1'$$, 'já conferido',
  'Pagamento conferido não pode mais ser alterado');
insert into app.pagamentos (id, pedido_id, valor, data, modalidade) values
  ('00000000-0000-0000-0000-0000000000e2', :'P1', 550000, current_date, 'efetivo');

select teste.como(:'GERENTE');
select teste.falha($$select app.conferir_pagamento('00000000-0000-0000-0000-0000000000e2', 777)$$, 'não confere',
  'Número do Bling diferente do pedido é recusado');
select app.conferir_pagamento('00000000-0000-0000-0000-0000000000e2', 555);
select teste.ok((select status_pagamento from app.v_pedidos where id = :'P1') = 'pago', 'Pedido quitado fica pago');

select teste.como(:'YESSICA');
insert into app.pagamentos (id, pedido_id, valor, data, modalidade) values
  ('00000000-0000-0000-0000-0000000000e3', :'P2', 100, current_date, 'pix');
select teste.como(:'GERENTE');
select teste.falha($$select app.conferir_pagamento('00000000-0000-0000-0000-0000000000e3', 555)$$, 'já está ligado',
  'Um nº do Bling não pode servir para dois pedidos');
select teste.falha($$select app.recusar_pagamento('00000000-0000-0000-0000-0000000000e3', '')$$, 'motivo', 'Recusa exige motivo');
select app.recusar_pagamento('00000000-0000-0000-0000-0000000000e3', 'Transferência não localizada no banco');
select teste.ok((select recebido from app.v_pedidos where id = :'P2') = 0, 'Pagamento recusado não conta como recebido');

\echo '== Status de pagamento e envio =='
select teste.ok((select envio_atrasado from app.v_pedidos where id = :'P1'), 'Previsão de envio vencida aparece como envio atrasado');
select teste.ok(not (select envio_atrasado from app.v_pedidos where id = :'P2'), 'Previsão futura não está atrasada');
update app.pedidos set credito_concedido = true, vencimento = current_date + 10 where id = :'P2';
select teste.ok((select status_pagamento from app.v_pedidos where id = :'P2') = 'a_credito', 'Crédito concedido com vencimento futuro');
update app.pedidos set vencimento = current_date - 1 where id = :'P2';
select teste.ok((select status_pagamento from app.v_pedidos where id = :'P2') = 'atrasado', 'Vencimento passado com saldo fica atrasado');
select teste.falha($$update app.pedidos set credito_concedido = true, vencimento = null
  where id = '00000000-0000-0000-0000-0000000000d2'$$, 'credito_tem_vencimento', 'Crédito exige vencimento');
update app.pedidos set status_comercial = 'cancelado' where id = :'P2';
select teste.ok((select status_pagamento from app.v_pedidos where id = :'P2') = 'cancelado', 'Pedido cancelado');
select teste.ok((select saldo from app.v_pedidos where id = :'P2') = 0, 'Pedido cancelado não tem saldo a cobrar');

\echo '== Auditoria =='
select teste.ok((select count(*) from app.auditoria where tabela='pagamentos' and registro_id='00000000-0000-0000-0000-0000000000e1') >= 3,
  'Registro, correção e conferência do pagamento ficaram auditados');
select teste.ok((select usuario_id from app.auditoria where tabela='pagamentos' and registro_id='00000000-0000-0000-0000-0000000000e1'
  and depois ? 'status_conferencia' order by id desc limit 1) = :'GERENTE'::uuid, 'Auditoria registra quem conferiu');
select teste.ok((select antes->>'valor' from app.auditoria where tabela='pagamentos' and acao='UPDATE'
  and depois ? 'valor' limit 1) = '400000.00', 'Auditoria guarda o valor anterior');
select teste.falha($$delete from app.auditoria$$, null, 'Aplicação não apaga auditoria');
reset role;
select teste.falha($$update app.auditoria set motivo = 'x'$$, 'não pode ser alterada', 'Nem o administrador altera a auditoria');
select teste.falha($$delete from app.auditoria$$, 'não pode ser alterada', 'Nem o administrador apaga a auditoria');

\echo '== Sincronização com o Bling =='
set role vc_app;
select teste.como(:'DONO');
select teste.falha($$select app.bling_upsert_pedido('{"id":1}')$$, 'permission denied', 'Aplicação não escreve na cópia do Bling');
select teste.falha($$insert into app.bling_pedidos (bling_id, payload, conteudo_hash) values (1,'{}','x')$$, 'permission denied',
  'Aplicação não insere direto na cópia do Bling');
select teste.falha($$insert into app.pedidos (origem, bling_id, vendedora_id, data_pedido, moeda, valor_total)
  values ('bling', 1, '00000000-0000-0000-0000-0000000000a1', current_date, 'GS', 1)$$, null, 'Aplicação não cria pedido de origem Bling');

set role vc_sync;
select teste.como('');
\set PB1 '{"id": 70001, "numero": 900, "numeroLoja": "", "data": "2026-10-10", "total": 250000, "totalProdutos": 250000, "contato": {"id": 9001, "nome": "Julisa"}, "vendedor": {"id": 101}, "situacao": {"id": 6, "valor": 0}, "loja": {"id": 0}, "itens": [{"codigo": "RHE-001", "quantidade": 12, "valor": 6500}]}'
select teste.ok(app.bling_upsert_pedido(:'PB1') = 'criado', 'Pedido novo do Bling é criado');
select teste.ok(app.bling_upsert_pedido(:'PB1') = 'sem_mudanca', 'Sincronizar de novo não duplica nem altera');
reset role;
select teste.ok((select count(*) from app.pedidos where bling_id = 70001) = 1, 'Existe um único pedido para o Bling 70001');
select teste.ok((select vendedora_id from app.pedidos where bling_id = 70001) = '00000000-0000-0000-0000-0000000000a1',
  'Pedido do Bling associado à vendedora pelo vendedor do Bling');
select teste.ok((select cliente_id from app.pedidos where bling_id = 70001) = '00000000-0000-0000-0000-0000000000c1',
  'Pedido do Bling associado ao cliente pelo contato do Bling');

set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$update app.pedidos set valor_total = 1 where bling_id = 70001$$, 'só mudam no bling',
  'CRM não altera valor de pedido que vem do Bling');
update app.pedidos set status_comercial = 'enviado', previsao_envio = current_date + 2, observacoes = 'Retira no km 14' where bling_id = 70001;
select teste.ok(true, 'CRM altera status comercial, previsão de envio e observações do pedido do Bling');
select app.reconhecer_mudanca_bling((select id from app.pedidos where bling_id = 70001));
select teste.ok(not (select bling_mudou from app.v_pedidos where bling_id = 70001), 'Versão do Bling marcada como revisada');

set role vc_sync;
select teste.ok(app.bling_upsert_pedido(jsonb_set(:'PB1'::jsonb, '{total}', '300000')) = 'atualizado', 'Mudança no Bling atualiza a cópia');
set role vc_app;
select teste.como(:'KEILA');
select teste.ok((select bling_mudou from app.v_pedidos where bling_id = 70001), 'Pedido sinaliza que mudou no Bling desde a revisão');
select teste.ok((select valor_total from app.pedidos where bling_id = 70001) = 300000, 'Valor oficial acompanha o Bling');
select teste.ok((select status_comercial from app.pedidos where bling_id = 70001) = 'enviado', 'Dados do CRM preservados após a sincronização');

set role vc_sync;
\set PB2 '{"id": 70002, "numero": 555, "data": "2026-10-09", "total": 1000000, "contato": {"id": 9001}, "vendedor": {"id": 101}, "situacao": {"id": 9}, "loja": {"id": 0}, "itens": []}'
select teste.ok(app.bling_upsert_pedido(:'PB2') = 'criado_vinculado', 'Pedido do Bling 555 se liga ao pedido da planilha já conferido com esse número');
\set PB3 '{"id": 70003, "numero": 901, "data": "2026-10-11", "total": 10, "contato": {"id": 1}, "vendedor": {"id": 999}, "situacao": {"id": 6}, "loja": {"id": 0}, "itens": []}'
select teste.ok(app.bling_upsert_pedido(:'PB3') = 'criado_sem_vendedora', 'Pedido de vendedor não vinculado fica só na cópia');
reset role;
select teste.ok((select count(*) from app.pedidos where bling_numero = 555) = 1, 'Sem pedido duplicado para o nº 555');
select teste.ok((select origem from app.pedidos where bling_numero = 555) = 'planilha', 'Pedido vinculado mantém a origem');
select teste.ok((select count(*) from app.pedidos where bling_id = 70003) = 0, 'Nenhum pedido criado sem vendedora');

set role vc_app;
select teste.como(:'YESSICA');
select teste.ok((select count(*) from app.bling_pedidos) = 0, 'Yessica não vê a cópia de pedidos do Bling da Keila');

\echo '== Escritas em sistemas externos =='
select teste.como(:'GERENTE');
insert into app.escritas_externas (id, sistema, operacao, alvo, dados, solicitado_por)
  values ('00000000-0000-0000-0000-0000000000f1','bling','atualizar_situacao','70001','{"situacao": 9}', :'GERENTE');
select teste.falha($$select app.decidir_escrita('00000000-0000-0000-0000-0000000000f1', true)$$, 'só o dono', 'Gerente não aprova escrita no Bling');
select teste.falha($$update app.escritas_externas set status='aprovada'$$, 'permission denied', 'Ninguém aprova editando a proposta direto');
select teste.como(:'DONO');
select app.decidir_escrita('00000000-0000-0000-0000-0000000000f1', true);
select teste.ok((select status from app.escritas_externas where id='00000000-0000-0000-0000-0000000000f1') = 'aprovada', 'Dono aprova a escrita');
reset role;
\echo '== Todos os testes passaram =='
