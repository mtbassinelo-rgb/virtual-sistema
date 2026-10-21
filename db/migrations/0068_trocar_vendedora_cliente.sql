-- Gerente ou dono troca a vendedora responsável pelo cliente.
-- Pedidos ainda em andamento (aguardando o cliente, aguardando aprovação, em separação) podem passar junto;
-- pedidos já enviados, entregues ou cancelados ficam com quem vendeu (histórico e comissão).
-- A troca fica registrada no histórico de atendimentos do cliente.
create or replace function app.trocar_vendedora_cliente(p_cliente uuid, p_vendedora uuid, p_pedidos_abertos boolean default true)
returns int language plpgsql security definer set search_path = app, pg_temp as $$
declare v_antiga uuid; v_nome_antiga text; v_nome_nova text; n int := 0;
begin
  if not coalesce(app.pode_gerir(), false) then
    raise exception 'Só gerente ou dono troca a vendedora do cliente.' using errcode = 'insufficient_privilege';
  end if;
  select vendedora_id into v_antiga from app.clientes where id = p_cliente and mesclado_em is null for update;
  if not found then raise exception 'Cliente não encontrado.'; end if;
  select nome into v_nome_nova from app.vendedoras where id = p_vendedora and ativo;
  if v_nome_nova is null then raise exception 'Escolha uma vendedora ativa.'; end if;
  if v_antiga = p_vendedora then return 0; end if;
  select nome into v_nome_antiga from app.vendedoras where id = v_antiga;
  update app.clientes set vendedora_id = p_vendedora where id = p_cliente;
  if coalesce(p_pedidos_abertos, true) then
    update app.pedidos set vendedora_id = p_vendedora
     where cliente_id = p_cliente and vendedora_id is distinct from p_vendedora
       and status_comercial in ('aguardando_cliente', 'aguardando_aprovacao', 'em_separacao');
    get diagnostics n = row_count;
  end if;
  insert into app.atendimentos (cliente_id, tipo, nota, usuario_id)
  values (p_cliente, 'observacao',
          'Vendedora trocada: ' || coalesce(v_nome_antiga, '—') || ' → ' || v_nome_nova
          || case when n > 0 then ' (' || n || ' pedido(s) em andamento passaram junto)' else '' end, app.uid());
  return n;
end $$;
revoke execute on function app.trocar_vendedora_cliente(uuid, uuid, boolean) from public;
grant execute on function app.trocar_vendedora_cliente(uuid, uuid, boolean) to vc_app;
