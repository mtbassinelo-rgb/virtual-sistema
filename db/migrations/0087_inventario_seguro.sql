-- =====================================================================
-- Inventário mais seguro: a diferença é calculada sobre o saldo que estava no sistema quando a lista foi aberta
-- ("base"). Se houve venda ou transferência enquanto contavam, ela não é desfeita pelo inventário.
-- Sem "base" (chamadas antigas), funciona como antes: o saldo fica igual ao contado.
-- =====================================================================
create or replace function app.registrar_inventario(p_deposito uuid, p_linhas jsonb) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare r jsonb; v_prod app.produtos; v_cont numeric; v_atual numeric; v_base numeric; v_dif numeric; n int := 0;
begin
  if not app.pode_operar_deposito(p_deposito) then
    raise exception 'Só gerente, dono ou responsável pela unidade registra inventário.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_array_length(coalesce(p_linhas, '[]')) > 3000 then raise exception 'No máximo 3000 produtos por vez.'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_linhas, '[]')) loop
    v_cont := nullif(r->>'contado', '')::numeric;
    continue when v_cont is null;
    if v_cont < 0 then raise exception 'Quantidade contada não pode ser negativa.'; end if;
    select * into v_prod from app.produtos where id = (r->>'produto_id')::uuid;
    continue when v_prod.id is null or v_prod.tipo = 'kit';
    select quantidade into v_atual from app.estoque_saldos where deposito_id = p_deposito and produto_id = v_prod.id for update;
    v_atual := coalesce(v_atual, 0);
    v_base := coalesce(nullif(r->>'base', '')::numeric, v_atual);
    v_dif := v_cont - v_base;
    -- nunca deixa negativo (ex.: saiu mais do que foi contado enquanto contavam)
    if v_atual + v_dif < 0 then v_dif := -v_atual; end if;
    if v_dif > 0 then perform app._lancar(p_deposito, v_prod.id, 'ajuste_entrada', v_dif, 'inventario', null, 'Inventário (contagem)');
    elsif v_dif < 0 then perform app._lancar(p_deposito, v_prod.id, 'ajuste_saida', -v_dif, 'inventario', null, 'Inventário (contagem)');
    end if;
    if v_dif <> 0 then n := n + 1; end if;
  end loop;
  return n;
end $$;
grant execute on function app.registrar_inventario(uuid, jsonb) to vc_app;
