-- =====================================================================
-- Categorias do site escolhidas à mão. O site calcula a categoria pelo nome do produto;
-- aqui a gestão pode fixar em quais categorias o produto aparece (ex.: um kit também em Matizadores)
-- e a subcategoria. Vazio = automático pelo nome.
-- =====================================================================
alter table app.produtos
  add column site_categorias text[] check (site_categorias is null or cardinality(site_categorias) between 1 and 6),
  add column site_subcategoria text check (length(site_subcategoria) <= 40);
comment on column app.produtos.site_categorias is 'Categorias do site fixadas à mão (a primeira é a principal). Null = automático pelo nome.';

create or replace function app.vitrine_categorias()
returns table (produto_id uuid, categorias text[], subcategoria text)
language sql stable security definer set search_path = app, pg_temp as $$
  select id, site_categorias, site_subcategoria from app.produtos
   where ativo and (site_categorias is not null or site_subcategoria is not null)
$$;
grant execute on function app.vitrine_categorias() to vc_app;

-- modo: 'definir' (troca as categorias), 'adicionar' (soma às atuais), 'auto' (volta ao automático)
create or replace function app.definir_categorias_site(p_ids uuid[], p_modo text, p_categorias text[], p_sub text, p_atuais jsonb default '{}')
returns int language plpgsql security definer set search_path = app, pg_temp as $$
declare n int;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono organiza as categorias do site.' using errcode = 'insufficient_privilege'; end if;
  if p_modo = 'auto' then
    update app.produtos set site_categorias = null, site_subcategoria = null where id = any(p_ids);
  elsif p_modo = 'definir' then
    if coalesce(cardinality(p_categorias), 0) = 0 then raise exception 'Escolha a categoria.'; end if;
    update app.produtos set site_categorias = p_categorias, site_subcategoria = nullif(trim(coalesce(p_sub, '')), '') where id = any(p_ids);
  elsif p_modo = 'adicionar' then
    if coalesce(cardinality(p_categorias), 0) = 0 then raise exception 'Escolha a categoria.'; end if;
    -- p_atuais: categorias que o produto já mostra hoje (automáticas), para não perder a principal ao somar
    update app.produtos p set site_categorias = x.base || array(select c from unnest(p_categorias) c where not c = any(x.base))
      from (select q.id, coalesce(q.site_categorias, array(select jsonb_array_elements_text(coalesce(p_atuais -> q.id::text, '[]'::jsonb)))) as base
              from app.produtos q where q.id = any(p_ids)) x
     where p.id = x.id and p.id = any(p_ids);
  else
    raise exception 'Modo inválido.';
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function app.definir_categorias_site(uuid[], text, text[], text, jsonb) from public;
grant execute on function app.definir_categorias_site(uuid[], text, text[], text, jsonb) to vc_app;
