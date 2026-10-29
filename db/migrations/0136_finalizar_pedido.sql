-- =====================================================================
-- Migração 0136: gerente finaliza o pedido em um passo
--
-- Processo simples: a vendedora cria o pedido → a expedição separa → a vendedora informa o pagamento
-- (comprovante ou detalhes) → o gerente FINALIZA. Finalizar confirma os pagamentos informados (opcional),
-- marca o total como fechado e o pedido como entregue (o estoque sai, se ainda não saiu).
-- =====================================================================

create or replace function app.finalizar_pedido(p_pedido uuid, p_confirmar_pagamentos boolean default true) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; g record;
begin
  if not coalesce(app.pode_gerir(), false) then
    raise exception 'Só o gerente ou o dono finaliza o pedido.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_ped from app.pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if v_ped.status_comercial::text in ('cancelado', 'entregue') then raise exception 'Este pedido já está % .', v_ped.status_comercial; end if;
  if v_ped.status_comercial::text in ('aguardando_cliente', 'aguardando_aprovacao') then
    raise exception 'O pedido ainda não foi para a separação.';
  end if;
  if v_ped.origem <> 'bling' and v_ped.separacao_conferida_em is null then
    raise exception 'A expedição precisa separar o pedido antes de finalizar.';
  end if;
  perform set_config('app.motivo', 'Pedido finalizado pelo gerente', true);
  if p_confirmar_pagamentos then
    for g in select id from app.pagamentos where pedido_id = p_pedido and status_conferencia = 'pendente' loop
      perform app.conferir_pagamento(g.id, v_ped.bling_numero);
    end loop;
  end if;
  update app.pedidos
     set total_confirmado_em = coalesce(total_confirmado_em, now()), total_confirmado_por = coalesce(total_confirmado_por, app.uid()),
         status_comercial = 'entregue', entregue_em = coalesce(entregue_em, current_date), enviado_em = coalesce(enviado_em, current_date)
   where id = p_pedido;
end $$;
grant execute on function app.finalizar_pedido(uuid, boolean) to vc_app;
