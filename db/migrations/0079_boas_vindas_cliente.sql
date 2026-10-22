-- Mensagem de boas-vindas na primeira vez que o cliente entra na loja (aparece uma vez só).
alter table app.clientes add column boas_vindas_em timestamptz;
-- quem já entrou antes não precisa ver
update app.clientes c set boas_vindas_em = now()
 where exists (select 1 from app.pedidos p where p.cliente_id = c.id and p.origem = 'portal');

create or replace function app.portal_boas_vindas(p_sessao_hash text) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select boas_vindas_em is null from app.clientes where id = app.portal_cliente_id(p_sessao_hash)
$$;
create or replace function app.portal_marcar_boas_vindas(p_sessao_hash text) returns void
language sql security definer set search_path = app, pg_temp as $$
  update app.clientes set boas_vindas_em = now() where id = app.portal_cliente_id(p_sessao_hash) and boas_vindas_em is null
$$;
revoke execute on function app.portal_boas_vindas(text), app.portal_marcar_boas_vindas(text) from public;
grant execute on function app.portal_boas_vindas(text), app.portal_marcar_boas_vindas(text) to vc_app;
