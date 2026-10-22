-- =====================================================================
-- Organização dos produtos (pedido do Mateus):
-- 1) Juntar marcas escritas diferente numa só (e a importação passa a usar o nome certo).
-- 3) Subcategorias do site criadas/renomeadas pela equipe.
-- 4) Produtos fixados no topo da categoria.
-- (2: criar kit pela seleção usa app.salvar_produto + app.definir_kit; 5: sugestão de categoria é feita na tela.)
-- =====================================================================

-- 1) Juntar marcas
create or replace function app.juntar_marcas(p_origens text[], p_destino text) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_dest text := upper(nullif(regexp_replace(trim(coalesce(p_destino, '')), '\s+', ' ', 'g'), '')); o text; n int := 0; k int;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono junta marcas.' using errcode = 'insufficient_privilege'; end if;
  if v_dest is null then raise exception 'Informe o nome final da marca.'; end if;
  if coalesce(cardinality(p_origens), 0) = 0 then raise exception 'Escolha as marcas para juntar.'; end if;
  -- o nome final passa a ser o padrão, e os nomes antigos apontam para ele (importação do Bling inclusive)
  insert into app.marcas_padrao (chave, nome) values (app.chave_marca(v_dest), v_dest)
    on conflict (chave) do update set nome = excluded.nome;
  foreach o in array p_origens loop
    continue when o is null or trim(o) = '';
    insert into app.marcas_padrao (chave, nome) values (app.chave_marca(o), v_dest)
      on conflict (chave) do update set nome = excluded.nome;
    update app.produtos set marca = v_dest where marca = o;
    get diagnostics k = row_count; n := n + k;
    update app.compras set marca = v_dest where marca = o;
    update app.descontos_quantidade set marca = v_dest where marca = o;
    if o <> v_dest then
      if exists (select 1 from app.marcas_inteligencia where marca = v_dest) then delete from app.marcas_inteligencia where marca = o;
      else update app.marcas_inteligencia set marca = v_dest where marca = o; end if;
      if exists (select 1 from app.retirada_foz_marcas where marca = v_dest) then delete from app.retirada_foz_marcas where marca = o;
      else update app.retirada_foz_marcas set marca = v_dest where marca = o; end if;
      if exists (select 1 from app.frete_marca where marca = v_dest) then delete from app.frete_marca where marca = o;
      else update app.frete_marca set marca = v_dest where marca = o; end if;
    end if;
  end loop;
  -- produtos com o nome final escrito diferente (maiúsculas, espaços) também ficam iguais
  update app.produtos set marca = v_dest where marca is distinct from v_dest and app.chave_marca(marca) = app.chave_marca(v_dest);
  return n;
end $$;
revoke execute on function app.juntar_marcas(text[], text) from public;
grant execute on function app.juntar_marcas(text[], text) to vc_app;

-- 3) Subcategorias do site
create table app.subcategorias_site (
  linha    text not null check (length(linha) between 2 and 30),
  chave    text not null check (chave ~ '^[a-z0-9-]{2,40}$'),
  nome     text not null check (length(trim(nome)) between 2 and 60),
  nome_es  text check (length(nome_es) <= 60),
  palavras text check (length(palavras) <= 500),   -- palavras no nome que colocam o produto aqui (separadas por vírgula)
  ativo    boolean not null default true,
  primary key (linha, chave)
);
alter table app.subcategorias_site enable row level security;
create policy ler on app.subcategorias_site for select using (true);
grant select on app.subcategorias_site to vc_app;

create or replace function app.subcategorias_publicas()
returns table (linha text, chave text, nome text, nome_es text, palavras text, ativo boolean)
language sql stable security definer set search_path = app, pg_temp as $$
  select linha, chave, nome, nome_es, palavras, ativo from app.subcategorias_site
$$;
grant execute on function app.subcategorias_publicas() to vc_app;

create or replace function app.salvar_subcategoria(p_linha text, p_chave text, p_nome text, p_nome_es text, p_palavras text, p_ativo boolean)
returns text language plpgsql security definer set search_path = app, pg_temp as $$
declare v_chave text := coalesce(nullif(trim(p_chave), ''),
  trim(both '-' from regexp_replace(lower(translate(trim(p_nome), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')), '[^a-z0-9]+', '-', 'g')));
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono mexe nas subcategorias.' using errcode = 'insufficient_privilege'; end if;
  if length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Dê um nome à subcategoria.'; end if;
  v_chave := left(v_chave, 40);
  insert into app.subcategorias_site (linha, chave, nome, nome_es, palavras, ativo)
  values (p_linha, v_chave, trim(p_nome), nullif(trim(coalesce(p_nome_es, '')), ''), nullif(trim(coalesce(p_palavras, '')), ''), coalesce(p_ativo, true))
  on conflict (linha, chave) do update set nome = excluded.nome, nome_es = excluded.nome_es, palavras = excluded.palavras, ativo = excluded.ativo;
  return v_chave;
end $$;
revoke execute on function app.salvar_subcategoria(text, text, text, text, text, boolean) from public;
grant execute on function app.salvar_subcategoria(text, text, text, text, text, boolean) to vc_app;

-- 4) Fixar no topo da categoria
alter table app.produtos add column site_topo boolean not null default false;
create or replace function app.vitrine_topo() returns setof uuid
language sql stable security definer set search_path = app, pg_temp as $$ select id from app.produtos where ativo and site_topo $$;
grant execute on function app.vitrine_topo() to vc_app;
create or replace function app.fixar_topo(p_ids uuid[], p_topo boolean) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare n int;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono fixa produtos no topo.' using errcode = 'insufficient_privilege'; end if;
  update app.produtos set site_topo = coalesce(p_topo, false) where id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function app.fixar_topo(uuid[], boolean) from public;
grant execute on function app.fixar_topo(uuid[], boolean) to vc_app;
