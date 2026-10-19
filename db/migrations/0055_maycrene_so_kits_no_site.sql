-- Maycrene: no site e na área do cliente aparecem só os kits completos (shampoo + condicionador + máscara).
-- Shampoo, condicionador e máscara avulsos saem do site, mas continuam no sistema: o estoque dos kits é deles
-- e a vendedora ainda os enxerga. O gerente pode religar "Mostrar no site" em cada produto se precisar.
update app.produtos p
   set mostrar_no_site = false
 where p.mostrar_no_site
   and (app.nome_normal(p.marca) = 'maycrene' or app.nome_normal(p.nome) ~ '\mmaycrene\M')
   and coalesce(upper(p.unidade), '') <> 'KIT'
   and not exists (select 1 from app.kit_componentes k where k.kit_id = p.id)
   and app.nome_normal(p.nome) ~ '^(shampoo|condicionador|mascara)\M';
