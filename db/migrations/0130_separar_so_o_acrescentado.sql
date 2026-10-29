-- =====================================================================
-- Migração 0130: pedido reaberto na separação → o estoquista separa só o que foi acrescentado
--
-- A vendedora aumentou ou acrescentou produto depois da separação conferida: o pedido volta para a área
-- do estoquista, mas a tela mostra só a diferença (o que já foi separado fica guardado). Ele separa essa
-- parte, informa as caixas a mais e o sistema junta tudo: quantidade separada total e caixas totais.
-- =====================================================================

create or replace function app.editar_itens_pedido(p_pedido uuid, p_itens jsonb) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; r jsonb; it app.pedido_itens; v_prod app.produtos; f record; v_q numeric; n int := 0;
        v_sep boolean; v_aumentou boolean := false;
begin
  v_ped := app._pedido_editavel_itens(p_pedido);
  if not (app.pode_escrever() and app.ve_pedido(v_ped.vendedora_id)) then
    raise exception 'Só a vendedora do pedido ou a gerência muda os itens.' using errcode = 'insufficient_privilege';
  end if;
  v_sep := v_ped.status_comercial::text = 'em_separacao';
  if v_sep and not (coalesce(app.pode_gerir(), false) or coalesce(app.param('vendedora_ajusta_separacao'), 0) = 1) then
    raise exception 'Depois que foi para a separação, use Trocar ou peça para tirar o item.';
  end if;
  if not v_sep and v_ped.status_comercial::text not in ('aguardando_cliente', 'aguardando_aprovacao') then
    raise exception 'Depois que foi para a separação, use Trocar ou peça para tirar o item.';
  end if;
  if jsonb_typeof(p_itens) <> 'array' then raise exception 'Lista de itens inválida.'; end if;
  perform set_config('app.motivo', case when v_sep then 'Vendedora ajustou o pedido na separação' else 'Vendedora ajustou o pedido' end, true);
  for r in select * from jsonb_array_elements(p_itens) loop
    v_q := round(coalesce((r->>'quantidade')::numeric, 0), 3);
    if v_q < 0 then raise exception 'Quantidade inválida.'; end if;
    if r ? 'item_id' then
      select * into it from app.pedido_itens where id = (r->>'item_id')::uuid and pedido_id = p_pedido;
      if it.id is null then raise exception 'Item não encontrado neste pedido.'; end if;
      if v_q > it.quantidade then v_aumentou := true; end if;
      if v_q = 0 then
        delete from app.pedido_itens where id = it.id; n := n + 1;
      elsif v_q <> it.quantidade then
        -- o cliente pediu menos: a quantidade pedida acompanha (não aparece como "faltou")
        update app.pedido_itens set quantidade = v_q, quantidade_pedida = v_q where id = it.id; n := n + 1;
      end if;
    elsif r ? 'produto_id' then
      continue when v_q = 0;
      v_aumentou := true;
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
  -- aumentou ou acrescentou depois da expedição conferir: volta para o estoquista separar SÓ o que foi acrescentado
  -- (o que ele já separou fica guardado em pedido_separacao e soma no final)
  if v_sep and v_aumentou and v_ped.separacao_conferida_em is not null then
    update app.pedidos set separacao_conferida_em = null, separacao_conferida_por = null where id = p_pedido;
  end if;
  perform app._recalcular_total_pedido(p_pedido);
  return n;
end $$;
grant execute on function app.editar_itens_pedido(uuid, jsonb) to vc_app;

-- p_itens: [{"item_id": "...", "quantidade": 12}] = quanto separou AGORA de cada item que ainda tem algo a separar.
-- Itens que já estavam totalmente separados não precisam vir. p_caixas = caixas separadas agora (somam às anteriores).
create or replace function app.confirmar_separacao_estoque(p_pedido uuid, p_itens jsonb, p_caixas int) returns numeric
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; it record; v_q numeric; v_ja numeric; v_falta numeric; v_total numeric; v_sep numeric := 0;
        v_totais jsonb := '[]'; v_reaberto boolean;
begin
  select * into v_ped from app.pedidos where id = p_pedido;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if not (app.pode_gerir() or app.pode_operar_deposito(v_ped.deposito_id)) then
    raise exception 'Só a expedição do depósito ou a gerência confere a separação.' using errcode = 'insufficient_privilege';
  end if;
  if v_ped.separacao_conferida_em is not null then raise exception 'Este pedido já foi conferido.'; end if;
  if jsonb_typeof(p_itens) <> 'array' then raise exception 'Itens inválidos.'; end if;
  v_reaberto := exists (select 1 from app.pedido_separacao where pedido_id = p_pedido);

  for it in select * from app.pedido_itens where pedido_id = p_pedido loop
    v_ja := coalesce((select least(s.separada, it.quantidade) from app.pedido_separacao s where s.pedido_id = p_pedido and s.item_id = it.id), 0);
    v_falta := it.quantidade - v_ja;
    select (r->>'quantidade')::numeric into v_q from jsonb_array_elements(p_itens) r where (r->>'item_id')::uuid = it.id;
    if v_falta <= 0 then
      v_q := 0;                                  -- já estava separado
    else
      if v_q is null then raise exception 'Confirme a quantidade separada de % (ou marque Não tem).', it.descricao; end if;
      if v_q < 0 or v_q > v_falta then
        raise exception 'Quantidade separada de % deve ficar entre 0 e % (o pedido não pode ser aumentado na separação).', it.descricao, v_falta;
      end if;
    end if;
    insert into app.pedido_separacao (pedido_id, item_id, produto_id, descricao, pedida, separada, por)
    values (p_pedido, it.id, it.produto_id, it.descricao, it.quantidade, v_ja + v_q, app.uid())
    on conflict (pedido_id, item_id) do update set separada = excluded.separada, pedida = excluded.pedida, em = now(), por = excluded.por;
    v_totais := v_totais || jsonb_build_object('item_id', it.id, 'quantidade', v_ja + v_q);
    v_sep := v_sep + v_q;
  end loop;
  if v_sep > 0 and coalesce(p_caixas, 0) <= 0 then raise exception 'Informe o total de caixas separadas.'; end if;
  if p_caixas is not null and (p_caixas < 0 or p_caixas > 10000) then raise exception 'Total de caixas inválido.'; end if;

  -- mesma regra de sempre: o que faltou vira "indisponível" (cliente e vendedora veem) e o total é recalculado
  v_total := app.conferir_separacao(p_pedido, v_totais);
  update app.pedidos
     set caixas_separadas = case when v_reaberto then coalesce(caixas_separadas, 0) + coalesce(p_caixas, 0) else p_caixas end,
         volumes = case when v_reaberto then coalesce(volumes, 0) + coalesce(p_caixas, 0) else coalesce(volumes, p_caixas) end
   where id = p_pedido;
  return v_total;
end $$;
grant execute on function app.confirmar_separacao_estoque(uuid, jsonb, int) to vc_app;
