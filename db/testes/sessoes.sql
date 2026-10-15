-- Testes de login e sessões. Rodar depois dos outros testes.
\set QUIET on
reset role;
\set KEILA '00000000-0000-0000-0000-000000000003'
\set DONO  '00000000-0000-0000-0000-000000000001'
update app.usuarios set senha_hash = '$argon2id$exemplo' where id = :'KEILA';

\echo '== Login e sessões =='
set role vc_app;
select teste.como('');
select teste.ok((select senha_hash from app.dados_login('KEILA@t')) = '$argon2id$exemplo', 'Login acha o usuário pelo e-mail sem diferenciar maiúsculas');
select teste.ok((select count(*) from app.dados_login('ninguem@t')) = 0, 'E-mail inexistente não devolve nada');
select teste.falha($$select senha_hash from app.usuarios$$, 'permission denied', 'Aplicação não lê hash de senha da tabela');
select app.criar_sessao(:'KEILA', 'hash-token-1', 30, '1.2.3.4', 'teste');
select teste.ok((select perfil from app.sessao_valida('hash-token-1')) = 'vendedora', 'Sessão válida devolve o perfil');
select teste.ok((select count(*) from app.sessao_valida('hash-errado')) = 0, 'Token desconhecido não abre sessão');
select app.registrar_tentativa('keila@t', false) from generate_series(1,5);
select teste.ok((select bloqueado from app.dados_login('keila@t')), 'Cinco senhas erradas em 15 minutos bloqueiam o login');
select teste.como(:'KEILA');
select app.definir_senha(:'KEILA', '$argon2id$nova');
select teste.ok((select count(*) from app.sessao_valida('hash-token-1')) = 0, 'Trocar a senha derruba as sessões abertas');
select teste.falha($$select app.definir_senha('00000000-0000-0000-0000-000000000004', 'x')$$, 'sem permissão', 'Vendedora não troca senha de outra pessoa');
select teste.como(:'DONO');
select app.definir_senha('00000000-0000-0000-0000-000000000004', '$argon2id$x');
select teste.ok(true, 'Dono redefine a senha de qualquer usuário');
reset role;
select teste.ok((select depois->>'senha_hash' from app.auditoria where tabela='usuarios' and depois ? 'senha_hash' order by id desc limit 1) = '(senha alterada)',
  'Auditoria registra a troca de senha sem guardar a senha');
select app.encerrar_sessao('hash-token-1');
\echo '== Testes de sessões passaram =='
