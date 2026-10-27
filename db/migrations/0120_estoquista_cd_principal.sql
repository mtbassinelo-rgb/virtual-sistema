-- =====================================================================
-- Migração 0120: estoquista já nasce responsável pelo CD Principal
--
-- Estoquista sem nenhum estoque marcado não conseguia separar nada
-- ("Você ainda não é responsável por nenhum estoque"). Agora:
--   - quem já é estoquista e não tem estoque marcado passa a ser do CD Principal;
--   - estoquista novo (ou quem vira estoquista) também, se não tiver outro marcado.
-- O gerente continua podendo trocar em Equipe → Acessos.
-- =====================================================================
insert into app.deposito_responsaveis (deposito_id, usuario_id)
select d.id, u.id from app.usuarios u cross join app.depositos d
 where u.perfil = 'estoquista' and d.codigo = 'cd-foz'
   and not exists (select 1 from app.deposito_responsaveis r where r.usuario_id = u.id)
on conflict do nothing;

create or replace function app.estoquista_cd_padrao() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if new.perfil = 'estoquista' and not exists (select 1 from app.deposito_responsaveis r where r.usuario_id = new.id) then
    insert into app.deposito_responsaveis (deposito_id, usuario_id)
    select id, new.id from app.depositos where codigo = 'cd-foz' and ativo
    on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists estoquista_cd_padrao on app.usuarios;
create trigger estoquista_cd_padrao after insert or update of perfil on app.usuarios
  for each row execute function app.estoquista_cd_padrao();
