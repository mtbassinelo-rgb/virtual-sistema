-- Duplicar produto: depois de criar a cópia pela tela (código, nome, preços, kit e foto),
-- copia o que não está no formulário: categorias do site, grupo de fragrância, frete por unidade e estoque mínimo.
-- A variante (fragrância) não é copiada: a cópia normalmente é outra fragrância.
create or replace function app.copiar_extras_produto(p_de uuid, p_para uuid)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then
    raise exception 'Só gerente ou dono duplica produtos.' using errcode = 'insufficient_privilege';
  end if;
  if p_de = p_para then return; end if;
  update app.produtos n set site_categorias = o.site_categorias, site_subcategoria = o.site_subcategoria,
         grupo = o.grupo, frete_unidade_brl = o.frete_unidade_brl, estoque_minimo = o.estoque_minimo
    from app.produtos o where o.id = p_de and n.id = p_para;
end $$;
grant execute on function app.copiar_extras_produto(uuid, uuid) to vc_app;
