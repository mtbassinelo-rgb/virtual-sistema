-- Testes da gestão comercial: moeda no pedido, estoque, link para o cliente, lucro, comissão,
-- despesas, resultado do mês e envios ao Paraguai. Rodar depois dos outros testes.
\set QUIET on
reset role;
\set DONO     '00000000-0000-0000-0000-000000000001'
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set YESSICA  '00000000-0000-0000-0000-000000000004'
\set CONSULTA '00000000-0000-0000-0000-000000000005'
\set VKEILA   '00000000-0000-0000-0000-0000000000a1'
\set G1  '00000000-0000-0000-0000-00000000ab01'
\set G2  '00000000-0000-0000-0000-00000000ab02'
\set DG  '00000000-0000-0000-0000-00000000ab10'
\set CG  '00000000-0000-0000-0000-00000000ab20'

-- ---------- Dados (como administrador do banco) ----------
insert into app.produtos (id, codigo, nome, marca, custo, unidades_caixa) values
  (:'G1', 'GES-001', 'Escova Teste', 'Fonte Teste', 5, 12),
  (:'G2', 'GES-002', 'Pente Teste', 'Fonte Teste', null, null);
insert into app.precos (produto_id, tabela, valor, vigente_desde) values
  (:'G1', 'py_normal', 13000, current_date - 1), (:'G1', 'br_normal', 9, current_date - 1),
  (:'G2', 'py_normal', 5000, current_date - 1);
insert into app.depositos (id, codigo, nome, pais, tipo) values (:'DG', 'teste-gestao', 'Depósito Gestão', 'PY', 'loja');
insert into app.vendedora_depositos values (:'VKEILA', :'DG', false);
select app._lancar(:'DG', :'G1', 'entrada_compra', 100, 'teste', 'gestao', null);
select app._lancar(:'DG', :'G2', 'entrada_compra', 10, 'teste', 'gestao', null);
insert into app.clientes (id, nome, vendedora_id, whatsapp) values (:'CG', 'Cliente Gestão', :'VKEILA', '595981111111');

\echo '== Pedido da vendedora: moeda escolhida e estoque =='
set role vc_app;
select teste.como(:'KEILA');
select set_config('teste.p1', app.criar_pedido_vendedora(:'CG', 'GS', :'DG', current_date + 2, 'teste',
  jsonb_build_array(jsonb_build_object('produto_id', :'G1', 'quantidade', 24)), false)::text, false);
select teste.ok((select valor_total = 312000 and moeda = 'GS' and status_comercial = 'em_separacao' from app.pedidos
                  where id = current_setting('teste.p1')::uuid), 'Pedido em Gs com o preço da tabela py_normal (24 × 13.000)');
select teste.ok((select custo_unitario_brl = 5 and cambio_custo = 1300 from app.pedido_itens where pedido_id = current_setting('teste.p1')::uuid),
  'O custo e o câmbio ficam congelados no item');

select set_config('teste.p2', app.criar_pedido_vendedora(:'CG', 'BRL', :'DG', null, null,
  jsonb_build_array(jsonb_build_object('produto_id', :'G1', 'caixas', 2)), false)::text, false);
select teste.ok((select p.moeda = 'BRL' and i.tabela_preco = 'br_normal' and i.quantidade = 24 and p.valor_total = 216
                   from app.pedidos p join app.pedido_itens i on i.pedido_id = p.id where p.id = current_setting('teste.p2')::uuid),
  'Vendedora vende em R$ para cliente do Paraguai; 2 caixas = 24 peças');
select teste.ok((select cambio_custo is null from app.pedido_itens where pedido_id = current_setting('teste.p2')::uuid),
  'Pedido em R$ não usa câmbio');

\echo '== Preço: vendedora só para mais =='
select teste.falha($$select app.criar_pedido_vendedora('00000000-0000-0000-0000-00000000ab20', 'GS', '00000000-0000-0000-0000-00000000ab10', null, null,
  '[{"produto_id": "00000000-0000-0000-0000-00000000ab01", "quantidade": 1, "preco": 12000}]', false)$$,
  'abaixo do VIP', 'Sem preço VIP cadastrado, a vendedora não baixa da tabela (13.000)');
reset role;
insert into app.precos (produto_id, tabela, valor, vigente_desde) values (:'G1', 'py_vip', 11500, current_date - 1);
set role vc_app;
select teste.como(:'KEILA');
select set_config('teste.pv', app.criar_pedido_vendedora(:'CG', 'GS', :'DG', null, null,
  jsonb_build_array(jsonb_build_object('produto_id', :'G1', 'quantidade', 1, 'preco', 12000)), false)::text, false);
select teste.ok((select valor_total = 12000 from app.pedidos where id = current_setting('teste.pv')::uuid), 'Vendedora baixa o preço até o VIP (12.000 ≥ 11.500)');
select teste.falha($$select app.criar_pedido_vendedora('00000000-0000-0000-0000-00000000ab20', 'GS', '00000000-0000-0000-0000-00000000ab10', null, null,
  '[{"produto_id": "00000000-0000-0000-0000-00000000ab01", "quantidade": 1, "preco": 11000}]', false)$$,
  'abaixo do VIP', 'Vendedora não vende abaixo do VIP (11.500)');
select set_config('teste.pd', app.criar_pedido_vendedora(:'CG', 'GS', :'DG', null, null,
  jsonb_build_array(jsonb_build_object('produto_id', :'G1', 'quantidade', 10)), false, 10000)::text, false);
select teste.ok((select valor_total = 120000 from app.pedidos where id = current_setting('teste.pd')::uuid), 'Desconto de 10.000 em 10 × 13.000 = 120.000');
select teste.falha($$select app.criar_pedido_vendedora('00000000-0000-0000-0000-00000000ab20', 'GS', '00000000-0000-0000-0000-00000000ab10', null, null,
  '[{"produto_id": "00000000-0000-0000-0000-00000000ab01", "quantidade": 10}]', false, 20000)$$,
  'acima do permitido', 'Desconto maior que a folga até o VIP (15.000) é barrado');
select set_config('teste.p3', app.criar_pedido_vendedora(:'CG', 'GS', :'DG', null, null,
  jsonb_build_array(jsonb_build_object('produto_id', :'G1', 'quantidade', 2, 'preco', 15000)), false)::text, false);
select teste.ok((select valor_total = 30000 from app.pedidos where id = current_setting('teste.p3')::uuid), 'Vendedora vende acima da tabela (2 × 15.000)');
reset role;
select app.preco_tabela_cliente(:'CG', :'G1') = 13000 as ok \gset
select teste.ok(:'ok'::boolean, 'Preço de tabela do cliente para a tela');
set role vc_app;
select teste.como(:'GERENTE');
select set_config('teste.p4', app.criar_pedido_vendedora(:'CG', 'GS', :'DG', null, null,
  jsonb_build_array(jsonb_build_object('produto_id', :'G1', 'quantidade', 1, 'preco', 11000)), false)::text, false);
select teste.ok((select valor_total = 11000 from app.pedidos where id = current_setting('teste.p4')::uuid), 'Gerente pode dar preço abaixo da tabela');
select teste.como(:'KEILA');
select teste.falha($$select app.criar_pedido_vendedora('00000000-0000-0000-0000-00000000ab20', 'GS', '00000000-0000-0000-0000-00000000ab10',
  null, null, '[{"produto_id": "00000000-0000-0000-0000-00000000ab02", "quantidade": 11}]', false)$$,
  'Estoque insuficiente', 'Não vende mais do que o estoque disponível');
select teste.falha($$select app.criar_pedido_vendedora('00000000-0000-0000-0000-00000000ab20', 'BRL', '00000000-0000-0000-0000-00000000ab10',
  null, null, '[{"produto_id": "00000000-0000-0000-0000-00000000ab02", "quantidade": 1}]', false)$$,
  'não tem preço em R$', 'Produto sem preço na moeda escolhida é barrado');

update app.pedido_itens set custo_unitario_brl = 0.01 where pedido_id = current_setting('teste.p1')::uuid;
select teste.ok((select custo_unitario_brl = 5 from app.pedido_itens where pedido_id = current_setting('teste.p1')::uuid),
  'A vendedora não altera o custo do item');

select teste.como(:'YESSICA');
select teste.falha($$select app.criar_pedido_vendedora('00000000-0000-0000-0000-00000000ab20', 'GS', null, null, null,
  '[{"produto_id": "00000000-0000-0000-0000-00000000ab01", "quantidade": 1}]', false)$$,
  'Cliente não encontrado', 'Vendedora não cria pedido para cliente de outra');

reset role;
update app.usuarios set permissoes = permissoes || '{"preco_abaixo": true}' where id = :'KEILA';
set role vc_app;
select teste.como(:'KEILA');
select set_config('teste.p6', app.criar_pedido_vendedora(:'CG', 'GS', :'DG', null, null,
  jsonb_build_array(jsonb_build_object('produto_id', :'G1', 'quantidade', 1, 'preco', 12000)), false)::text, false);
select teste.ok((select valor_total = 12000 from app.pedidos where id = current_setting('teste.p6')::uuid), 'Vendedora liberada pelo gerente vende abaixo da tabela');
reset role;
update app.usuarios set permissoes = permissoes - 'preco_abaixo' where id = :'KEILA';
set role vc_app;

\echo '== Separação pelo estoquista =='
select teste.como(:'KEILA');
select set_config('teste.p5', app.criar_pedido_vendedora(:'CG', 'GS', :'DG', null, null,
  jsonb_build_array(jsonb_build_object('produto_id', :'G1', 'quantidade', 12)), false)::text, false);
select set_config('teste.i5', (select id::text from app.pedido_itens where pedido_id = current_setting('teste.p5')::uuid), false);
select teste.falha(format($$select app.confirmar_separacao_estoque(%L, '[{"item_id":"%s","quantidade":12}]', 1)$$, current_setting('teste.p5'), current_setting('teste.i5')),
  'expedição', 'Quem não é responsável pelo estoque não confere');
reset role;
insert into app.deposito_responsaveis (deposito_id, usuario_id) values (:'DG', :'KEILA') on conflict do nothing;
set role vc_app;
select teste.como(:'KEILA');
select teste.falha(format($$select app.confirmar_separacao_estoque(%L, '[]', 1)$$, current_setting('teste.p5')), 'Confirme a quantidade', 'Precisa confirmar todos os itens');
select teste.falha(format($$select app.confirmar_separacao_estoque(%L, '[{"item_id":"%s","quantidade":13}]', 1)$$, current_setting('teste.p5'), current_setting('teste.i5')),
  'não pode ser aumentado', 'Separação não aumenta o pedido');
select teste.falha(format($$select app.confirmar_separacao_estoque(%L, '[{"item_id":"%s","quantidade":10}]', null)$$, current_setting('teste.p5'), current_setting('teste.i5')),
  'total de caixas', 'Precisa informar o total de caixas');
select app.confirmar_separacao_estoque(current_setting('teste.p5')::uuid, format('[{"item_id":"%s","quantidade":10}]', current_setting('teste.i5'))::jsonb, 1);
select teste.ok((select caixas_separadas = 1 and separacao_conferida_em is not null and valor_total = 130000 from app.pedidos where id = current_setting('teste.p5')::uuid),
  'Separação conferida com 10 de 12, 1 caixa, total recalculado');
select teste.ok((select quantidade_faltou = 2 from app.pedido_itens_indisponiveis where pedido_id = current_setting('teste.p5')::uuid), 'O que faltou fica registrado para a vendedora');
select teste.ok((select pedida = 12 and separada = 10 from app.pedido_separacao where pedido_id = current_setting('teste.p5')::uuid), 'Fica o registro do que foi separado');
select teste.falha(format($$select app.confirmar_separacao_estoque(%L, '[{"item_id":"%s","quantidade":10}]', 1)$$, current_setting('teste.p5'), current_setting('teste.i5')),
  'já foi conferido', 'Não confere duas vezes');
-- vendedora acrescenta depois de separado: volta só a diferença para o estoquista
select app.editar_itens_pedido(current_setting('teste.p5')::uuid,
  jsonb_build_array(jsonb_build_object('item_id', current_setting('teste.i5'), 'quantidade', 14), jsonb_build_object('produto_id', :'G2', 'quantidade', 2)));
select teste.ok((select separacao_conferida_em is null from app.pedidos where id = current_setting('teste.p5')::uuid), 'Acrescentou: volta para o estoquista');
select teste.ok((select separada = 10 from app.pedido_separacao where pedido_id = current_setting('teste.p5')::uuid and item_id = current_setting('teste.i5')::uuid),
  'O que já tinha sido separado fica guardado');
select set_config('teste.i6', (select id::text from app.pedido_itens where pedido_id = current_setting('teste.p5')::uuid and produto_id = :'G2'), false);
select teste.falha(format($$select app.confirmar_separacao_estoque(%L, '[{"item_id":"%s","quantidade":14},{"item_id":"%s","quantidade":2}]', 1)$$,
  current_setting('teste.p5'), current_setting('teste.i5'), current_setting('teste.i6')), 'entre 0 e 4', 'Separa só a diferença (4), não o item inteiro');
select app.confirmar_separacao_estoque(current_setting('teste.p5')::uuid,
  format('[{"item_id":"%s","quantidade":4},{"item_id":"%s","quantidade":2}]', current_setting('teste.i5'), current_setting('teste.i6'))::jsonb, 1);
select teste.ok((select separada = 14 from app.pedido_separacao where pedido_id = current_setting('teste.p5')::uuid and item_id = current_setting('teste.i5')::uuid),
  'Junta: 10 de antes + 4 agora = 14');
select teste.ok((select caixas_separadas = 2 and separacao_conferida_em is not null from app.pedidos where id = current_setting('teste.p5')::uuid),
  'Caixas somam (1 + 1) e o pedido volta a ficar conferido');
select teste.ok((select quantidade = 14 from app.pedido_itens where id = current_setting('teste.i5')::uuid), 'Item fica com o total (14)');
-- como sai: vendedora informa, estoquista despacha
select teste.falha(format($$select app.despachar_pedido(%L)$$, current_setting('teste.p5')), 'ainda não informou', 'Sem envio informado não despacha');
select teste.falha(format($$select app.definir_entrega(%L, 'envio', 'Passeiro', '')$$, current_setting('teste.p5')), 'dados para o envio', 'Envio exige os dados');
select app.definir_entrega(current_setting('teste.p5')::uuid, 'envio', 'Transportadora Nasa', 'Maria, 0981 123 456, Encarnación');
select teste.ok((select entrega_tipo = 'envio' and entrega_meio = 'Transportadora Nasa' from app.pedidos where id = current_setting('teste.p5')::uuid), 'Vendedora informa o envio');
select app.despachar_pedido(current_setting('teste.p5')::uuid);
select teste.ok((select status_comercial = 'enviado' and despachado_em is not null from app.pedidos where id = current_setting('teste.p5')::uuid), 'Estoquista dá o ✓: em transporte');
select teste.falha(format($$select app.definir_entrega(%L, 'retira', 'Loja CDE', null)$$, current_setting('teste.p5')), 'já saiu', 'Depois de sair, a entrega não muda');
reset role;
select (select pais::text from app.clientes where id = :'CG') as pais_cg \gset
set role vc_app;
select teste.como(:'KEILA');
select case when :'pais_cg' = 'PY' then teste.falha(format($$select app.avancar_entrega(%L, 'entregue')$$, current_setting('teste.p5')), 'loja CDE',
  'Envio Paraguai: vendedora só finaliza depois da CDE confirmar') end;
select teste.como(:'GERENTE');
select case when :'pais_cg' = 'PY' then app.confirmar_envio_py(current_setting('teste.p5')::uuid, 'Guia 123') end;
select teste.como(:'KEILA');
select app.avancar_entrega(current_setting('teste.p5')::uuid, 'entregue');
select teste.ok((select status_comercial = 'entregue' from app.pedidos where id = current_setting('teste.p5')::uuid), 'Depois da confirmação, a vendedora finaliza');
-- retira na CDE: aparece em "Chegando na CDE" e a loja entrega
select set_config('teste.pr', app.criar_pedido_vendedora(:'CG', 'GS', :'DG', null, null,
  jsonb_build_array(jsonb_build_object('produto_id', :'G1', 'quantidade', 2)), false)::text, false);
reset role;
update app.pedidos set separacao_conferida_em = now() where id = current_setting('teste.pr')::uuid;
set role vc_app;
select teste.como(:'KEILA');
select app.definir_entrega(current_setting('teste.pr')::uuid, 'retira', 'Loja CDE', 'Ana');
select teste.como(:'GERENTE');
select app.despachar_pedido(current_setting('teste.pr')::uuid);
select teste.ok(exists (select 1 from app.cde_chegando() x where x.id = current_setting('teste.pr')::uuid and x.tipo = 'retira' and jsonb_array_length(x.itens) = 1),
  'Retira na CDE aparece para a loja com os itens');
select app.cde_cliente_retirou(current_setting('teste.pr')::uuid);
select teste.ok((select status_comercial = 'entregue' from app.pedidos where id = current_setting('teste.pr')::uuid), 'Loja CDE dá o ✓ cliente retirou');
-- gerente finaliza em um passo (confirma o pagamento informado e entrega)
select teste.como(:'KEILA');
select set_config('teste.pf', app.criar_pedido_vendedora(:'CG', 'GS', :'DG', null, null,
  jsonb_build_array(jsonb_build_object('produto_id', :'G1', 'quantidade', 1)), false)::text, false);
select teste.como(:'GERENTE');
select teste.falha(format($$select app.finalizar_pedido(%L)$$, current_setting('teste.pf')), 'separar o pedido', 'Não finaliza antes da separação');
reset role;
update app.pedidos set separacao_conferida_em = now() where id = current_setting('teste.pf')::uuid;
insert into app.pagamentos (pedido_id, valor, data, modalidade, registrado_por)
values (current_setting('teste.pf')::uuid, 13000, current_date, 'transferencia', :'KEILA');
set role vc_app;
select teste.como(:'KEILA');
select teste.falha(format($$select app.finalizar_pedido(%L)$$, current_setting('teste.pf')), 'gerente', 'Vendedora não finaliza');
select teste.como(:'GERENTE');
select app.finalizar_pedido(current_setting('teste.pf')::uuid);
select teste.ok((select status_comercial = 'entregue' and total_confirmado_em is not null from app.pedidos where id = current_setting('teste.pf')::uuid), 'Gerente finaliza o pedido');
select teste.ok((select status_conferencia = 'conferido' from app.pagamentos where pedido_id = current_setting('teste.pf')::uuid), 'Finalizar confirma o pagamento informado');
-- finalizar com a entrega ainda por fazer: fica finalizado e vira entregue quando sai
select teste.como(:'KEILA');
select set_config('teste.pa', app.criar_pedido_vendedora(:'CG', 'GS', :'DG', null, null,
  jsonb_build_array(jsonb_build_object('produto_id', :'G1', 'quantidade', 1)), false)::text, false);
reset role;
update app.pedidos set separacao_conferida_em = now() where id = current_setting('teste.pa')::uuid;
set role vc_app;
select app.definir_entrega(current_setting('teste.pa')::uuid, 'retira', 'Depósito Foz', 'Ana');
select teste.como(:'GERENTE');
select teste.ok(app.finalizar_pedido(current_setting('teste.pa')::uuid) = 'pendente_entrega', 'Finalizar antes do estoque entregar avisa que falta a entrega');
select teste.ok((select status_comercial = 'em_separacao' and finalizado_em is not null from app.pedidos where id = current_setting('teste.pa')::uuid), 'Continua na lista do estoquista');
select app.despachar_pedido(current_setting('teste.pa')::uuid);
select teste.ok((select status_comercial = 'entregue' from app.pedidos where id = current_setting('teste.pa')::uuid), 'Saiu do estoque: o pedido finalizado fecha sozinho');
-- sozinho: separado, pago, conferido e despachado → finalizado sem clicar
select teste.como(:'KEILA');
select set_config('teste.pb', app.criar_pedido_vendedora(:'CG', 'GS', :'DG', null, null,
  jsonb_build_array(jsonb_build_object('produto_id', :'G1', 'quantidade', 1)), false)::text, false);
reset role;
update app.pedidos set separacao_conferida_em = now() where id = current_setting('teste.pb')::uuid;
insert into app.pagamentos (pedido_id, valor, data, modalidade, registrado_por)
values (current_setting('teste.pb')::uuid, 13000, current_date, 'transferencia', :'KEILA');
set role vc_app;
select teste.como(:'GERENTE');
select app.conferir_pagamento((select id from app.pagamentos where pedido_id = current_setting('teste.pb')::uuid), null);
select teste.ok((select status_comercial = 'em_separacao' and finalizado_em is null from app.pedidos where id = current_setting('teste.pb')::uuid), 'Pago mas sem entrega definida: espera');
select teste.como(:'KEILA');
select app.definir_entrega(current_setting('teste.pb')::uuid, 'retira', 'Depósito Foz', 'Ana');
select teste.como(:'GERENTE');
select app.despachar_pedido(current_setting('teste.pb')::uuid);
select teste.ok((select status_comercial = 'entregue' and finalizado_em is not null from app.pedidos where id = current_setting('teste.pb')::uuid), 'Pago, conferido e despachado: finaliza sozinho');
-- dados de envio guardados na ficha do cliente
select teste.como(:'KEILA');
select teste.falha($$select app.salvar_dados_envio('00000000-0000-0000-0000-00000000ab20', 'Ana', '', '0981', 'Rua 1')$$, 'Preencha', 'Dados de envio exigem os 4 campos');
select app.salvar_dados_envio(:'CG', 'Ana Pérez', '1234567', '0981 111 111', 'Av. Central 100, Encarnación');
select teste.ok((select envio_documento = '1234567' and envio_endereco like '%Encarnación' from app.clientes where id = :'CG'), 'Vendedora guarda os dados de envio do cliente');
-- etiqueta de envio e resumo do dia
select teste.ok((select envio_nome = 'Ana Pérez' and volumes >= 1 from app.etiquetas_envio(array[current_setting('teste.pb')::uuid])), 'Etiqueta traz os dados de envio do cliente');
reset role;
insert into app.whatsapp_conexoes (nome, instancia, estado) values ('Gerência', 'vc-teste-ger', 'conectado');
update app.parametros set valor = 595981000000 where chave = 'aviso_pagamento_whatsapp';
update app.parametros set valor = 1 where chave = 'resumo_diario_hora';
set role vc_app;
select teste.ok(extract(hour from now() at time zone 'America/Asuncion') < 1 or (select numero = '595981000000' and (dados->>'a_conferir') is not null from app.resumo_diario_pendente()), 'Resumo do dia sai depois da hora');
select app.resumo_diario_marcar((now() at time zone 'America/Asuncion')::date);
select teste.ok(not exists (select 1 from app.resumo_diario_pendente()), 'Resumo sai uma vez por dia');
reset role;
update app.parametros set valor = 0 where chave in ('aviso_pagamento_whatsapp', 'resumo_diario_hora');
delete from app.whatsapp_conexoes where instancia = 'vc-teste-ger';
delete from app.resumo_diario_envios;
set role vc_app;
select teste.como(:'KEILA');
-- desconto num pedido já criado (até o VIP)
select teste.como(:'KEILA');
select set_config('teste.pc', app.criar_pedido_vendedora(:'CG', 'GS', :'DG', null, null,
  jsonb_build_array(jsonb_build_object('produto_id', :'G1', 'quantidade', 10)), false)::text, false);
select teste.ok(app.aplicar_desconto_pedido(current_setting('teste.pc')::uuid, 10000) = 120000, 'Desconto no pedido criado: 130.000 - 10.000');
select teste.falha(format($$select app.aplicar_desconto_pedido(%L, 10000)$$, current_setting('teste.pc')), 'acima do permitido', 'Segundo desconto passaria do VIP');
select teste.como(:'KEILA');
reset role;
delete from app.deposito_responsaveis where deposito_id = :'DG' and usuario_id = :'KEILA';
set role vc_app;

\echo '== Pedido enviado ao cliente por link =='
select teste.como(:'KEILA');
select set_config('teste.p3', app.criar_pedido_vendedora(:'CG', 'GS', :'DG', null, null,
  jsonb_build_array(jsonb_build_object('produto_id', :'G1', 'quantidade', 12), jsonb_build_object('produto_id', :'G2', 'quantidade', 2)), true)::text, false);
select teste.ok((select status_comercial = 'aguardando_cliente' from app.pedidos where id = current_setting('teste.p3')::uuid),
  'Pedido para o cliente confirmar fica aguardando o cliente');
select teste.ok((select count(*) from app.v_itens_lucro where pedido_id = current_setting('teste.p3')::uuid) = 0,
  'Pedido não confirmado não entra no lucro');
select set_config('teste.i1', (select id from app.pedido_itens where pedido_id = current_setting('teste.p3')::uuid and produto_id = :'G1')::text, false);
select set_config('teste.i2', (select id from app.pedido_itens where pedido_id = current_setting('teste.p3')::uuid and produto_id = :'G2')::text, false);
select app.gerar_link_pedido(current_setting('teste.p3')::uuid, repeat('a', 64));
select app.gerar_link_pedido(current_setting('teste.p3')::uuid, repeat('b', 64));
select teste.como(:'YESSICA');
select teste.falha(format($$select app.gerar_link_pedido(%L, %L)$$, current_setting('teste.p3'), repeat('c', 64)),
  'sem permissão', 'Outra vendedora não gera link do pedido');
select teste.como('');
select teste.ok((select situacao from app.link_pedido(repeat('a', 64))) = 'substituido', 'Link antigo fica substituído pelo novo');
select teste.ok((select situacao = 'aberto' and cliente = 'Cliente Gestão' and jsonb_array_length(itens) = 2 from app.link_pedido(repeat('b', 64))),
  'Cliente abre o pedido pelo link, sem login');
select teste.falha($$select app.confirmar_link_pedido(repeat('a', 64), '[]')$$, 'Link inválido', 'Link substituído não confirma');
select teste.falha(format($$select app.confirmar_link_pedido(%L, %L)$$, repeat('b', 64),
  jsonb_build_array(jsonb_build_object('item_id', current_setting('teste.i2'), 'quantidade', 50))),
  'No momento temos', 'Cliente não aumenta além do estoque');
select app.confirmar_link_pedido(repeat('b', 64),
  jsonb_build_array(jsonb_build_object('item_id', current_setting('teste.i1'), 'quantidade', 24),
                    jsonb_build_object('item_id', current_setting('teste.i2'), 'quantidade', 0)),
  'Pode mandar amanhã');
reset role;
select teste.ok((select status_comercial = 'em_separacao' and valor_total = 312000 and observacoes like '%Pode mandar amanhã%'
                   from app.pedidos where id = current_setting('teste.p3')::uuid),
  'Cliente confirmou: 2 caixas da escova, tirou o pente, pedido foi para separação');
select teste.ok((select situacao from app.link_pedido(repeat('b', 64))) = 'confirmado', 'Link fica marcado como confirmado');
set role vc_app;
select teste.falha($$select app.confirmar_link_pedido(repeat('b', 64), '[]')$$, 'já foi confirmado', 'Não confirma duas vezes');

\echo '== Lucro e comissão =='
select teste.como(:'KEILA');
select teste.ok((select lucro = 156000 and custo = 156000 from app.v_itens_lucro where pedido_id = current_setting('teste.p1')::uuid),
  'Lucro do item: 312.000 − 24 × R$ 5 × 1.300');
select teste.falha($$insert into app.comissao_regras (vendedora_id, vigente_desde, percentual, base)
  values ('00000000-0000-0000-0000-0000000000a1', current_date, 50, 'vendido')$$, 'row-level security', 'Vendedora não define a própria comissão');
select teste.como(:'GERENTE');
insert into app.comissao_regras (vendedora_id, vigente_desde, percentual, base) values (:'VKEILA', current_date, 5, 'lucro');
select teste.ok((select vigente_desde = date_trunc('month', current_date)::date and definido_por = :'GERENTE'::uuid
                   from app.comissao_regras where vendedora_id = :'VKEILA'), 'Regra vale desde o início do mês e registra quem definiu');
select teste.ok((select comissao = round(greatest((select coalesce(sum(lucro), 0) from app.v_itens_lucro
                                                    where vendedora_id = :'VKEILA' and moeda = 'GS'
                                                      and data_pedido >= date_trunc('month', current_date)), 0) * 0.05, 0)
                   from app.comissoes(current_date) where vendedora_id = :'VKEILA' and moeda = 'GS'),
  'Comissão de 5% sobre o lucro do mês');
select teste.como(:'KEILA');
select teste.ok((select count(*) from app.comissoes(current_date) where vendedora_id <> :'VKEILA') = 0, 'Vendedora só vê a própria comissão');
select teste.ok((select base = 'lucro' from app.comissoes(current_date) where moeda = 'GS'), 'Vendedora vê a regra dela');
select teste.como(:'YESSICA');
select teste.ok((select count(*) from app.comissao_regras) = 0, 'Outra vendedora não vê a regra da Keila');

\echo '== Despesas e contas a pagar =='
select teste.como(:'KEILA');
select teste.falha($$insert into app.despesas (categoria, descricao, moeda, valor) values ('aluguel', 'x', 'GS', 1)$$,
  'row-level security', 'Vendedora não lança despesa');
select teste.ok((select count(*) from app.despesas) = 0, 'Vendedora não vê despesas');
select teste.como(:'GERENTE');
insert into app.despesas (id, categoria, descricao, fornecedor, moeda, valor, vencimento) values
  ('00000000-0000-0000-0000-00000000ab31', 'aluguel', 'Aluguel do depósito', 'Imobiliária', 'GS', 3000000, current_date - 1),
  ('00000000-0000-0000-0000-00000000ab32', 'mercadoria', 'Pedido Fonte Teste', 'Fonte Teste', 'BRL', 6705, current_date + 3),
  ('00000000-0000-0000-0000-00000000ab33', 'passeiro', 'Passeiro semana', 'Passeiro', 'GS', 800000, current_date);
select teste.ok((select situacao = 'vencida' and competencia = date_trunc('month', current_date - 1)::date and criado_por = :'GERENTE'::uuid
                   from app.v_despesas where id = '00000000-0000-0000-0000-00000000ab31'), 'Conta vencida aparece como vencida');
select teste.ok((select situacao from app.v_despesas where id = '00000000-0000-0000-0000-00000000ab32') = 'vence_7_dias', 'Conta a vencer na semana');
update app.despesas set pago_em = current_date where id = '00000000-0000-0000-0000-00000000ab33';
select teste.ok((select valor_pago = 800000 and situacao = 'paga' from app.v_despesas where id = '00000000-0000-0000-0000-00000000ab33'),
  'Pagar sem informar o valor usa o valor da conta');
delete from app.despesas where id = '00000000-0000-0000-0000-00000000ab33';
select teste.ok((select count(*) from app.despesas where id = '00000000-0000-0000-0000-00000000ab33') = 1, 'Despesa paga não é apagada');
select teste.como(:'CONSULTA');
select teste.ok((select count(*) from app.despesas) >= 3, 'Consulta vê as despesas');
update app.despesas set valor = 1 where categoria = 'aluguel';
select teste.ok((select valor from app.despesas where id = '00000000-0000-0000-0000-00000000ab31') = 3000000, 'Consulta não altera despesas');

\echo '== Resultado do mês =='
select teste.como(:'GERENTE');
select teste.ok((select despesas = 3800000 from app.resultado_mensal(current_date, current_date) where moeda = 'GS')
  or date_trunc('month', current_date - 1) <> date_trunc('month', current_date),
  'Despesas operacionais do mês em Gs (aluguel + passeiro)');
select teste.ok((select despesas = 0 from app.resultado_mensal(current_date, current_date) where moeda = 'BRL'),
  'Compra de mercadoria não entra como despesa no resultado');
select teste.ok((select resultado = lucro_bruto - despesas from app.resultado_mensal(current_date, current_date) where moeda = 'GS'),
  'Resultado = lucro bruto − despesas');

\echo '== Volumes e envios ao Paraguai =='
select teste.como(:'KEILA');
select app.definir_volumes(current_setting('teste.p1')::uuid, 3);
select teste.como(:'YESSICA');
select teste.falha(format($$select app.definir_volumes(%L, 9)$$, current_setting('teste.p1')), 'Sem permissão', 'Outra vendedora não altera volumes');
reset role;
update app.pedidos set status_comercial = 'enviado', enviado_em = current_date where id = current_setting('teste.p1')::uuid;
update app.parametros set valor = 50000 where chave = 'passeiro_custo_volume';
set role vc_app;
select teste.como(:'GERENTE');
select teste.ok((select volumes >= 3 and caixas_fechadas >= 2 and pecas >= 24 and custo_estimado = volumes * 50000 and passeiro_pago >= 800000
                   from app.envios_paraguai(current_date - 7, current_date) where semana = date_trunc('week', current_date)::date),
  'Resumo da semana: volumes, caixas fechadas, peças, custo estimado e passeiro pago');

\echo '== Parâmetros =='
update app.parametros set valor = 1250 where chave = 'cambio_custo_gs';
select teste.ok(app.param('cambio_custo_gs') = 1250, 'Gerente configura o câmbio do lucro');
select teste.ok((select custo_unitario_brl = 5 and cambio_custo = 1300 from app.pedido_itens where pedido_id = current_setting('teste.p1')::uuid),
  'Mudar o câmbio não mexe no lucro das vendas já feitas');
select teste.como(:'KEILA');
update app.parametros set valor = 1 where chave = 'cambio_custo_gs';
select teste.ok(app.param('cambio_custo_gs') = 1250, 'Vendedora não altera parâmetros');
reset role;
\echo '== Vender o estoque de outra unidade (CD principal vende o que está na CDE) =='
select id as cdeu from app.depositos where codigo = 'loja-cde' \gset
select app._lancar(:'cdeu', :'G1', 'entrada_compra', 5, 'teste', 'gestao-outra', null);
set role vc_app;
select teste.como(:'KEILA');
select teste.falha(format($$select app.criar_pedido_vendedora(%L, 'GS', %L, null, null, '[{"produto_id":"%s","quantidade":9,"origem":"%s"}]', false)$$, :'CG', :'DG', :'G1', :'cdeu'),
  'insuficiente', 'Não vende da CDE mais do que tem lá');
select set_config('teste.po', app.criar_pedido_vendedora(:'CG', 'GS', :'DG', null, null,
  jsonb_build_array(jsonb_build_object('produto_id', :'G1', 'quantidade', 1), jsonb_build_object('produto_id', :'G1', 'quantidade', 3, 'origem', :'cdeu')), false)::text, false);
reset role;
select teste.ok((select t.status = 'solicitada' and t.origem_id = :'cdeu' and t.destino_id = :'DG'
                   and (select sum(quantidade_solicitada) from app.transferencia_itens where transferencia_id = t.id) = 3
                   from app.transferencias t where t.pedido_id = current_setting('teste.po')::uuid), 'Pedido cria a solicitação à CDE com o que sai de lá (3)');
select teste.ok((select count(*) = 2 from app.pedido_itens where pedido_id = current_setting('teste.po')::uuid), 'Item do CD e item da CDE ficam separados no pedido');
update app.pedidos set status_comercial = 'cancelado' where id = current_setting('teste.po')::uuid;
select teste.ok((select status = 'cancelada' from app.transferencias where pedido_id = current_setting('teste.po')::uuid), 'Pedido cancelado cancela a solicitação');
reset role;
\echo 'Testes de gestão comercial passaram.'
