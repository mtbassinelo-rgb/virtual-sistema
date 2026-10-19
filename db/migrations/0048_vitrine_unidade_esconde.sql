-- Correção: a vitrine por unidade (0040) deixou de respeitar "Mostrar no site". Produtos soltos que viraram kit
-- (shampoo, condicionador e máscara) e os escondidos pelo gerente voltam a ficar fora do site.
create or replace function app.vitrine_publica_unidade(p_deposito uuid)
returns table (produto_id uuid, codigo text, nome text, marca text, tipo text, foto text, tem_estoque boolean, novidade boolean, unidades_caixa int)
language sql stable security definer set search_path = app, pg_temp as $$
  select p.id, p.codigo, p.nome, p.marca, p.tipo, p.foto,
         app.saldo_disponivel(d.id, p.id) > 0
           or (d.mostra_abastecedor and d.abastecido_por is not null and app.saldo_disponivel(d.abastecido_por, p.id) > 0),
         p.novidade, p.unidades_caixa
    from app.produtos p cross join app.depositos d
   where p.ativo and p.mostrar_no_site and d.id = p_deposito
   order by p.nome
$$;
