-- =====================================================================
-- Migração 0134: pedido de mercadoria que sai de uma LOJA (ex.: CDE → CD Principal)
--
-- Quem trabalha na loja (ex.: Yessica na CDE) vê o pedido no painel dela, separa e dá o ✓:
-- a mercadoria já sai do estoque da loja e fica a caminho do destino (sem esperar outra aprovação).
-- Para pedidos que saem de um CD, continua o fluxo do estoquista (separar → aprovar → enviar).
-- =====================================================================

create or replace function app.pode_separar_transferencia(p_origem uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select app.pode_operar_deposito(p_origem)
      or ((select tipo from app.depositos where id = p_origem) = 'loja' and app.trabalha_na_unidade(p_origem))
$$;
grant execute on function app.pode_separar_transferencia(uuid) to vc_app;

-- Separa e já envia (sai do estoque de origem). Só para origem do tipo loja.
create or replace function app.separar_e_enviar_transferencia(p_id uuid, p_itens jsonb) returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare t app.transferencias; it record; v_q numeric; v_tem int := 0; v_falta int := 0;
begin
  select * into t from app.transferencias where id = p_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if (select tipo from app.depositos where id = t.origem_id) <> 'loja' then
    raise exception 'Pedidos que saem do CD seguem separar e aprovar.';
  end if;
  if not app.pode_separar_transferencia(t.origem_id) then
    raise exception 'Só quem trabalha na unidade de origem separa.' using errcode = 'insufficient_privilege';
  end if;
  if t.status <> 'solicitada' then raise exception 'Esta solicitação já foi separada, enviada ou cancelada.'; end if;
  for it in select * from app.transferencia_itens where transferencia_id = p_id loop
    select (r->>'quantidade')::numeric into v_q from jsonb_array_elements(coalesce(p_itens, '[]')) r where (r->>'produto_id')::uuid = it.produto_id;
    v_q := greatest(coalesce(v_q, it.quantidade_enviada), 0);
    if v_q > app.saldo_disponivel(t.origem_id, it.produto_id) then
      raise exception 'Não há % de % no estoque (tem %).', v_q, (select nome from app.produtos where id = it.produto_id),
        app.saldo_disponivel(t.origem_id, it.produto_id);
    end if;
    update app.transferencia_itens set quantidade_enviada = v_q where transferencia_id = p_id and produto_id = it.produto_id;
    if v_q > 0 then v_tem := v_tem + 1; else v_falta := v_falta + 1; end if;
  end loop;
  if v_tem = 0 then raise exception 'Nenhum produto separado. Se não tem nada, cancele o pedido.'; end if;
  update app.transferencias set status = 'separada', separada_por = app.uid(), separada_em = now() where id = p_id;
  select * into t from app.transferencias where id = p_id;
  perform app._despachar_transferencia(t);
  return jsonb_build_object('tem', v_tem, 'falta', v_falta);
end $$;
grant execute on function app.separar_e_enviar_transferencia(uuid, jsonb) to vc_app;
