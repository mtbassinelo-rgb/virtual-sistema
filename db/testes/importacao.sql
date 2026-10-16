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
\echo 'Testes de importação passaram.'
