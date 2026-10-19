-- Testes do caixa diário e do inventário por unidade. Rodar depois dos outros testes.
\set QUIET on
reset role;
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set PROD2    '00000000-0000-0000-0000-0000000000b2'
select id as cde from app.depositos where codigo = 'loja-cde' \gset

\echo '== Inventário da loja de CDE =='
set role vc_app;
select teste.como(:'KEILA');
select teste.falha(format($$select app.registrar_inventario(%L, '[{"produto_id":"%s","contado":"5"}]')$$, :'cde', :'PROD2'),
  'responsável', 'Vendedora sem responsabilidade não registra inventário');
select teste.como(:'GERENTE');
select teste.ok(app.registrar_inventario(:'cde', format('[{"produto_id":"%s","contado":"10"}]', :'PROD2')::jsonb) = 1, 'Inventário grava o saldo contado');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cde' and produto_id = :'PROD2') = 10, 'Saldo de CDE fica igual ao contado (10)');

\echo '== Caixa diário =='
select teste.como(:'KEILA');
select app.abrir_caixa(:'cde', 100000, 0) as caixa \gset
select teste.falha(format($$select app.abrir_caixa(%L, 0, 0)$$, :'cde'), 'Já existe um caixa aberto', 'Só um caixa aberto por unidade');
select teste.falha(format($$select app.venda_balcao(%L, null, 'GS', '[{"produto_id":"%s","quantidade":2}]', '[{"modalidade":"efetivo","valor":20000}]')$$, :'caixa', :'PROD2'),
  'Falta receber', 'Cliente avulso precisa pagar a venda inteira');
select teste.falha(format($$select app.venda_balcao(%L, null, 'GS', '[{"produto_id":"%s","quantidade":2}]', '[{"modalidade":"efetivo","valor":99000}]')$$, :'caixa', :'PROD2'),
  'maior que o total', 'Não recebe mais que o total (o troco sai do caixa)');
select app.venda_balcao(:'caixa', null, 'GS', format('[{"produto_id":"%s","quantidade":2}]', :'PROD2')::jsonb,
  '[{"modalidade":"efetivo","valor":20000},{"modalidade":"pix","valor":14000}]'::jsonb) as venda \gset
select teste.ok((select status_comercial::text from app.pedidos where id = :'venda') = 'entregue', 'Venda de balcão já sai entregue');
select teste.ok((select valor_total from app.pedidos where id = :'venda') = 34000, 'Preço da tabela normal em Gs (2 × 17.000)');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cde' and produto_id = :'PROD2') = 8, 'Venda baixa o estoque de CDE (10 - 2)');
select teste.ok((select count(*) from app.pagamentos where pedido_id = :'venda') = 2, 'As duas formas de pagamento ficam no pedido');
select teste.ok(app.caixa_esperado(:'caixa', 'GS') = 120000, 'Gaveta: fundo 100.000 + 20.000 em efetivo (Pix não entra na gaveta)');
select app.movimento_caixa(:'caixa', 'sangria', 'GS', 50000, 'Depósito no banco');
select teste.falha(format($$select app.movimento_caixa(%L, 'despesa', 'GS', 1000, '')$$, :'caixa'), 'motivo', 'Despesa precisa de motivo');
select teste.ok(app.caixa_esperado(:'caixa', 'GS') = 70000, 'Sangria sai da gaveta');
select teste.falha(format($$select app.fechar_caixa(%L, 60000, 0, '')$$, :'caixa'), 'não bate', 'Diferença no fechamento exige explicação');
select teste.ok((app.fechar_caixa(:'caixa', 70000, 0, null)->>'diferenca_gs')::numeric = 0, 'Fechamento sem diferença');
select teste.falha(format($$select app.movimento_caixa(%L, 'reforco', 'GS', 1000, 'troco')$$, :'caixa'), 'já foi fechado', 'Caixa fechado não aceita lançamento');
reset role;

\echo '== Grupos de fragrância =='
set role vc_app;
select teste.como(:'KEILA');
select teste.falha(format($$select app.definir_grupos('[{"produto_id":"%s","grupo":"X","variante":"Y"}]')$$, :'PROD2'), 'Só gerente', 'Vendedora não agrupa produtos');
select teste.como(:'GERENTE');
select teste.ok(app.definir_grupos(format('[{"produto_id":"%s","grupo":"MOUSSE RHENUKS","variante":"Rosa"}]', :'PROD2')::jsonb) = 1, 'Gerente agrupa');
select teste.ok((select variante from app.grupos_publicos() where produto_id = :'PROD2') = 'Rosa', 'Site enxerga o grupo e a fragrância');
select app.definir_grupos(format('[{"produto_id":"%s","grupo":"","variante":"Rosa"}]', :'PROD2')::jsonb);
select teste.ok((select grupo is null and variante is null from app.produtos where id = :'PROD2'), 'Grupo vazio desfaz o agrupamento');
reset role;

\echo '== Vendas do site: link da vendedora, compre junto, desconto por quantidade, eventos =='
reset role;
update app.vendedoras set slug = 'keila' where id = '00000000-0000-0000-0000-0000000000a1';
select teste.ok((select nome from app.vendedora_do_link('KEILA')) = 'Keila', 'Link da vendedora acha a Keila');
select teste.ok((select count(*) from app.compre_junto(array[:'PROD2'::uuid], 6)) >= 0, 'Compre junto responde');
update app.clientes set portal_ativo = true where id = '00000000-0000-0000-0000-0000000000c1';
insert into app.portal_sessoes (token_hash, cliente_id, expira_em) values ('sessao-desc', '00000000-0000-0000-0000-0000000000c1', now() + interval '1 day');
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.salvar_desconto_quantidade(null, '', 5, 10, '', true)$$, 'Só gerente', 'Vendedora não cria desconto');
select teste.como(:'GERENTE');
select app.salvar_desconto_quantidade(null, '', 5, 10, '', true);
select teste.como('');
select app.portal_criar_pedido('sessao-desc', format('[{"produto_id":"%s","quantidade":6}]', :'PROD2')::jsonb) as ped_desc \gset
reset role;
select (select valor_total from app.pedidos where id = :'ped_desc') as antes \gset
set role vc_app;
select teste.como('');
select teste.ok(app.portal_aplicar_desconto_quantidade('sessao-desc', :'ped_desc') = 10, 'Levando 6 (mínimo 5) o pedido fica com 10% a liberar');
reset role;
select teste.ok((select valor_total from app.pedidos where id = :'ped_desc') = cast(:'antes' as numeric), 'Sem a liberação do gerente o preço não muda');
select teste.ok((select desconto_qtd_status from app.pedidos where id = :'ped_desc') = 'pendente', 'Desconto fica esperando o gerente');
set role vc_app;
select teste.como(:'KEILA');
select teste.falha(format($$select app.decidir_desconto_quantidade(%L, true)$$, :'ped_desc'), 'Só o gerente', 'Vendedora não libera desconto');
select teste.como(:'GERENTE');
select teste.ok(app.decidir_desconto_quantidade(:'ped_desc', true) > 0, 'Gerente libera o desconto');
reset role;
select teste.ok((select valor_total from app.pedidos where id = :'ped_desc') < cast(:'antes' as numeric), 'Com a liberação o total cai');
select teste.ok((select descricao ilike '%por quantidade%' from app.pedido_itens where pedido_id = :'ped_desc' limit 1), 'Item mostra o desconto por quantidade');
set role vc_app;
select teste.como('');
select teste.ok(app.portal_aplicar_desconto_quantidade('outra-sessao', :'ped_desc') = 0, 'Outro cliente não mexe no pedido');
select app.registrar_evento_site('visita', 'nav-1', null, null, null, null, 'cd-foz');
select app.registrar_evento_site('busca', 'nav-1', 'sessao-desc', null, 'shampoo', 3, 'cd-foz');
select teste.ok((select count(*) from app.portal_reposicao('sessao-desc')) >= 1, 'Lista de reposição traz o que o cliente comprou');
reset role;
select teste.ok((select count(*) from app.eventos_site where sessao = 'nav-1') = 2, 'Eventos do site registrados');

\echo '== Cliente redefine a senha pelo e-mail =='
reset role;
update app.clientes set email = 'julisa@exemplo.com', documento = 'TESTE-12345' where id = '00000000-0000-0000-0000-0000000000c1';
insert into app.portal_acessos (cliente_id, senha_hash) values ('00000000-0000-0000-0000-0000000000c1', repeat('x', 30)) on conflict (cliente_id) do nothing;
set role vc_app;
select teste.como('');
select teste.ok((select email from app.portal_pedir_redefinicao('teste-12345', 'tok-1')) = 'julisa@exemplo.com', 'Documento com e-mail recebe o link');
select teste.ok(not exists (select 1 from app.portal_pedir_redefinicao('nao-existe', 'tok-x')), 'Documento desconhecido não revela nada');
select teste.ok(app.portal_redefinicao_valida('tok-1'), 'Link vale');
select teste.ok(app.portal_redefinir_senha('tok-1', repeat('y', 40)) = '00000000-0000-0000-0000-0000000000c1', 'Senha nova gravada');
select teste.falha($$select app.portal_redefinir_senha('tok-1', repeat('z', 40))$$, 'já foi usado', 'Link só vale uma vez');
reset role;

\echo '== Acessos: horário e estoquista =='
reset role;
insert into app.usuarios (id, email, nome, perfil, ativo) values ('00000000-0000-0000-0000-0000000000e1', 'estoque@teste.local', 'Estoquista Teste', 'estoquista', true);
set role vc_app;
select teste.como(:'KEILA');
select teste.falha($$select app.definir_acesso_usuario('00000000-0000-0000-0000-0000000000e1', '{}', '[]', '{}')$$, 'gerente', 'Vendedora não mexe em acessos');
select teste.como(:'GERENTE');
select teste.falha(format($$select app.definir_acesso_usuario(%L, '{}', '[]', '{}')$$, :'GERENTE'), 'próprios acessos', 'Ninguém muda os próprios acessos');
select app.definir_acesso_usuario('00000000-0000-0000-0000-0000000000e1', '{"caixa": false}', '[]', array[:'cde']::uuid[]);
select teste.ok((select permissoes->>'caixa' from app.acessos_equipe() where usuario_id = '00000000-0000-0000-0000-0000000000e1') = 'false', 'Permissão desligada fica guardada');
select teste.ok(app.dentro_do_horario('00000000-0000-0000-0000-0000000000e1'), 'Sem horário cadastrado = acesso livre');
select teste.como('00000000-0000-0000-0000-0000000000e1');
select teste.ok(app.pode_operar_deposito(:'cde'), 'Estoquista responsável mexe no estoque da unidade');
select teste.ok(app.perfil_atual() = 'estoquista', 'Estoquista dentro do horário tem perfil');
select teste.como(:'GERENTE');
-- só um dia que nunca é hoje: fora do horário
select app.definir_acesso_usuario('00000000-0000-0000-0000-0000000000e1', '{}',
  jsonb_build_array(jsonb_build_object('dia', (extract(dow from now() at time zone 'America/Sao_Paulo')::int + 1) % 7, 'inicio', '00:00', 'fim', '23:59')), array[:'cde']::uuid[]);
select teste.ok(not app.dentro_do_horario('00000000-0000-0000-0000-0000000000e1'), 'Fora do dia permitido: sem acesso');
select teste.como('00000000-0000-0000-0000-0000000000e1');
select teste.ok(app.perfil_atual() is null, 'Fora do horário o banco não reconhece o perfil (recusa tudo)');
select teste.ok(not app.pode_operar_deposito(:'cde'), 'Fora do horário não mexe no estoque');
select teste.como(:'GERENTE');
select app.definir_acesso_usuario('00000000-0000-0000-0000-0000000000e1', '{}',
  jsonb_build_array(jsonb_build_object('dia', extract(dow from now() at time zone 'America/Sao_Paulo')::int, 'inicio', '00:00', 'fim', '23:59')), '{}');
select teste.ok(app.dentro_do_horario('00000000-0000-0000-0000-0000000000e1'), 'Dentro do dia e horário permitidos: entra');
select teste.ok(app.dentro_do_horario(:'GERENTE'), 'Quem não tem horário entra sempre');

\echo '== Testes do caixa passaram =='
