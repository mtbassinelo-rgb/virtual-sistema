-- Grupos de fragrância: o mesmo produto em várias fragrâncias/sabores aparece no site como um cartão só;
-- o cliente abre e escolhe quantas caixas de cada fragrância quer. Cada fragrância continua sendo um produto
-- (estoque, preço e código próprios).
alter table app.produtos add column grupo text, add column variante text;
create index on app.produtos (grupo) where grupo is not null;

-- [{"produto_id":"...","grupo":"SABONETE ÍNTIMO RHENUKS","variante":"Morango"}]; grupo vazio tira do grupo
create or replace function app.definir_grupos(p_linhas jsonb) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare r jsonb; n int := 0; g text; v text;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono agrupa produtos.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_array_length(coalesce(p_linhas, '[]')) > 3000 then raise exception 'No máximo 3000 produtos por vez.'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_linhas, '[]')) loop
    g := nullif(left(trim(coalesce(r->>'grupo', '')), 150), '');
    v := case when g is null then null else nullif(left(trim(coalesce(r->>'variante', '')), 80), '') end;
    update app.produtos set grupo = g, variante = v
     where id = (r->>'produto_id')::uuid and (grupo is distinct from g or variante is distinct from v);
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
grant execute on function app.definir_grupos(jsonb) to vc_app;

-- Grupos para o site (só produtos ativos)
create or replace function app.grupos_publicos()
returns table (produto_id uuid, grupo text, variante text)
language sql stable security definer set search_path = app, pg_temp as $$
  select id, grupo, variante from app.produtos where ativo and grupo is not null
$$;
grant execute on function app.grupos_publicos() to vc_app;
