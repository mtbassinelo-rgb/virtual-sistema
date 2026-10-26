-- Pedido entre unidades: a vendedora também pode pedir PARA a outra unidade a partir da unidade em que trabalha.
create or replace function app.solicitar_transferencia(p_origem uuid, p_destino uuid, p_itens jsonb, p_obs text default null, p_pedido uuid default null)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id uuid; i jsonb; v_q numeric; n int := 0;
begin
  -- quem trabalha na unidade que recebe OU na que envia pode pedir (ex.: vendedora do CD Foz pedindo para a loja CDE)
  if not (app.trabalha_na_unidade(p_destino) or app.trabalha_na_unidade(p_origem)) then
    raise exception 'Você não trabalha em nenhuma das duas unidades.' using errcode = 'insufficient_privilege';
  end if;
  if p_origem = p_destino then raise exception 'Escolha unidades diferentes.'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Coloque pelo menos um produto.'; end if;
  insert into app.transferencias (origem_id, destino_id, status, observacao, criada_por, pedido_origem_id)
  values (p_origem, p_destino, 'solicitada', nullif(left(trim(coalesce(p_obs, '')), 500), ''), app.uid(), p_pedido)
  returning id into v_id;
  for i in select * from jsonb_array_elements(p_itens) loop
    v_q := (i->>'quantidade')::numeric;
    continue when v_q is null or v_q <= 0;
    insert into app.transferencia_itens (transferencia_id, produto_id, quantidade_solicitada, quantidade_enviada)
    values (v_id, (i->>'produto_id')::uuid, v_q, v_q)
    on conflict (transferencia_id, produto_id) do update
      set quantidade_solicitada = app.transferencia_itens.quantidade_solicitada + excluded.quantidade_solicitada,
          quantidade_enviada = app.transferencia_itens.quantidade_enviada + excluded.quantidade_enviada;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Coloque pelo menos um produto com quantidade.'; end if;
  return v_id;
end $$;
