-- Testes da área de atacado, giro e promoções. Rodar depois dos outros testes.
\set QUIET on
reset role;
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set YESSICA  '00000000-0000-0000-0000-000000000004'
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set JULISA   '00000000-0000-0000-0000-0000000000c1'
\set PROD     '00000000-0000-0000-0000-0000000000b1'
select id as cd from app.depositos where codigo = 'cd-foz' \gset
-- estes testes cobrem a loja que oferece também o estoque do CD que a abastece
update app.depositos set mostra_abastecedor = true where codigo = 'loja-cde';
-- Segundo produto, parado (sem vendas)
insert into app.produtos (id, codigo, nome, fornecedor) values ('00000000-0000-0000-0000-0000000000b2','RHE-011','Mousse','Rhenuks');
insert into app.precos (produto_id, tabela, valor, vigente_desde) values
  ('00000000-0000-0000-0000-0000000000b2','py_normal',17000,current_date - 30),
  ('00000000-0000-0000-0000-0000000000b2','py_vip',16000,current_date - 30);
insert into app.estoque_movimentos (deposito_id, produto_id, tipo, quantidade, referencia_tipo, referencia_id)
  values (:'cd','00000000-0000-0000-0000-0000000000b2','entrada_compra',200,'compra','teste');

\echo '== Giro e sugestões de promoção =='
set role vc_app;
select teste.como(:'GERENTE');
select teste.ok((select situacao from app.v_giro where produto_id = '00000000-0000-0000-0000-0000000000b2' and deposito_id = :'cd') = 'parado',
  'Produto com estoque e sem vendas aparece como parado');
select teste.ok(exists (select 1 from app.v_sugestoes_promocao where codigo = 'RHE-011'),
  'Produto parado vira sugestão de promoção');

select teste.falha($$insert into app.promocoes (produto_id, pais, desconto_pct, inicio, fim)
  values ('00000000-0000-0000-0000-0000000000b2','PY',60,current_date,current_date+10)$$, 'máximo', 'Desconto acima do máximo é barrado');
insert into app.promocoes (id, produto_id, pais, desconto_pct, inicio, fim, origem, motivo)
  values ('00000000-0000-0000-0000-0000000000f9','00000000-0000-0000-0000-0000000000b2','PY',10,current_date,current_date+15,'sugestao_giro','Estoque parado');
select teste.ok((select status from app.promocoes where id='00000000-0000-0000-0000-0000000000f9') = 'proposta', 'Promoção nasce como proposta');
select teste.ok((select (app.preco_final(:'JULISA','00000000-0000-0000-0000-0000000000b2')).preco) = 16000,
  'Promoção não aprovada não muda o preço do cliente');
select teste.como(:'KEILA');
select teste.falha($$insert into app.promocoes (produto_id, pais, desconto_pct, inicio, fim)
  values ('00000000-0000-0000-0000-0000000000b2','PY',5,current_date,current_date+10)$$, 'row-level security', 'Vendedora não cria promoção');
select teste.falha($$select app.decidir_promocao('00000000-0000-0000-0000-0000000000f9', true)$$, 'gerente', 'Vendedora não aprova promoção');
select teste.como(:'GERENTE');
select app.decidir_promocao('00000000-0000-0000-0000-0000000000f9', true);
select teste.ok((select (app.preco_final(:'JULISA','00000000-0000-0000-0000-0000000000b2')).preco) = 14500,
  'Promoção aprovada: VIP Gs 16.000 - 10% = Gs 14.400, arredondado para Gs 14.500');
select teste.ok(not exists (select 1 from app.v_sugestoes_promocao where codigo = 'RHE-011'),
  'Produto com promoção ativa sai das sugestões');

\echo '== Acesso do cliente =='
select teste.como(:'YESSICA');
select teste.falha($$select app.gerar_convite_portal('00000000-0000-0000-0000-0000000000c1', 'convite-x')$$, 'sem permissão',
  'Vendedora não dá acesso a cliente de outra');
select teste.como(:'KEILA');
select app.gerar_convite_portal(:'JULISA', 'convite-1');
select teste.como('');
select teste.ok(app.portal_entrar('convite-1', 'sessao-1'), 'Cliente entra com o link');
select teste.ok(not app.portal_entrar('convite-1', 'sessao-2'), 'O link vale uma única vez');
select teste.ok(not app.portal_entrar('convite-inventado', 'sessao-3'), 'Link inventado não entra');
select teste.ok((select moeda from app.portal_perfil('sessao-1')) = 'GS' and (select categoria from app.portal_perfil('sessao-1')) = 'vip',
  'Cliente vê a própria moeda e categoria');
select teste.ok((select count(*) from app.portal_perfil('sessao-errada')) = 0, 'Sessão desconhecida não vê nada');
select teste.ok((select count(*) from app.clientes) = 0, 'Conexão sem usuário interno não enxerga clientes');

\echo '== Catálogo inteligente =='
select teste.ok((select codigo from app.portal_catalogo('sessao-1') limit 1) = 'RHE-011', 'Promoção aparece em primeiro na vitrine');
select teste.ok((select destaque from app.portal_catalogo('sessao-1') where codigo = 'RHE-011') = 'promocao', 'Produto marcado como promoção');
select teste.ok((select preco_tabela from app.portal_catalogo('sessao-1') where codigo = 'RHE-011') = 16000, 'Mostra o preço de tabela riscado');
select teste.ok((select destaque from app.portal_catalogo('sessao-1') where codigo = 'RHE-001') = 'recompra', 'Produto já comprado aparece como recompra');
select teste.ok((select preco from app.portal_catalogo('sessao-1') where codigo = 'RHE-001') = 6500, 'Preço VIP em Gs para o cliente VIP');
select teste.ok((select disponibilidade from app.portal_catalogo('sessao-1') where codigo = 'RHE-001') = 'disponivel', 'Disponibilidade sem mostrar quantidade');
select teste.ok((select situacao from app.portal_situacao_estoque('sessao-1') where produto_id = '00000000-0000-0000-0000-0000000000b1') = 'retirar',
  'Bolinha verde: tem na unidade do cliente');
select teste.ok((select count(*) from app.portal_situacao_estoque('sessao-inexistente')) = 0, 'Sem sessão não mostra disponibilidade');

\echo '== Pedido do cliente =='
select app.portal_criar_pedido('sessao-1', '[{"produto_id":"00000000-0000-0000-0000-0000000000b2","quantidade":999}]') as p_mais \gset
reset role;
select teste.ok((select count(*) from app.pedido_itens where pedido_id = :'p_mais' and descricao not like '%SEM ESTOQUE%') >= 1
  and not exists (select 1 from app.pedido_itens where pedido_id = :'p_mais' and descricao like '%SEM ESTOQUE%'), 'Pedido acima do estoque entra sem dividir a linha (a expedição marca o que faltar)');
select teste.ok((select sum(quantidade) from app.pedido_itens where pedido_id = :'p_mais') = 999, 'Quantidade pedida mantida inteira');
delete from app.pedido_itens where pedido_id = :'p_mais'; delete from app.pedidos where id = :'p_mais';
set role vc_app;
select teste.como('');
select app.portal_criar_pedido('sessao-1', '[{"produto_id":"00000000-0000-0000-0000-0000000000b2","quantidade":24},{"produto_id":"00000000-0000-0000-0000-0000000000b1","quantidade":12}]', 'Entregar sexta') as pp \gset
reset role;
select teste.ok((select status_comercial from app.pedidos where id = :'pp') = 'aguardando_aprovacao', 'Pedido do cliente aguarda aprovação da vendedora');
select teste.ok((select valor_total from app.pedidos where id = :'pp') = 24 * 14500 + 12 * 6500, 'Total com preço promocional e VIP congelados');
select teste.ok((select origem::text || '/' || canal from app.pedidos where id = :'pp') = 'portal/portal', 'Origem e canal: área do cliente');
select teste.ok((select vendedora_id from app.pedidos where id = :'pp') = '00000000-0000-0000-0000-0000000000a1', 'Pedido vai para a vendedora do cliente');
set role vc_app;
select teste.como('');
select teste.ok((select count(*) from app.portal_pedidos('sessao-1') where id = :'pp') = 1, 'Cliente vê o próprio pedido');
select teste.falha(format($$select app.portal_enviar_pagamento('sessao-1', %L, 100000, current_date, 'transferencia', 'abc.jpg', 'comp.jpg', 'image/jpeg', 1000, 'abc')$$, :'pp'),
  'confirmar o total', 'Cliente não paga antes da vendedora confirmar o total');
set role vc_app;
select teste.como(:'YESSICA');
select teste.falha(format($$select app.decidir_pedido_portal(%L, true)$$, :'pp'), null, 'Outra vendedora não aprova');
select teste.como(:'KEILA');
select teste.falha(format($$select app.decidir_pedido_portal(%L, false, '')$$, :'pp'), 'motivo', 'Recusa exige motivo para o cliente');
select app.decidir_pedido_portal(:'pp', true);
select teste.ok((select status_comercial from app.pedidos where id = :'pp') = 'em_separacao', 'Vendedora aprova e o pedido vai para separação');
select teste.falha(format($$select app.confirmar_total(%L, 'Banco Continental 123')$$, :'pp'), 'conferir a separação',
  'Total só é confirmado depois da expedição conferir');
select teste.falha(format($$select app.conferir_separacao(%L)$$, :'pp'), 'expedição', 'Vendedora sem depósito não confere a separação');

\echo '== Separação, total e pagamento manual =='
select teste.como(:'GERENTE');
select id as item_mousse from app.pedido_itens where pedido_id = :'pp' and codigo = 'RHE-011' \gset
select teste.ok(app.conferir_separacao(:'pp', format('[{"item_id":"%s","quantidade":20}]', :'item_mousse')::jsonb) = 20 * 14500 + 12 * 6500,
  'Expedição separou 20 de 24 Mousses e o total foi recalculado');
select teste.ok((select quantidade_pedida from app.pedido_itens where id = :'item_mousse') = 24, 'Fica registrado quanto foi pedido');
select teste.como(:'KEILA');
select app.confirmar_total(:'pp', 'Banco Continental · Cuenta 12345 · Virtual Cosméticos');
select teste.falha(format($$update app.pedido_itens set quantidade = 1 where id = %L$$, :'item_mousse'), 'já foi confirmado',
  'Depois do total confirmado, itens não mudam');
select teste.como('');
select teste.ok((select etapa from app.portal_pedidos('sessao-1') where id = :'pp') = 'aguardando_pagamento', 'Cliente vê: aguardando pagamento');
select teste.ok((select conta_pagamento from app.portal_pedidos('sessao-1') where id = :'pp') like 'Banco Continental%', 'Cliente vê a conta para pagar');
select app.portal_enviar_pagamento('sessao-1', :'pp', 100000, current_date, 'transferencia', 'abc.jpg', 'comp.jpg', 'image/jpeg', 1000, 'abc');
reset role;
select teste.ok((select status_conferencia from app.pagamentos where pedido_id = :'pp') = 'pendente'
  and (select enviado_pelo_cliente from app.pagamentos where pedido_id = :'pp'), 'Comprovante do cliente entra como pagamento a conferir');

\echo '== Loja de CDE com abastecimento do CD de Foz =='
select id as cde from app.depositos where codigo = 'loja-cde' \gset
insert into app.clientes (id, nome, vendedora_id, categoria_preco, deposito_id)
  values ('00000000-0000-0000-0000-0000000000c9','Cliente da Loja','00000000-0000-0000-0000-0000000000a2','normal', :'cde');
insert into app.estoque_movimentos (deposito_id, produto_id, tipo, quantidade, referencia_tipo, referencia_id)
  values (:'cde','00000000-0000-0000-0000-0000000000b1','entrada_compra',10,'compra','teste-cde');
select quantidade as saldo_cde from app.estoque_saldos where deposito_id = :'cde' and produto_id = '00000000-0000-0000-0000-0000000000b1' \gset
set role vc_app;
select teste.como(:'YESSICA');
select app.gerar_convite_portal('00000000-0000-0000-0000-0000000000c9', 'convite-cde');
select teste.como('');
select app.portal_entrar('convite-cde', 'sessao-cde');
select teste.ok((select disponivel_abastecedor from app.portal_catalogo('sessao-cde') where codigo = 'RHE-001')
  and (select prazo_abastecimento from app.portal_catalogo('sessao-cde') where codigo = 'RHE-001') = '1 a 3 dias',
  'Cliente da loja vê que pode pedir do CD de Foz em 1 a 3 dias');
select app.portal_criar_pedido('sessao-cde', format('[{"produto_id":"00000000-0000-0000-0000-0000000000b1","quantidade":%s}]', :'saldo_cde'::numeric + 20)::jsonb) as pc \gset
reset role;
select teste.ok((select quantidade from app.pedido_itens i join app.depositos d on d.id = i.deposito_origem_id
                  where pedido_id = :'pc' and d.codigo = 'loja-cde') = :'saldo_cde'::numeric, 'Primeiro sai todo o estoque da loja');
select teste.ok((select quantidade from app.pedido_itens i join app.depositos d on d.id = i.deposito_origem_id
                  where pedido_id = :'pc' and d.codigo = 'cd-foz') = 20, 'O restante vem do CD de Foz (20)');
select teste.ok((select descricao from app.pedido_itens i join app.depositos d on d.id = i.deposito_origem_id
                  where pedido_id = :'pc' and d.codigo = 'cd-foz') like '%1 a 3 dias%', 'Item do CD avisa o prazo');
set role vc_app;
select teste.como(:'YESSICA');
select app.decidir_pedido_portal(:'pc', true) as tr \gset
reset role;
select teste.ok((select status from app.transferencias where id = :'tr') = 'rascunho'
  and (select quantidade_enviada from app.transferencia_itens where transferencia_id = :'tr') = 20
  and (select pedido_id from app.transferencias where id = :'tr') = :'pc'::uuid,
  'Aprovação prepara a transferência Foz → CDE ligada ao pedido');

\echo '== Bloqueio de acesso =='
set role vc_app;
select teste.como(:'KEILA');
select app.bloquear_portal(:'JULISA');
select teste.como('');
select teste.ok((select count(*) from app.portal_perfil('sessao-1')) = 0, 'Acesso bloqueado derruba a sessão do cliente');
reset role;

\echo '== Preço promocional pela lista =='
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.definir_preco_promocional('00000000-0000-0000-0000-0000000000b2', 'PY', 15000)$$, 'Só gerente', 'Vendedora não define preço promocional');
select teste.como(:'GERENTE');
select teste.falha($$select app.definir_preco_promocional('00000000-0000-0000-0000-0000000000b2', 'PY', 18000)$$, 'menor que o normal', 'Promo precisa ser abaixo do preço normal');
select teste.falha($$select app.definir_preco_promocional('00000000-0000-0000-0000-0000000000b2', 'BR', 5)$$, 'preço normal', 'Sem preço normal não tem promo');
select teste.ok(app.definir_preco_promocional('00000000-0000-0000-0000-0000000000b2', 'PY', 15300) = 10, 'Promo de 15.300 sobre 17.000 = 10% de desconto');
select teste.ok(exists (select 1 from app.promocoes where produto_id = '00000000-0000-0000-0000-0000000000b2' and pais = 'PY' and desconto_pct = 10 and status = 'aprovada' and inicio = current_date), 'Promo da lista já entra aprovada');
select app.definir_preco_promocional('00000000-0000-0000-0000-0000000000b2', 'PY', 13600);
select teste.ok((select count(*) from app.promocoes where produto_id = '00000000-0000-0000-0000-0000000000b2' and pais = 'PY' and status = 'aprovada') = 1, 'Novo preço promocional substitui o anterior');
select app.definir_preco_promocional('00000000-0000-0000-0000-0000000000b2', 'PY', null);
select teste.ok(not exists (select 1 from app.promocoes where produto_id = '00000000-0000-0000-0000-0000000000b2' and status = 'aprovada'), 'Apagar o preço promocional encerra a promo');
select app.importar_precos('[{"codigo":"RHE-011","tabela":"py_normal","valor":19000}]');
select teste.ok(app.remover_preco_de_hoje('00000000-0000-0000-0000-0000000000b2', 'py_normal'), 'Desfazer tira o preço de hoje');
select teste.ok((select valor from app.precos where produto_id = '00000000-0000-0000-0000-0000000000b2' and tabela = 'py_normal' order by vigente_desde desc limit 1) = 17000, 'E volta a valer o preço anterior');
reset role;
reset role;
update app.depositos set mostra_abastecedor = false where codigo = 'loja-cde';
\echo '== Testes da área de atacado passaram =='
