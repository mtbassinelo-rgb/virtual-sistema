-- Histórico do estoque: nome de quem fez cada lançamento (vendedora e estoquista também veem, sem acesso à tabela de usuários)
create or replace function app.nome_usuario(p_usuario uuid) returns text
language sql stable security definer set search_path = app, pg_temp as $$
  select case when p_usuario is null then 'Sistema'
              else coalesce((select case when email = 'sistema@importacao.local' then 'Sistema (importação)' else nome end
                               from app.usuarios where id = p_usuario), 'Usuário removido') end
$$;
grant execute on function app.nome_usuario(uuid) to vc_app;
create index if not exists estoque_movimentos_em on app.estoque_movimentos (em desc);
