-- Venda por unidade (sortido) no CD Foz vale só para clientes do Brasil (em reais), quando a vendedora libera.
-- Cliente do Paraguai comprando do CD Foz: sempre caixa fechada. Unidades que vendem por unidade (loja de CDE) continuam valendo.
create or replace function app.portal_compra_unidade(p_sessao_hash text) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce((select coalesce(d.vende_unidade, false) or (c.compra_unidade and c.pais = 'BR')
                     from app.clientes c left join app.depositos d on d.id = app.deposito_do_cliente(c.id)
                    where c.id = app.portal_cliente_id(p_sessao_hash)), false)
$$;
update app.clientes set compra_unidade = false where compra_unidade and pais <> 'BR';
