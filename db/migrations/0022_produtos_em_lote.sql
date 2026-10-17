-- Ações em lote na lista de Produtos (só gerente e dono): ativar, inativar ou excluir.
-- Excluir só apaga de verdade o produto que nunca teve movimento (pedido, estoque, transferência,
-- pendência ou parte de kit). Os que têm histórico são inativados, para não quebrar pedidos e relatórios.
create or replace function app.produtos_em_lote(p_ids uuid[], p_acao text) returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_id uuid; v_foto text; v_fotos text[] := '{}';
  n_ativ int := 0; n_inat int := 0; n_excl int := 0; n_hist int := 0;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono altera produtos em lote.' using errcode = 'insufficient_privilege';
  end if;
  if p_acao not in ('ativar','inativar','excluir') then raise exception 'Ação inválida.'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Selecione pelo menos um produto.'; end if;
  if array_length(p_ids, 1) > 500 then raise exception 'Selecione no máximo 500 produtos por vez.'; end if;

  if p_acao = 'ativar' then
    update app.produtos set ativo = true where id = any(p_ids) and not ativo;
    get diagnostics n_ativ = row_count;
  elsif p_acao = 'inativar' then
    update app.produtos set ativo = false where id = any(p_ids) and ativo;
    get diagnostics n_inat = row_count;
  else
    foreach v_id in array p_ids loop
      continue when not exists (select 1 from app.produtos where id = v_id);
      if exists (select 1 from app.pedido_itens where produto_id = v_id)
         or exists (select 1 from app.estoque_movimentos where produto_id = v_id)
         or exists (select 1 from app.transferencia_itens where produto_id = v_id)
         or exists (select 1 from app.estoque_pendencias where produto_id = v_id)
         or exists (select 1 from app.kit_componentes where componente_id = v_id)
         or exists (select 1 from app.estoque_saldos where produto_id = v_id and quantidade <> 0) then
        update app.produtos set ativo = false where id = v_id;
        n_hist := n_hist + 1;
      else
        select foto into v_foto from app.produtos where id = v_id;
        if v_foto is not null then v_fotos := v_fotos || v_foto; end if;
        delete from app.kit_componentes where kit_id = v_id;
        delete from app.precos where produto_id = v_id;
        delete from app.promocoes where produto_id = v_id;
        delete from app.produto_codigos where produto_id = v_id;
        delete from app.estoque_saldos where produto_id = v_id;
        delete from app.produtos where id = v_id;
        n_excl := n_excl + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('ativados', n_ativ, 'inativados', n_inat, 'excluidos', n_excl,
                            'inativados_por_historico', n_hist, 'fotos', to_jsonb(v_fotos));
end $$;
grant execute on function app.produtos_em_lote(uuid[], text) to vc_app;
