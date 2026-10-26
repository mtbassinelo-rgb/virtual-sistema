-- Testes da importação de produtos pela planilha do Bling. Rodar depois dos outros testes.
\set QUIET on
reset role;
\set GERENTE '00000000-0000-0000-0000-000000000002'
\set KEILA   '00000000-0000-0000-0000-000000000003'
select id as cd from app.depositos where codigo = 'cd-foz' \gset
-- Produto já cadastrado à mão com o mesmo código de um produto do Bling
insert into app.produtos (id, codigo, nome) values ('00000000-0000-0000-0000-00000000ee01','IMP-001','Nome antigo');

\set LOTE1 '[{"bling_id": 7001, "codigo": "IMP-001", "nome": "Shampoo Importado", "preco": 39.9, "custo": 18.5, "estoque": 12, "gtin": "789000000001", "marca": "Soul"}, {"bling_id": 7002, "codigo": "", "nome": "Produto sem código", "preco": 10, "estoque": 5}, {"bling_id": 7003, "codigo": "IMP-003", "nome": "Estoque negativo", "preco": 0, "estoque": -1}]'

\echo '== Importação do Bling =='
set role vc_app;
select teste.como(:'KEILA');
select teste.falha(format($$select app.importar_produtos_bling(%L::jsonb, %L)$$, :'LOTE1', :'cd'), 'Só gerente ou dono', 'Vendedora não importa produtos');
select teste.como(:'GERENTE');
select teste.falha(format($$select app.importar_produtos_bling(%L::jsonb, null, 'py_normal')$$, :'LOTE1'), 'reais', 'Preço em reais não vai para tabela em guaranis');
select (app.importar_produtos_bling(:'LOTE1'::jsonb, :'cd', 'br_normal', 'teste'))::text as r1 \gset
select teste.ok((:'r1'::jsonb->>'novos')::int = 2 and (:'r1'::jsonb->>'atualizados')::int = 1, 'Primeira importação: 2 novos e 1 já existente ligado pelo código');
reset role;
select teste.ok((select bling_produto_id from app.produtos where id = '00000000-0000-0000-0000-00000000ee01') = 7001
  and (select nome from app.produtos where id = '00000000-0000-0000-0000-00000000ee01') = 'Shampoo Importado',
  'Produto existente recebe o ID e o nome do Bling, sem duplicar');
select teste.ok((select codigo from app.produtos where bling_produto_id = 7002) = 'BLING-7002'
  and (select codigo_provisorio from app.produtos where bling_produto_id = 7002), 'Sem código no Bling: código provisório marcado');
select teste.ok((select quantidade from app.estoque_saldos s join app.produtos p on p.id = s.produto_id where p.bling_produto_id = 7001 and s.deposito_id = :'cd') = 12,
  'Estoque da planilha vira o saldo do depósito escolhido');
select teste.ok(coalesce((select quantidade from app.estoque_saldos s join app.produtos p on p.id = s.produto_id where p.bling_produto_id = 7003 and s.deposito_id = :'cd'), 0) = 0,
  'Estoque negativo entra como zero');
select teste.ok((select count(*) from app.estoque_movimentos m join app.produtos p on p.id = m.produto_id
                  where p.bling_produto_id in (7001,7002) and m.referencia_tipo = 'inventario') = 2, 'Estoque entra como ajuste de inventário, registrado');
select teste.ok((select valor from app.precos pr join app.produtos p on p.id = pr.produto_id where p.bling_produto_id = 7001 and tabela = 'br_normal') = 39.90
  and not exists (select 1 from app.precos pr join app.produtos p on p.id = pr.produto_id where p.bling_produto_id = 7003),
  'Preço do Bling vira o Brasil Normal; preço zero é ignorado');

\set LOTE2 '[{"bling_id": 7001, "codigo": "IMP-001", "nome": "Shampoo Importado 500ml", "preco": 39.9, "estoque": 10}, {"bling_id": 7002, "codigo": "IMP-002", "nome": "Produto sem código", "preco": 12, "estoque": 5}]'
set role vc_app;
select teste.como(:'GERENTE');
select (app.importar_produtos_bling(:'LOTE2'::jsonb, :'cd', 'br_normal', 'teste'))::text as r2 \gset
select teste.ok((:'r2'::jsonb->>'novos')::int = 0 and (:'r2'::jsonb->>'atualizados')::int = 2
  and (:'r2'::jsonb->>'estoque_ajustado')::int = 1 and (:'r2'::jsonb->>'precos')::int = 1,
  'Importar de novo atualiza, não duplica; só ajusta o que mudou');
reset role;
select teste.ok((select count(*) from app.produtos where bling_produto_id in (7001,7002,7003)) = 3, 'Continua com 3 produtos');
select teste.ok((select codigo from app.produtos where bling_produto_id = 7002) = 'IMP-002'
  and not (select codigo_provisorio from app.produtos where bling_produto_id = 7002), 'Código corrigido no Bling substitui o provisório');
select teste.ok((select custo from app.produtos where bling_produto_id = 7001) = 18.5, 'Campo que não veio na planilha não é apagado');
select teste.ok((select quantidade from app.estoque_saldos s join app.produtos p on p.id = s.produto_id where p.bling_produto_id = 7001 and s.deposito_id = :'cd') = 10,
  'Nova contagem ajusta o saldo (12 → 10)');

set role vc_app;
select teste.como(:'GERENTE');
select teste.falha($$select app.importar_produtos_bling('[{"bling_id": 7999, "codigo": "IMP-001", "nome": "Outro"}]'::jsonb)$$,
  'já é de outro produto', 'Código repetido em outro produto é recusado');
select teste.falha($$select app.importar_produtos_bling('[]'::jsonb)$$, 'não tem produtos', 'Planilha vazia é recusada');

\echo '== Montar kit de produto importado =='
\set KITB '[{"bling_id": 7101, "codigo": "KB-SH", "nome": "Shampoo B", "estoque": 10}, {"bling_id": 7102, "codigo": "KB-MA", "nome": "Máscara B", "estoque": 4}, {"bling_id": 7103, "codigo": "KB-KIT", "nome": "Kit B", "estoque": 2}]'
select app.importar_produtos_bling(:'KITB'::jsonb, :'cd') \g /dev/null
select id as ksh from app.produtos where codigo = 'KB-SH' \gset
select id as kma from app.produtos where codigo = 'KB-MA' \gset
select id as kkit from app.produtos where codigo = 'KB-KIT' \gset
\set COMP '[{"produto_id": "' :ksh '", "quantidade": 1}, {"produto_id": "' :kma '", "quantidade": 2}]'
select teste.falha(format($$select app.definir_kit(%L, %L::jsonb)$$, :'kkit', :'COMP'), 'zere o saldo', 'Produto com estoque próprio não vira kit');
select app.ajustar_estoque(:'cd', :'kkit', 0, 'kit não tem estoque') \g /dev/null
select app.definir_kit(:'kkit', :'COMP'::jsonb);
select teste.ok(app.saldo_disponivel(:'cd', :'kkit') = 2, 'Kit (1 shampoo + 2 máscaras) disponível = 2 com 4 máscaras');
select teste.ok((select tipo from app.produtos where id = :'kkit') = 'kit', 'Produto passa a ser kit');
select (app.importar_produtos_bling(:'KITB'::jsonb, :'cd'))::text as r3 \gset
select teste.ok((select count(*) from app.estoque_movimentos where produto_id = :'kkit' and tipo = 'ajuste_entrada') = 1,
  'Reimportar não lança estoque no kit');
select teste.como(:'KEILA');
select teste.falha(format($$select app.definir_kit(%L, '[]'::jsonb)$$, :'kkit'), 'Só gerente ou dono', 'Vendedora não monta kit');

\echo '== Preços em lote =='
select teste.como(:'GERENTE');
select (app.importar_precos('[{"codigo":"IMP-001","tabela":"py_normal","valor":20100},{"codigo":"IMP-001","tabela":"br_vip","valor":35.5},{"codigo":"NAO-EXISTE","tabela":"py_vip","valor":1000},{"codigo":"IMP-002","tabela":"py_vip","valor":""}]'::jsonb))::text as rp \gset
select teste.ok((:'rp'::jsonb->>'alterados')::int = 2 and :'rp'::jsonb->'codigos_desconhecidos' = '["NAO-EXISTE"]'::jsonb,
  'Preços gravados; código desconhecido é avisado; célula vazia é ignorada');
select teste.ok((select valor from app.precos pr join app.produtos p on p.id = pr.produto_id where p.codigo = 'IMP-001' and tabela = 'py_normal') = 20000,
  'Preço em Gs é arredondado para múltiplo de 500');
select teste.ok((app.importar_precos('[{"codigo":"IMP-001","tabela":"py_normal","valor":20000}]'::jsonb)->>'alterados')::int = 0, 'Preço igual não gera histórico novo');
select teste.falha($$select app.importar_precos('[{"codigo":"IMP-001","tabela":"xx","valor":1}]'::jsonb)$$, 'desconhecida', 'Tabela inexistente é recusada');
select teste.como(:'KEILA');
select teste.falha($$select app.importar_precos('[]'::jsonb)$$, 'Só gerente ou dono', 'Vendedora não altera preços');

\echo '== Primeiro acesso por link =='
reset role;
insert into app.usuario_convites (token_hash, usuario_id, expira_em) values
  ('hash-valido', '00000000-0000-0000-0000-000000000003', now() + interval '1 day'),
  ('hash-vencido', '00000000-0000-0000-0000-000000000003', now() - interval '1 minute');
set role vc_app;
select teste.como('');
select teste.ok((select email from app.convite_usuario('hash-valido')) = 'keila@t', 'Link válido mostra de quem é');
select teste.ok(not exists (select 1 from app.convite_usuario('hash-vencido')), 'Link vencido não vale');
select teste.falha($$select app.usar_convite_usuario('hash-valido', 'curta')$$, 'Senha inválida', 'Hash de senha inválido é recusado');
select teste.ok(app.usar_convite_usuario('hash-valido', '$argon2id$v=19$m=19456,t=2,p=1$xxxxxxxxxxxxxxxx') = 'keila@t', 'Link define a senha');
select teste.falha($$select app.usar_convite_usuario('hash-valido', '$argon2id$v=19$m=19456,t=2,p=1$yyyyyyyyyyyyyyyy')$$, 'já foi usado', 'Link não vale duas vezes');
select teste.falha($$select * from app.usuario_convites$$, 'permission denied', 'Aplicação não lê a tabela de convites');
reset role;
select teste.ok((select senha_hash from app.usuarios where id = '00000000-0000-0000-0000-000000000003') like '$argon2id$%xxxx', 'Senha gravada');
\echo '== WhatsApp da empresa =='
select teste.ok(app.whatsapp_empresa('GS') = '595994859971' and app.whatsapp_empresa('BRL') = '5545999972092'
  and app.whatsapp_empresa(null) = '5545999972092', 'Gs → número do Paraguai; R$ e site → número do Brasil');
select teste.falha($$insert into app.contatos_empresa values ('outro','123','x')$$, null, 'Só os contatos Brasil e Paraguai');

\echo '== Vitrine e pedidos de visitantes =='
set role vc_app;
select teste.como('');
select teste.ok((select count(*) from app.vitrine_publica()) > 0, 'Vitrine pública lista produtos sem login');
select teste.ok(app.registrar_pedido_site('Maria Salão', '+595 994 111222', 'PY', 'CDE',
  format('[{"produto_id":"%s","quantidade":3},{"produto_id":"00000000-0000-0000-0000-000000000000","quantidade":1}]',
         (select produto_id from app.vitrine_publica() limit 1))::jsonb, 'urgente') = '595994859971',
  'Visitante do Paraguai: pedido registrado e vai para o WhatsApp do Paraguai');
select teste.falha($$select app.registrar_pedido_site('Ana', '119', 'BR', null, '[]'::jsonb, null)$$, 'WhatsApp válido', 'WhatsApp inválido é recusado');
select teste.falha($$select app.registrar_pedido_site('Ana', '45999990000', 'BR', null, '[{"produto_id":"00000000-0000-0000-0000-000000000000","quantidade":1}]'::jsonb, null)$$,
  'vazio', 'Carrinho só com produto inexistente é recusado');
select teste.ok((select count(*) from app.pedidos_site) = 0, 'Visitante não lê pedidos do site');
reset role;
select teste.ok((select jsonb_array_length(itens) from app.pedidos_site where nome = 'Maria Salão') = 1, 'Só o produto real foi guardado');

\echo '== Cadastro de produto pela tela =='
set role vc_app;
select teste.como(:'GERENTE');
select app.salvar_produto(null, 'NOVO-01', 'Shampoo Novo 300ml', 'Soul', 'UN', null, 5.5, true) as novo \gset
select teste.ok((select nome from app.produtos where id = :'novo') = 'Shampoo Novo 300ml', 'Gerente cria produto');
select teste.falha($$select app.salvar_produto(null, 'NOVO-01', 'Outro', null, null, null, null, true)$$, 'já é do produto', 'Código repetido é recusado');
select app.salvar_produto(:'novo', 'NOVO-02', 'Shampoo Novo 300ml', 'Soul', 'UN', null, 5.5, true) \g /dev/null
select teste.ok(exists (select 1 from app.produto_codigos where codigo = 'NOVO-01' and produto_id = :'novo'), 'Código antigo continua reconhecido');
select teste.falha(format($$select app.definir_foto(%L, '/etc/passwd')$$, :'novo'), 'Foto inválida', 'Caminho de foto estranho é recusado');
select app.definir_foto(:'novo', '/fotos/' || :'novo' || '-1.jpg') \g /dev/null
select teste.ok((select foto from app.vitrine_publica() where produto_id = :'novo') like '/fotos/%', 'Foto aparece na vitrine');
select teste.como(:'KEILA');
select teste.falha($$select app.salvar_produto(null, 'X-1', 'Produto X', null, null, null, null, true)$$, 'Só gerente ou dono', 'Vendedora não cadastra produto');
reset role;

\echo '== Destaques da vitrine =='
set role vc_app;
select teste.como('');
select teste.ok((select vendidos_90d from app.vitrine_extras() where produto_id = '00000000-0000-0000-0000-00000000aa10') > 0,
  'Kit vendido aparece entre os mais vendidos');
select teste.como(:'GERENTE');
select app.definir_destaque(:'novo', true);
select teste.ok((select destaque from app.vitrine_extras() where produto_id = :'novo'), 'Gerente marca produto como destaque');
select teste.como(:'KEILA');
select teste.falha(format($$select app.definir_destaque(%L, false)$$, :'novo'), 'Só gerente ou dono', 'Vendedora não escolhe destaque');
reset role;

\echo '== Banners e novidades =='
set role vc_app;
select teste.como(:'GERENTE');
insert into app.banners (titulo, link, idioma, ordem) values ('Semana dos kits', '/loja?linha=kits', 'todos', 1), ('Solo español', '/loja', 'es', 2), ('Vencido', '/loja', 'todos', 3);
update app.banners set fim = current_date - 1 where titulo = 'Vencido';
select teste.falha($$insert into app.banners (titulo, link) values ('x', 'javascript:alert(1)')$$, null, 'Link de banner só para o próprio site ou https');
select app.definir_novidade(:'novo', true);
select teste.como('');
select teste.ok((select count(*) from app.banners_ativos('pt')) = 1 and (select count(*) from app.banners_ativos('es')) = 2, 'Banners por idioma e período');
select teste.ok((select novidade from app.vitrine_publica() where produto_id = :'novo'), 'Novidade aparece na vitrine');
select teste.como(:'KEILA');
select teste.falha($$insert into app.banners (titulo) values ('x')$$, null, 'Vendedora não cria banner');
reset role;

\echo '== Quero ser cliente =='
set role vc_app;
select teste.como('');
select teste.ok(app.registrar_cadastro_site('Salão Bella', 'Ana', '+55 45 98888-7777', 'ana@bella.com', 'Foz', 'salao', null, 'quero tabela', 'pt') = '5545999972092',
  'Cadastro em português vai para o WhatsApp principal');
select teste.falha($$select app.registrar_cadastro_site('Salão Bella', 'Ana', '5545988887777', null, null, null, null, null, 'pt')$$, 'hoje', 'Mesmo WhatsApp no mesmo dia é recusado');
select teste.falha($$select app.registrar_cadastro_site('X Shop', null, '5545911112222', 'nao-e-email', null, null, null, null, 'es')$$, 'E-mail inválido', 'E-mail inválido é recusado');
select teste.ok((select count(*) from app.cadastros_site) = 0, 'Visitante não lê os cadastros');
reset role;
select teste.ok((select tipo from app.cadastros_site where nome = 'Salão Bella') = 'salao', 'Cadastro guardado para a equipe');

\echo '== Caixa fechada =='
set role vc_app;
select teste.como(:'GERENTE');
select teste.ok(app.definir_caixas('[{"codigo":"NOVO-02","unidades":"12"},{"codigo":"NAO-EXISTE","unidades":"6"}]'::jsonb) = 1, 'Peças por caixa gravadas');
select teste.falha($$select app.definir_caixas('[{"codigo":"NOVO-02","unidades":"0"}]'::jsonb)$$, 'entre 1 e 1000', 'Caixa com zero peças é recusada');
select teste.ok((select unidades_caixa from app.vitrine_publica() where codigo = 'NOVO-02') = 12, 'Vitrine mostra as peças por caixa');
reset role;
\echo '== Fotos do catálogo =='
set role vc_app;
select teste.como(:'GERENTE');
select teste.ok(app.importar_fotos_catalogo('[{"id":"p05-01","pagina":5,"nome":"Body Splash","sugestao":"NOVO-02","confianca":"0.9"},{"id":"p05-02","pagina":5,"nome":"Sem produto","sugestao":"NAO-EXISTE"}]'::jsonb) = 2, 'Gerente carrega as fotos do catálogo');
select teste.ok((select sugestao from app.fotos_catalogo where id = 'p05-01') = (select id from app.produtos where codigo = 'NOVO-02'), 'Sugestão ligada ao produto pelo código');
select app.decidir_foto_catalogo('p05-01', 'aplicar', (select id from app.produtos where codigo = 'NOVO-02'));
select app.decidir_foto_catalogo('p05-02', 'descartar', null);
select teste.ok(app.importar_fotos_catalogo('[{"id":"p05-01","pagina":5,"nome":"Outro nome"}]'::jsonb) = 0, 'Recarga não desfaz o que já foi decidido');
select teste.falha($$select app.decidir_foto_catalogo('p05-02', 'aplicar', null)$$, 'Escolha o produto', 'Aplicar exige o produto');
select teste.falha($$select app.importar_fotos_catalogo('[{"id":"../x","pagina":1}]'::jsonb)$$, null, 'Identificador de foto inválido é recusado');
select teste.como(:'KEILA');
select teste.ok((select count(*) from app.fotos_catalogo) = 0, 'Vendedora não vê as fotos do catálogo');
select teste.falha($$select app.decidir_foto_catalogo('p05-02', 'reabrir', null)$$, 'Só gerente ou dono', 'Vendedora não decide as fotos');
reset role;
\echo '== Minha conta e equipe =='
\set DONO '00000000-0000-0000-0000-000000000001'
\set YESSICA '00000000-0000-0000-0000-000000000004'
set role vc_app;
select teste.como(:'GERENTE');
select teste.ok(app.convidar_pessoa('Nova.Pessoa@Loja.com', 'Nova Pessoa', 'consulta', null, repeat('a',64), 48) is not null, 'Gerente cadastra pessoa com link');
select teste.ok((select tem_senha = false and link_pendente is not null from app.equipe() where email = 'nova.pessoa@loja.com'), 'Equipe mostra link pendente, sem senha');
select teste.falha($$select app.convidar_pessoa('outro@dono.com', 'Outro Dono', 'dono', null, repeat('b',64), 48)$$, 'Só o dono', 'Gerente não cria dono');
select teste.falha(format($$select app.gerar_link_senha(%L, %L, 48)$$, :'DONO', repeat('c',64)), 'Só o dono', 'Gerente não gera link para o dono');
select teste.falha(format($$select app.ativar_pessoa(%L, false)$$, :'GERENTE'), 'próprio acesso', 'Ninguém desativa a si mesmo');
select app.gerar_link_senha((select id from app.equipe() where email = 'nova.pessoa@loja.com'), repeat('d',64), 24);
select teste.ok((select count(*) from app.convite_usuario(repeat('a',64))) = 0 and (select count(*) from app.convite_usuario(repeat('d',64))) = 1, 'Só o link mais recente vale');
select app.trocar_minha_senha(repeat('h',40), 'sessao-atual');
select teste.falha($$select app.trocar_minha_senha('curta', null)$$, 'Senha inválida', 'Hash de senha inválido é recusado');
select teste.como(:'KEILA');
select teste.falha($$select * from app.equipe()$$, 'Só gerente ou dono', 'Vendedora não vê a equipe');
select app.trocar_minha_senha(repeat('k',40), null);
select teste.como(:'DONO');
select app.ativar_pessoa((select id from app.equipe() where email = 'nova.pessoa@loja.com'), false);
select teste.ok((select count(*) from app.convite_usuario(repeat('d',64))) = 0, 'Pessoa desativada perde o link');
reset role;
select teste.ok((select senha_hash from app.usuarios where id = :'KEILA') = repeat('k',40), 'Vendedora troca a própria senha');
\echo '== Login do cliente por documento =='
select c.id as cli1 from app.clientes c join app.vendedoras v on v.id = c.vendedora_id where v.nome = 'Keila' and c.mesclado_em is null order by c.criado_em limit 1 \gset
select c.id as cli2 from app.clientes c where c.id <> :'cli1' and c.mesclado_em is null order by c.criado_em limit 1 \gset
set role vc_app;
select teste.como(:'KEILA');
select teste.ok(app.definir_acesso_cliente(:'cli1', '4.567.890-1', repeat('s',40)) = '45678901', 'Vendedora cria acesso com CI (pontuação ignorada)');
select teste.ok((select count(*) from app.portal_dados_login('4567890-1')) = 1, 'Login acha o cliente pelo documento em qualquer formato');
select teste.como(:'GERENTE');
select teste.falha(format($$select app.definir_acesso_cliente(%L, '45678901', %L)$$, :'cli2', repeat('t',40)), 'outro cliente', 'Mesmo documento não vale para dois clientes');
select teste.falha(format($$select app.definir_acesso_cliente(%L, '12', %L)$$, :'cli2', repeat('t',40)), 'Informe o CI', 'Documento curto é recusado');
select teste.como('');
select app.portal_registrar_tentativa('45678901', false) from generate_series(1,5);
select teste.ok((select bloqueado from app.portal_dados_login('45678901')), '5 senhas erradas bloqueiam o documento');
select app.portal_abrir_sessao(:'cli1', 'sessao-cli-1');
select app.portal_abrir_sessao(:'cli1', 'sessao-cli-2');
select teste.ok(app.portal_documento('sessao-cli-1') = '4.567.890-1', 'Cliente logado vê o próprio documento');
select teste.ok(app.portal_senha_provisoria('sessao-cli-1'), 'Senha enviada pela vendedora é provisória');
select app.portal_criar_senha('sessao-cli-1', repeat('p',40));
select teste.ok(not app.portal_senha_provisoria('sessao-cli-1'), 'Depois de criar a própria senha, deixa de ser provisória');
select teste.falha($$select app.portal_criar_senha('sessao-cli-1', repeat('q',40))$$, 'já foi criada', 'Criar senha sem a atual só vale no primeiro acesso');
select app.portal_abrir_sessao(:'cli1', 'sessao-cli-2');
select app.portal_trocar_senha('sessao-cli-1', repeat('n',40));
select teste.ok(app.portal_cliente_id('sessao-cli-2') is null and app.portal_cliente_id('sessao-cli-1') = :'cli1', 'Trocar senha derruba as outras sessões');
select teste.falha($$select app.portal_trocar_senha('sessao-que-nao-existe', repeat('n',40))$$, 'Entre na área', 'Sem sessão não troca senha');
reset role;
select teste.ok((select senha_hash from app.portal_acessos where cliente_id = :'cli1') = repeat('n',40), 'Senha do cliente trocada');
set role vc_app;
select teste.como(:'GERENTE');
select app.bloquear_portal(:'cli1');
select teste.ok((select count(*) from app.portal_dados_login('45678901')) = 0, 'Bloquear acesso impede o login');
reset role;
\echo '== Produtos em lote =='
set role vc_app;
select teste.como(:'GERENTE');
select app.salvar_produto(null, 'LOTE-A', 'Produto Lote A', 'Soul', 'UN', null, 1, true) as la \gset
select app.salvar_produto(null, 'LOTE-B', 'Produto Lote B', 'Soul', 'UN', null, 1, true) as lb \gset
select app.importar_precos('[{"codigo":"LOTE-A","tabela":"br_normal","valor":10}]'::jsonb);
select teste.ok((app.produtos_em_lote(array[:'la', :'lb']::uuid[], 'inativar')->>'inativados')::int = 2, 'Gerente inativa produtos em lote');
select teste.ok((app.produtos_em_lote(array[:'la']::uuid[], 'ativar')->>'ativados')::int = 1, 'Gerente reativa em lote');
select teste.ok((app.produtos_em_lote(array[:'la', :'lb']::uuid[], 'excluir')->>'excluidos')::int = 2, 'Produto sem histórico é excluído (com o preço)');
select teste.ok((select count(*) from app.produtos where codigo in ('LOTE-A','LOTE-B')) = 0, 'Produtos excluídos somem');
select teste.ok((app.produtos_em_lote(array[(select produto_id from app.pedido_itens limit 1)]::uuid[], 'excluir')->>'inativados_por_historico')::int = 1, 'Produto com pedido não é apagado: fica inativo');
select teste.como(:'KEILA');
select teste.falha(format($$select app.produtos_em_lote(array[%L]::uuid[], 'inativar')$$, (select produto_id from app.pedido_itens limit 1)), 'Só gerente ou dono', 'Vendedora não altera em lote');
reset role;
\echo '== Pedido por encomenda =='
select id as cli_enc from app.clientes where id in (select cliente_id from app.portal_sessoes) limit 1 \gset
select token_hash as ses_enc from app.portal_sessoes where cliente_id = :'cli_enc' and expira_em > now() limit 1 \gset
set role vc_app;
select teste.como(:'GERENTE');
select app.salvar_produto(null, 'ENC-01', 'Produto Esgotado', 'Soul', 'UN', null, 1, true) as prod_enc \gset
select app.importar_precos('[{"codigo":"ENC-01","tabela":"py_normal","valor":10000},{"codigo":"ENC-01","tabela":"py_vip","valor":9000},{"codigo":"ENC-01","tabela":"br_normal","valor":10},{"codigo":"ENC-01","tabela":"br_vip","valor":9}]'::jsonb);
reset role;
set role vc_app;
select teste.como('');
select app.portal_criar_pedido(:'ses_enc', format('[{"produto_id":"%s","quantidade":12,"encomenda":true}]', :'prod_enc')::jsonb) as ped_enc \gset
reset role;
select teste.ok((select sum(quantidade) from app.pedido_itens where pedido_id = :'ped_enc') = 12, 'Produto esgotado entra inteiro no pedido (a expedição marca Não tem)');
\echo '== Acompanhamento do pedido =='
set role vc_app;
select teste.como(:'GERENTE');
select app.decidir_pedido_portal(:'ped_enc', true);
select teste.falha(format($$select app.avancar_entrega(%L, 'transporte')$$, :'ped_enc'), 'conferir a separação', 'Não despacha antes de conferir a separação');
select app.conferir_separacao(:'ped_enc', (select jsonb_agg(jsonb_build_object('item_id', id, 'quantidade', 5)) from app.pedido_itens where pedido_id = :'ped_enc'));
select teste.ok((select quantidade_faltou from app.pedido_itens_indisponiveis where pedido_id = :'ped_enc') = 7, 'O que a expedição não tinha fica registrado como indisponível');
select app.ajustar_estoque((select deposito_id from app.pedidos where id = :'ped_enc'), :'prod_enc', 5, 'Chegou a encomenda');
select app.avancar_entrega(:'ped_enc', 'transporte');
select teste.ok((select status_comercial::text from app.pedidos where id = :'ped_enc') = 'enviado', 'Pedido em transporte');
select teste.falha(format($$select app.avancar_entrega(%L, 'retirada', '')$$, :'ped_enc'), 'onde o cliente retira', 'Aguardando retirada exige o local');
select app.avancar_entrega(:'ped_enc', 'retirada', 'Loja Ciudad del Este');
select teste.como('');
select teste.ok((select etapa = 'aguardando_retirada' and local_retirada = 'Loja Ciudad del Este' and jsonb_array_length(indisponiveis) = 1
                   from app.portal_pedidos(:'ses_enc') where id = :'ped_enc'), 'Cliente vê aguardando retirada, o local e o item indisponível');
select teste.como(:'GERENTE');
select app.avancar_entrega(:'ped_enc', 'entregue');
select teste.ok((select status_comercial::text from app.pedidos where id = :'ped_enc') = 'entregue', 'Pedido retirado/entregue');
select teste.como(:'KEILA');
select teste.falha(format($$select app.avancar_entrega(%L, 'transporte')$$, :'ped_enc'), null, 'Vendedora de outra carteira não mexe na entrega');
reset role;
\echo '== Linha de crédito =='
select c.id as cli_cred from app.clientes c join app.vendedoras v on v.id = c.vendedora_id where v.nome = 'Keila' and c.mesclado_em is null order by c.criado_em limit 1 \gset
set role vc_app;
select teste.como(:'KEILA');
select teste.falha(format($$select app.definir_credito_cliente(%L, true, 5000000, 15)$$, :'cli_cred'), 'Só o gerente', 'Vendedora não libera crédito');
select app.sugerir_credito_cliente(:'cli_cred', 5000000, 15, 'Cliente antigo, paga em dia');
select teste.ok((select credito_sugestao_limite = 5000000 and not credito_habilitado from app.clientes where id = :'cli_cred'), 'Vendedora sugere crédito (ainda não liberado)');
select teste.como(:'YESSICA');
select teste.falha(format($$select app.sugerir_credito_cliente(%L, 1, 30, null)$$, :'cli_cred'), 'Sem permissão', 'Outra vendedora não sugere crédito para cliente que não é dela');
select teste.como(:'GERENTE');
select teste.falha(format($$select app.definir_credito_cliente(%L, true, null, 30)$$, :'cli_cred'), 'limite', 'Crédito exige limite');
select app.definir_credito_cliente(:'cli_cred', true, 5000000, 15);
select teste.ok((select credito_habilitado and limite_credito = 5000000 and prazo_credito_dias = 15 and credito_sugestao_limite is null from app.clientes where id = :'cli_cred'), 'Gerente libera o crédito e a sugestão é baixada');
reset role;
select app.portal_abrir_sessao(:'cli_cred', 'sessao-credito') where exists (select 1 from app.portal_acessos where cliente_id = :'cli_cred');
update app.clientes set portal_ativo = true where id = :'cli_cred';
insert into app.portal_sessoes (token_hash, cliente_id, expira_em) values ('sessao-credito-2', :'cli_cred', now() + interval '1 day');
set role vc_app;
select teste.como('');
select teste.ok((select habilitado and limite = 5000000 and disponivel <= 5000000 from app.portal_credito('sessao-credito-2')), 'Cliente vê o limite e o disponível');
select teste.ok((select count(*) from app.portal_extrato('sessao-credito-2')) >= 0, 'Extrato do cliente abre');
select teste.ok((select count(*) from app.portal_credito('sessao-invalida')) = 0, 'Sem sessão não vê crédito');
reset role;
\echo 'Testes de importação passaram.'
