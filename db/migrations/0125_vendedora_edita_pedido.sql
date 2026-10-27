-- A vendedora ajusta o pedido sozinha antes da separação (sem o gerente): muda quantidades,
-- tira itens e acrescenta produtos. Depois ela mesma manda para a separação (decidir_pedido_portal já permite).
-- p_itens: [{"item_id": "...", "quantidade": 24}]  (0 tira o item)
--          [{"produto_id": "...", "quantidade": 12}] (acrescenta com o preço da tabela do cliente)
create or replace function app.editar_itens_pedido(p_pedido uuid, p_itens jsonb) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; r jsonb; it app.pedido_itens; v_prod app.produtos; f record; v_q numeric; n int := 0;
begin
  v_ped := app._pedido_editavel_itens(p_pedido);
  if not (app.pode_escrever() and app.ve_pedido(v_ped.vendedora_id)) then
    raise exception 'Só a vendedora do pedido ou a gerência muda os itens.' using errcode = 'insufficient_privilege';
  end if;
  if v_ped.status_comercial::text not in ('aguardando_cliente', 'aguardando_aprovacao') then
    raise exception 'Depois que foi para a separação, use Trocar ou peça para tirar o item.';
  end if;
  if jsonb_typeof(p_itens) <> 'array' then raise exception 'Lista de itens inválida.'; end if;
  perform set_config('app.motivo', 'Vendedora ajustou o pedido', true);
  for r in select * from jsonb_array_elements(p_itens) loop
    v_q := round(coalesce((r->>'quantidade')::numeric, 0), 3);
    if v_q < 0 then raise exception 'Quantidade inválida.'; end if;
    if r ? 'item_id' then
      select * into it from app.pedido_itens where id = (r->>'item_id')::uuid and pedido_id = p_pedido;
      if it.id is null then raise exception 'Item não encontrado neste pedido.'; end if;
      if v_q = 0 then
        delete from app.pedido_itens where id = it.id; n := n + 1;
      elsif v_q <> it.quantidade then
        update app.pedido_itens set quantidade = v_q, quantidade_pedida = v_q where id = it.id; n := n + 1;
      end if;
    elsif r ? 'produto_id' then
      continue when v_q = 0;
      select * into v_prod from app.produtos where id = (r->>'produto_id')::uuid;
      if v_prod.id is null or not v_prod.ativo then raise exception 'Produto não encontrado ou inativo.'; end if;
      select * into it from app.pedido_itens where pedido_id = p_pedido and produto_id = v_prod.id
        and deposito_origem_id is not distinct from v_ped.deposito_id limit 1;
      if it.id is not null then
        update app.pedido_itens set quantidade = it.quantidade + v_q, quantidade_pedida = it.quantidade + v_q where id = it.id;
      else
        select * into f from app.preco_final_moeda(v_ped.cliente_id, v_prod.id, v_ped.moeda);
        if f.preco is null then raise exception 'O produto % não tem preço na tabela deste cliente.', v_prod.nome; end if;
        insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, quantidade_pedida, preco_unitario, tabela_preco, deposito_origem_id)
        values (p_pedido, v_prod.id, v_prod.codigo, v_prod.nome, v_q, v_q, f.preco, f.tabela, v_ped.deposito_id);
      end if;
      n := n + 1;
    end if;
  end loop;
  if not exists (select 1 from app.pedido_itens where pedido_id = p_pedido) then
    raise exception 'O pedido ficaria sem itens. Para desistir, recuse o pedido.';
  end if;
  perform app._recalcular_total_pedido(p_pedido);
  return n;
end $$;
grant execute on function app.editar_itens_pedido(uuid, jsonb) to vc_app;
