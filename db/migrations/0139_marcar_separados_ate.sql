-- =====================================================================
-- Gerência: marcar de uma vez como "separados" os pedidos da fila de separação até uma data
-- (pedidos antigos que já saíram fisicamente). Separado = tudo o que foi pedido, sem mexer em itens,
-- total nem estoque; caixas ficam em branco. Fica registrado quem marcou.
-- =====================================================================
create or replace function app.marcar_separados_ate(p_ate date, p_deposito uuid default null) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare p record; n int := 0;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono marca pedidos em lote.' using errcode = 'insufficient_privilege'; end if;
  if p_ate is null or p_ate > current_date then raise exception 'Data inválida.'; end if;
  for p in select id from app.pedidos
            where status_comercial = 'em_separacao' and origem <> 'bling' and separacao_conferida_em is null
              and data_pedido <= p_ate and (p_deposito is null or deposito_id = p_deposito)
            for update loop
    insert into app.pedido_separacao (pedido_id, item_id, produto_id, descricao, pedida, separada, por)
    select i.pedido_id, i.id, i.produto_id, i.descricao, i.quantidade, i.quantidade, app.uid()
      from app.pedido_itens i where i.pedido_id = p.id
    on conflict (pedido_id, item_id) do update set separada = excluded.separada, pedida = excluded.pedida, em = now(), por = excluded.por;
    update app.pedidos set separacao_conferida_em = now(), separacao_conferida_por = app.uid() where id = p.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function app.marcar_separados_ate(date, uuid) from public;
grant execute on function app.marcar_separados_ate(date, uuid) to vc_app;
