-- Yessica passa a ser responsável pela Loja Ciudad del Este: faz o inventário (contagem) e mexe no estoque/caixa da loja.
-- (O mesmo que marcar a unidade em Equipe → acessos dela.)
insert into app.deposito_responsaveis (deposito_id, usuario_id)
select d.id, u.id
  from app.depositos d
  join app.usuarios u on u.nome ilike 'yessica%' and u.ativo
 where d.codigo = 'loja-cde'
   and not exists (select 1 from app.deposito_responsaveis x where x.deposito_id = d.id and x.usuario_id = u.id);
