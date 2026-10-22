-- Categorias principais do site editáveis: criar nova, renomear ou esconder (as do programa continuam como base).
create table app.categorias_site (
  chave   text primary key check (chave ~ '^[a-z0-9-]{2,30}$'),
  nome    text not null check (length(trim(nome)) between 2 and 40),
  nome_es text check (length(nome_es) <= 40),
  ordem   int not null default 50,
  ativo   boolean not null default true
);
alter table app.categorias_site enable row level security;
create policy ler on app.categorias_site for select using (true);
grant select on app.categorias_site to vc_app;

create or replace function app.categorias_publicas()
returns table (chave text, nome text, nome_es text, ordem int, ativo boolean)
language sql stable security definer set search_path = app, pg_temp as $$ select chave, nome, nome_es, ordem, ativo from app.categorias_site $$;
grant execute on function app.categorias_publicas() to vc_app;

create or replace function app.salvar_categoria(p_chave text, p_nome text, p_nome_es text, p_ativo boolean)
returns text language plpgsql security definer set search_path = app, pg_temp as $$
declare v_chave text := coalesce(nullif(trim(p_chave), ''),
  left(trim(both '-' from regexp_replace(lower(translate(trim(p_nome), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')), '[^a-z0-9]+', '-', 'g')), 30));
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono mexe nas categorias.' using errcode = 'insufficient_privilege'; end if;
  if length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Dê um nome à categoria.'; end if;
  insert into app.categorias_site (chave, nome, nome_es, ativo) values (v_chave, trim(p_nome), nullif(trim(coalesce(p_nome_es, '')), ''), coalesce(p_ativo, true))
  on conflict (chave) do update set nome = excluded.nome, nome_es = excluded.nome_es, ativo = excluded.ativo;
  return v_chave;
end $$;
revoke execute on function app.salvar_categoria(text, text, text, boolean) from public;
grant execute on function app.salvar_categoria(text, text, text, boolean) to vc_app;
