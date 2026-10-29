-- =====================================================================
-- Migração 0136: pedido mais simples — o gerente finaliza (e o sistema finaliza sozinho quando está tudo certo)
--
-- Processo: a vendedora cria o pedido → a expedição separa → a vendedora informa o pagamento
-- (comprovante ou detalhes) → o gerente FINALIZA (um clique, na lista ou no pedido, um ou vários de uma vez).
--
-- Finalizar = fechar o pedido: confirma os pagamentos informados, fecha o total e marca como entregue.
-- Se ainda falta uma etapa da entrega (o passeiro levar, a loja CDE despachar pela transportadora ou o
-- cliente retirar na CDE), o pedido fica "finalizado" e vira entregue sozinho quando essa etapa termina.
--
-- Sozinho: pedido separado, já despachado (ou retirado), sem saldo e sem pagamento esperando conferência
-- → finaliza sem ninguém precisar clicar.
--
-- Também: desconto em valor num pedido que já existe (mesma regra do Novo pedido: até o preço VIP).
-- =====================================================================

alter table app.pedidos
  add column if not exists finalizado_em timestamptz,
  add column if not exists finalizado_por uuid references app.usuarios(id);

-- Falta alguma etapa física da entrega?
create or replace function app.entrega_pendente(p app.pedidos) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select (p.status_comercial::text = 'em_separacao' and p.entrega_tipo is not null and p.despachado_em is null)
      or app.envio_py_pendente(p)
      or (p.status_comercial::text = 'aguardando_retirada' and coalesce(p.local_retirada, p.entrega_meio) ilike '%CDE%')
$$;

-- Fecha o que dá para fechar: pedido finalizado sem etapa de entrega pendente → entregue;
-- pedido separado, pago, conferido e já despachado → finalizado sozinho.
create or replace function app.fechar_se_pronto(p_pedido uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v app.pedidos; v_saldo numeric; v_pend int;
begin
  select * into v from app.pedidos where id = p_pedido;
  if v.id is null or v.status_comercial::text in ('cancelado', 'entregue') or v.origem = 'bling' then return; end if;
  if v.finalizado_em is null then
    if v.separacao_conferida_em is null or v.status_comercial::text not in ('em_separacao', 'enviado', 'aguardando_retirada') then return; end if;
    if v.status_comercial::text = 'em_separacao' and v.despachado_em is null then return; end if;
    select vp.saldo into v_saldo from app.v_pedidos vp where vp.id = p_pedido;
    select count(*) into v_pend from app.pagamentos where pedido_id = p_pedido and status_conferencia = 'pendente';
    if coalesce(v_saldo, 1) > 0 or v_pend > 0 then return; end if;
    update app.pedidos set finalizado_em = now(), total_confirmado_em = coalesce(total_confirmado_em, now())
     where id = p_pedido returning * into v;
  end if;
  if not app.entrega_pendente(v) then
    perform set_config('app.motivo', 'Pedido finalizado', true);
    update app.pedidos set status_comercial = 'entregue', entregue_em = coalesce(entregue_em, current_date),
                           enviado_em = coalesce(enviado_em, current_date)
     where id = p_pedido;
  end if;
end $$;
revoke execute on function app.fechar_se_pronto(uuid) from public;

create or replace function app._tg_pedido_fechar() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if tg_table_name = 'pagamentos' then
    perform app.fechar_se_pronto(new.pedido_id);
  else
    perform app.fechar_se_pronto(new.id);
  end if;
  return null;
end $$;

drop trigger if exists pedido_fechar on app.pedidos;
create trigger pedido_fechar after update on app.pedidos
  for each row when (pg_trigger_depth() < 1 and new.status_comercial::text in ('em_separacao', 'enviado', 'aguardando_retirada'))
  execute function app._tg_pedido_fechar();
drop trigger if exists pagamento_fechar on app.pagamentos;
create trigger pagamento_fechar after insert or update on app.pagamentos
  for each row when (pg_trigger_depth() < 1) execute function app._tg_pedido_fechar();

-- O gerente finaliza (pode ser chamado para vários pedidos seguidos). Devolve o que aconteceu.
drop function if exists app.finalizar_pedido(uuid, boolean);
create or replace function app.finalizar_pedido(p_pedido uuid, p_confirmar_pagamentos boolean default true) returns text
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; g record;
begin
  if not coalesce(app.pode_gerir(), false) then
    raise exception 'Só o gerente ou o dono finaliza o pedido.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_ped from app.pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if v_ped.status_comercial::text in ('cancelado', 'entregue') then raise exception 'Este pedido já está %.', v_ped.status_comercial; end if;
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
         finalizado_em = coalesce(finalizado_em, now()), finalizado_por = coalesce(finalizado_por, app.uid())
   where id = p_pedido returning * into v_ped;
  if app.entrega_pendente(v_ped) then
    return 'pendente_entrega';
  end if;
  update app.pedidos set status_comercial = 'entregue', entregue_em = coalesce(entregue_em, current_date), enviado_em = coalesce(enviado_em, current_date)
   where id = p_pedido;
  return 'entregue';
end $$;
grant execute on function app.finalizar_pedido(uuid, boolean) to vc_app;

-- Desconto em valor num pedido já criado: sai do que cada item tem acima do VIP (como no Novo pedido).
create or replace function app.aplicar_desconto_pedido(p_pedido uuid, p_desconto numeric) returns numeric
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; v_total numeric; v_margem numeric; v_fator numeric; r record; v_baixa boolean := app.pode_baixar_preco();
        v_casas int;
begin
  v_ped := app._pedido_editavel_itens(p_pedido);
  if not (app.pode_escrever() and app.ve_pedido(v_ped.vendedora_id)) then
    raise exception 'Só a vendedora do pedido ou a gerência dá desconto.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_desconto, 0) <= 0 then raise exception 'Informe o valor do desconto.'; end if;
  v_casas := case when v_ped.moeda = 'GS' then 0 else 2 end;
  select coalesce(sum(round(quantidade * preco_unitario, 2)), 0) into v_total from app.pedido_itens where pedido_id = p_pedido;
  if p_desconto >= v_total then raise exception 'O desconto não pode ser maior ou igual ao total do pedido.'; end if;
  select coalesce(sum(i.quantidade * greatest(i.preco_unitario - app.preco_piso_vendedora(i.produto_id, v_ped.moeda,
           (select ff.preco from app.preco_final_moeda(v_ped.cliente_id, i.produto_id, v_ped.moeda) ff)), 0)), 0)
    into v_margem from app.pedido_itens i where i.pedido_id = p_pedido;
  perform set_config('app.motivo', 'Desconto no pedido', true);
  if v_baixa and p_desconto > v_margem then
    v_fator := 1 - p_desconto / v_total;
    update app.pedido_itens set preco_unitario = round(preco_unitario * v_fator, v_casas) where pedido_id = p_pedido;
  else
    if p_desconto > v_margem then
      raise exception 'Desconto acima do permitido: o máximo sem passar do preço VIP é %. Para dar mais, fale com o gerente.',
        case when v_ped.moeda = 'GS' then 'Gs ' || to_char(v_margem, 'FM999G999G999') else 'R$ ' || to_char(v_margem, 'FM999G990D00') end;
    end if;
    for r in select i.id, i.preco_unitario,
                    app.preco_piso_vendedora(i.produto_id, v_ped.moeda, (select ff.preco from app.preco_final_moeda(v_ped.cliente_id, i.produto_id, v_ped.moeda) ff)) piso
               from app.pedido_itens i where i.pedido_id = p_pedido loop
      if r.preco_unitario > r.piso then
        update app.pedido_itens
           set preco_unitario = greatest(r.piso, round(r.preco_unitario - (r.preco_unitario - r.piso) * p_desconto / v_margem, v_casas))
         where id = r.id;
      end if;
    end loop;
  end if;
  update app.pedidos set observacoes = concat_ws(' | ', observacoes, 'Desconto aplicado: ' ||
           case when v_ped.moeda = 'GS' then 'Gs ' || to_char(p_desconto, 'FM999G999G999') else 'R$ ' || to_char(p_desconto, 'FM999G990D00') end)
   where id = p_pedido;
  return app._recalcular_total_pedido(p_pedido);
end $$;
grant execute on function app.aplicar_desconto_pedido(uuid, numeric) to vc_app;

-- Aviso no WhatsApp do gerente quando a vendedora informa um pagamento (0 = desligado)
insert into app.parametros (chave, valor, descricao) values
  ('aviso_pagamento_whatsapp', 0, 'WhatsApp que recebe aviso quando a vendedora informa um pagamento (com DDI, só números; 0 = desligado)')
on conflict (chave) do nothing;

-- Dados para o aviso (só de um pagamento que a própria pessoa acabou de registrar)
create or replace function app.aviso_pagamento_dados(p_pagamento uuid)
returns table (numero text, instancia text, cliente text, vendedora text, bling_numero text, moeda text, valor numeric, falta numeric, comprovante boolean)
language sql stable security definer set search_path = app, pg_temp as $$
  select trunc(app.param('aviso_pagamento_whatsapp'))::bigint::text,
         (select w.instancia from app.whatsapp_conexoes w where w.ativo and w.estado = 'conectado'
           order by (w.vendedora_id is null) desc, w.criado_em limit 1),
         cl.nome, v.nome, p.bling_numero, p.moeda::text, g.valor, greatest(vp.saldo - vp.a_conferir, 0),
         exists (select 1 from app.comprovantes c where c.pagamento_id = g.id)
    from app.pagamentos g join app.pedidos p on p.id = g.pedido_id join app.v_pedidos vp on vp.id = p.id
    left join app.clientes cl on cl.id = p.cliente_id left join app.vendedoras v on v.id = p.vendedora_id
   where g.id = p_pagamento and g.registrado_por = app.uid() and g.registrado_em > now() - interval '10 minutes'
     and coalesce(app.param('aviso_pagamento_whatsapp'), 0) > 0
$$;
grant execute on function app.aviso_pagamento_dados(uuid) to vc_app;
