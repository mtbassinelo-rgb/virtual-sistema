-- Yessica: inventário só da loja de CDE (ver e atualizar a contagem), a pedido do dono.
-- Responsável apenas pelo estoque de CDE; qualquer outro estoque marcado para ela sai.
insert into app.deposito_responsaveis (deposito_id, usuario_id)
select d.id, u.id from app.depositos d join app.usuarios u on (u.nome ilike 'yessica%' or u.nome ilike 'jessica%' or u.nome ilike 'jéssica%') and u.ativo
 where d.codigo = 'loja-cde'
on conflict do nothing;
delete from app.deposito_responsaveis r
 using app.usuarios u, app.depositos d
 where r.usuario_id = u.id and r.deposito_id = d.id and d.codigo <> 'loja-cde'
   and (u.nome ilike 'yessica%' or u.nome ilike 'jessica%' or u.nome ilike 'jéssica%') and u.perfil = 'vendedora';
-- área de inventário ligada (caso tenha sido desligada em Equipe → Acessos)
update app.usuarios set permissoes = permissoes || '{"inventario": true}'
 where (nome ilike 'yessica%' or nome ilike 'jessica%' or nome ilike 'jéssica%') and perfil = 'vendedora';
