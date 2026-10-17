-- Produtos vendidos só dentro de kits (ex.: shampoo, condicionador e máscara Maycrene) ficam inativos
-- para não aparecer soltos na loja, mas o estoque é deles. Eles continuam na tela de Estoque enquanto
-- forem componentes de algum kit ativo.
create or replace view app.v_estoque with (security_invoker = true) as
select d.id as deposito_id, d.nome as deposito, p.id as produto_id, p.codigo, p.nome as produto,
       coalesce(s.quantidade, 0) as saldo,
       coalesce((select sum(ti.quantidade_enviada) from app.transferencia_itens ti
                   join app.transferencias t on t.id = ti.transferencia_id
                  where t.status = 'enviada' and t.destino_id = d.id and ti.produto_id = p.id), 0) as a_receber
  from app.depositos d cross join app.produtos p
  left join app.estoque_saldos s on s.deposito_id = d.id and s.produto_id = p.id
 where d.ativo and (p.ativo or exists (select 1 from app.kit_componentes k join app.produtos kp on kp.id = k.kit_id
                                       where k.componente_id = p.id and kp.ativo));
