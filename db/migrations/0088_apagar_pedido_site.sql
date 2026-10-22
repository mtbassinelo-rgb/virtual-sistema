-- Pedidos do site feitos só para testar (vendedoras simulando): gerente/dono apaga da lista.
create or replace function app.apagar_pedidos_site(p_ids uuid[]) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare n int;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono apaga pedidos do site.' using errcode = 'insufficient_privilege'; end if;
  delete from app.pedidos_site where id = any(coalesce(p_ids, '{}'));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function app.apagar_pedidos_site(uuid[]) from public;
grant execute on function app.apagar_pedidos_site(uuid[]) to vc_app;
