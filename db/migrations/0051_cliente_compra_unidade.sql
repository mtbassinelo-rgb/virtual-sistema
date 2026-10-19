-- Cliente que pode comprar por unidade no site (a vendedora libera na ficha). Sem isso, produtos com caixa
-- são vendidos só em caixa fechada (exceto nas unidades que já vendem por unidade, como a loja de CDE).
alter table app.clientes add column compra_unidade boolean not null default false;

create or replace function app.portal_compra_unidade(p_sessao_hash text) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce((select c.compra_unidade or coalesce(d.vende_unidade, false)
                     from app.clientes c left join app.depositos d on d.id = app.deposito_do_cliente(c.id)
                    where c.id = app.portal_cliente_id(p_sessao_hash)), false)
$$;
grant execute on function app.portal_compra_unidade(text) to vc_app;
