-- Acompanhamento do pedido para o cliente e a equipe:
-- recebido → expedição separa (o que faltar fica registrado) → pagamento → em transporte → aguardando retirada → retirado.
create or replace function app.conferir_separacao(p_pedido uuid, p_itens jsonb default '[]')
returns numeric language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; it record; v_q numeric; v_total numeric;
begin
  select * into v_ped from app.pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if not (app.pode_gerir() or app.pode_operar_deposito(v_ped.deposito_id)) then
    raise exception 'Só a expedição do depósito ou a gerência confere a separação.' using errcode = 'insufficient_privilege';
  end if;
  if v_ped.status_comercial <> 'em_separacao' then raise exception 'O pedido precisa estar em separação.'; end if;
  if v_ped.total_confirmado_em is not null then raise exception 'O total já foi confirmado ao cliente.'; end if;
  if v_ped.origem = 'bling' then raise exception 'Pedidos do Bling são conferidos no Bling.'; end if;
  for it in select * from app.pedido_itens where pedido_id = p_pedido loop
    select (r->>'quantidade')::numeric into v_q from jsonb_array_elements(coalesce(p_itens, '[]')) r where (r->>'item_id')::uuid = it.id;
    v_q := coalesce(v_q, it.quantidade_pedida);
    if v_q < 0 or v_q > it.quantidade_pedida then
      raise exception 'Quantidade separada de % deve ficar entre 0 e %.', it.descricao, it.quantidade_pedida;
    end if;
    if v_q < it.quantidade_pedida then
      -- o que faltou fica registrado: o cliente vê no acompanhamento que não estava disponível
      delete from app.pedido_itens_indisponiveis where pedido_id = p_pedido and descricao = it.descricao;
      insert into app.pedido_itens_indisponiveis (pedido_id, produto_id, descricao, quantidade_pedida, quantidade_faltou, registrado_por)
      values (p_pedido, it.produto_id, it.descricao, it.quantidade_pedida, it.quantidade_pedida - v_q, app.uid());
    end if;
    if v_q = 0 then delete from app.pedido_itens where id = it.id;
    elsif v_q <> it.quantidade then update app.pedido_itens set quantidade = v_q where id = it.id;
    end if;
  end loop;
  select coalesce(sum(total), 0) into v_total from app.pedido_itens where pedido_id = p_pedido;
  update app.pedidos set valor_total = v_total, separacao_conferida_em = now(), separacao_conferida_por = app.uid()
   where id = p_pedido;
  return v_total;
end $$;

drop function app.portal_pedidos(text);
create function app.portal_pedidos(p_sessao_hash text)
returns table (id uuid, data_pedido date, bling_numero bigint, valor_total numeric, recebido numeric, a_conferir numeric,
               saldo numeric, moeda app.moeda, status_comercial app.status_comercial, status_pagamento text,
               etapa text, total_confirmado boolean, conta_pagamento text,
               previsao_envio date, vencimento date, observacoes text, itens jsonb,
               separado_em timestamptz, enviado_em date, chegou_em timestamptz, entregue_em date, local_retirada text, indisponiveis jsonb)
language sql stable security definer set search_path = app, pg_temp as $$
  select v.id, v.data_pedido, v.bling_numero, v.valor_total, v.recebido, v.a_conferir, v.saldo, v.moeda, v.status_comercial,
         v.status_pagamento,
         case
           when v.status_comercial = 'cancelado' then 'cancelado'
           when v.status_comercial = 'aguardando_aprovacao' then 'aguardando_vendedora'
           when v.status_comercial::text in ('enviado','aguardando_retirada','entregue') then v.status_comercial::text
           when p.total_confirmado_em is null then 'em_separacao'
           when v.saldo > 0 then 'aguardando_pagamento'
           else 'pago_preparando_envio'
         end,
         p.total_confirmado_em is not null,
         case when p.total_confirmado_em is not null then p.conta_pagamento end,
         v.previsao_envio, v.vencimento, v.observacoes,
         coalesce((select jsonb_agg(jsonb_build_object('descricao', i.descricao, 'quantidade', i.quantidade,
                                                       'pedida', i.quantidade_pedida, 'preco', i.preco_unitario, 'total', i.total)
                                    order by i.descricao)
                     from app.pedido_itens i where i.pedido_id = v.id), '[]'),
         p.separacao_conferida_em, p.enviado_em, p.chegou_em, p.entregue_em, p.local_retirada,
         coalesce((select jsonb_agg(jsonb_build_object('descricao', x.descricao, 'pedida', x.quantidade_pedida, 'faltou', x.quantidade_faltou)
                                    order by x.descricao)
                     from app.pedido_itens_indisponiveis x where x.pedido_id = v.id), '[]')
    from app.v_pedidos v join app.pedidos p on p.id = v.id
   where v.cliente_id = app.portal_cliente_id(p_sessao_hash)
   order by v.data_pedido desc, v.criado_em desc
   limit 100
$$;
grant execute on function app.portal_pedidos(text) to vc_app;

-- Expedição/vendedora avança a entrega: 'transporte' (saiu), 'retirada' (chegou ao local de destino), 'entregue' (cliente retirou).
create or replace function app.avancar_entrega(p_pedido uuid, p_etapa text, p_local text default null) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos;
begin
  select * into v_ped from app.pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if not ((app.pode_escrever() and app.ve_pedido(v_ped.vendedora_id)) or app.pode_operar_deposito(v_ped.deposito_id)) then
    raise exception 'Sem permissão para mudar a entrega deste pedido.' using errcode = 'insufficient_privilege';
  end if;
  if v_ped.status_comercial::text in ('cancelado', 'aguardando_aprovacao') then raise exception 'Este pedido não está liberado para entrega.'; end if;
  if v_ped.origem <> 'bling' and v_ped.separacao_conferida_em is null then
    raise exception 'A expedição precisa conferir a separação antes de despachar.';
  end if;
  perform set_config('app.motivo', 'Acompanhamento da entrega: ' || p_etapa, true);
  if p_etapa = 'transporte' then
    update app.pedidos set status_comercial = 'enviado', enviado_em = coalesce(enviado_em, current_date) where id = p_pedido;
  elsif p_etapa = 'retirada' then
    if coalesce(trim(p_local), '') = '' then raise exception 'Informe onde o cliente retira o pedido.'; end if;
    update app.pedidos set status_comercial = 'aguardando_retirada', chegou_em = now(), local_retirada = left(trim(p_local), 200),
           enviado_em = coalesce(enviado_em, current_date) where id = p_pedido;
  elsif p_etapa = 'entregue' then
    update app.pedidos set status_comercial = 'entregue', entregue_em = current_date, enviado_em = coalesce(enviado_em, current_date) where id = p_pedido;
  else
    raise exception 'Etapa inválida.';
  end if;
end $$;
grant execute on function app.avancar_entrega(uuid, text, text) to vc_app;

-- Saída de estoque do pedido: sai quando o pedido deixa a separação para qualquer etapa de entrega
-- (em transporte, aguardando retirada ou entregue); volta se for cancelado depois disso.
create or replace function app.estoque_do_pedido() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare it record;
begin
  if new.deposito_id is null or new.origem = 'bling' then return new; end if;
  if new.status_comercial::text in ('enviado','aguardando_retirada','entregue')
     and old.status_comercial::text in ('em_separacao','aguardando_aprovacao') then
    for it in select c.produto_id, sum(c.quantidade) q
                from app.pedido_itens i cross join lateral app.componentes(i.produto_id, i.quantidade) c
               where i.pedido_id = new.id and i.produto_id is not null group by 1 loop
      perform app._lancar(new.deposito_id, it.produto_id, 'saida_venda', it.q, 'pedido', new.id::text, null);
    end loop;
  elsif new.status_comercial::text = 'cancelado' and old.status_comercial::text in ('enviado','aguardando_retirada','entregue') then
    for it in select c.produto_id, sum(c.quantidade) q
                from app.pedido_itens i cross join lateral app.componentes(i.produto_id, i.quantidade) c
               where i.pedido_id = new.id and i.produto_id is not null group by 1 loop
      perform app._lancar(new.deposito_id, it.produto_id, 'devolucao_cliente', it.q, 'pedido', new.id::text, 'Pedido cancelado após envio');
    end loop;
  end if;
  return new;
end $$;
