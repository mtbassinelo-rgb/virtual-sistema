-- Testes das unidades: solicitação de mercadoria entre unidades (pedido → separação → aprovação → recebimento).
\set QUIET on
reset role;
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set YESSICA  '00000000-0000-0000-0000-000000000004'
\set EST      '00000000-0000-0000-0000-0000000c0d07'
\set UP1 '00000000-0000-0000-0000-0000000c0d01'
select id as cd from app.depositos where codigo = 'cd-foz' \gset
select id as cde from app.depositos where codigo = 'loja-cde' \gset
insert into app.produtos (id, codigo, nome, marca, custo_unitario_brl) values (:'UP1', 'UNI-001', 'Creme Unidades', 'Marca Uni', 4);
insert into app.usuarios (id, email, nome, perfil, ativo) values (:'EST', 'est-foz@teste.local', 'Estoquista Foz', 'estoquista', true);
insert into app.deposito_responsaveis values (:'cd', :'EST') on conflict do nothing;
insert into app.deposito_responsaveis values (:'cde', :'YESSICA') on conflict do nothing;
select app._lancar(:'cd', :'UP1', 'entrada_compra', 50, 'teste', 'unidades', null);

\echo '== Solicitação de CDE para Foz =='
set role vc_app;
select teste.como(:'YESSICA');
select set_config('teste.t1', app.solicitar_transferencia(:'cd', :'cde', format('[{"produto_id":"%s","quantidade":10}]', :'UP1')::jsonb, 'para cliente Ana')::text, false);
select teste.ok((select status = 'solicitada' from app.transferencias where id = current_setting('teste.t1')::uuid), 'Vendedora de CDE pede ao CD Foz');
select teste.falha(format($$select app.separar_transferencia(%L, '[]')$$, current_setting('teste.t1')), 'estoque de origem', 'Quem pediu não separa no CD Foz');
select teste.falha(format($$select app.solicitar_transferencia(%L, %L, '[{"produto_id":"%s","quantidade":1}]')$$, :'cde', :'cd', :'UP1'),
  'não trabalha', 'Só pede para a unidade em que trabalha');

select teste.como(:'EST');
select teste.falha(format($$select app.separar_transferencia(%L, '[{"produto_id":"%s","quantidade":80}]')$$, current_setting('teste.t1'), :'UP1'),
  'Não há', 'Não separa mais do que tem');
select app.separar_transferencia(current_setting('teste.t1')::uuid, format('[{"produto_id":"%s","quantidade":6}]', :'UP1')::jsonb);
select teste.ok((select status = 'separada' from app.transferencias where id = current_setting('teste.t1')::uuid)
            and (select quantidade_enviada = 6 and quantidade_solicitada = 10 from app.transferencia_itens where transferencia_id = current_setting('teste.t1')::uuid),
  'Estoquista separa o que tem (6 de 10)');
select teste.falha(format('select app.aprovar_transferencia(%L)', current_setting('teste.t1')), 'gerente', 'Estoquista não aprova o envio');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'UP1') = 50, 'Antes da aprovação o estoque não sai');

select teste.como(:'GERENTE');
select app.aprovar_transferencia(current_setting('teste.t1')::uuid);
select teste.ok((select status = 'enviada' and valor_custo = 24 from app.transferencias where id = current_setting('teste.t1')::uuid), 'Aprovado: enviado com o custo (6 × 4)');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = :'UP1') = 44, 'Saiu do CD Foz');

select teste.como(:'YESSICA');
select app.receber_transferencia(current_setting('teste.t1')::uuid, '[]', null);
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cde' and produto_id = :'UP1') = 6, 'Entrou no estoque de CDE');

\echo '== Encarregada aprova; quem pediu cancela =='
select set_config('teste.t2', app.solicitar_transferencia(:'cd', :'cde', format('[{"produto_id":"%s","quantidade":3}]', :'UP1')::jsonb)::text, false);
select app.cancelar_transferencia(current_setting('teste.t2')::uuid, 'cliente desistiu');
select teste.ok((select status = 'cancelada' and motivo_cancelamento = 'cliente desistiu' from app.transferencias where id = current_setting('teste.t2')::uuid),
  'Quem pediu cancela antes do envio');
select set_config('teste.t3', app.solicitar_transferencia(:'cd', :'cde', format('[{"produto_id":"%s","quantidade":2}]', :'UP1')::jsonb)::text, false);
select teste.como(:'EST');
select app.separar_transferencia(current_setting('teste.t3')::uuid, '[]');
reset role;
update app.usuarios set aprova_transferencias = true where id = :'KEILA';
set role vc_app;
select teste.como(:'KEILA');
select app.aprovar_transferencia(current_setting('teste.t3')::uuid);
select teste.ok((select status = 'enviada' from app.transferencias where id = current_setting('teste.t3')::uuid), 'Vendedora encarregada aprova o envio');
select teste.falha(format('select app.cancelar_transferencia(%L)', current_setting('teste.t3')), 'já enviada', 'Enviada não cancela');

reset role;
\echo '== Testes das unidades passaram =='
