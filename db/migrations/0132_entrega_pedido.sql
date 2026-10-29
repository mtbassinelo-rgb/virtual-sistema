-- =====================================================================
-- Migração 0132: como o pedido sai (vendedora informa) e despacho pelo estoquista (passeiro)
--
-- Depois da expedição, a vendedora informa: ENVIO (meio e dados para envio) ou RETIRA
-- (Paraguai: retira na loja CDE; Brasil: retira no depósito). O pedido aparece na área do estoquista
-- em "Envio de pedidos" e, quando o passeiro leva (ou fica pronto para retirada), ele dá o ✓.
-- =====================================================================

alter table app.pedidos
  add column if not exists entrega_tipo text check (entrega_tipo in ('envio', 'retira')),
  add column if not exists entrega_meio text check (length(entrega_meio) <= 120),
  add column if not exists entrega_dados text check (length(entrega_dados) <= 1000),
  add column if not exists entrega_definida_em timestamptz,
  add column if not exists entrega_definida_por uuid references app.usuarios(id),
  add column if not exists despachado_por uuid references app.usuarios(id),
  add column if not exists despachado_em timestamptz;

-- Vendedora (ou gestão) informa como o pedido sai
create or replace function app.definir_entrega(p_pedido uuid, p_tipo text, p_meio text, p_dados text) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos;
begin
  select * into v_ped from app.pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if not (app.pode_escrever() and app.ve_pedido(v_ped.vendedora_id)) then
    raise exception 'Só a vendedora do pedido ou a gerência informa a entrega.' using errcode = 'insufficient_privilege';
  end if;
  if v_ped.status_comercial::text not in ('aguardando_cliente', 'aguardando_aprovacao', 'em_separacao') then
    raise exception 'O pedido já saiu: a entrega não muda mais por aqui.';
  end if;
  if p_tipo not in ('envio', 'retira') then raise exception 'Escolha envio ou retirada.'; end if;
  if coalesce(trim(p_meio), '') = '' then
    raise exception '%', case when p_tipo = 'envio' then 'Informe o meio de envio (transportadora, passeiro, Correios...).' else 'Informe onde o cliente retira.' end;
  end if;
  if p_tipo = 'envio' and coalesce(trim(p_dados), '') = '' then
    raise exception 'Informe os dados para o envio (nome, telefone, endereço ou transportadora).';
  end if;
  perform set_config('app.motivo', 'Entrega definida: ' || p_tipo, true);
  update app.pedidos
     set entrega_tipo = p_tipo, entrega_meio = left(trim(p_meio), 120), entrega_dados = nullif(left(trim(coalesce(p_dados, '')), 1000), ''),
         entrega_definida_em = now(), entrega_definida_por = app.uid(),
         local_retirada = case when p_tipo = 'retira' then left(trim(p_meio), 200) else local_retirada end
   where id = p_pedido;
end $$;
grant execute on function app.definir_entrega(uuid, text, text, text) to vc_app;

-- Estoquista dá o ✓: envio → em transporte (passeiro levou); retira → aguardando retirada no local informado
create or replace function app.despachar_pedido(p_pedido uuid) returns text
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos;
begin
  select * into v_ped from app.pedidos where id = p_pedido;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if not (coalesce(app.pode_gerir(), false) or app.pode_operar_deposito(v_ped.deposito_id)) then
    raise exception 'Só quem mexe no estoque desta unidade despacha o pedido.' using errcode = 'insufficient_privilege';
  end if;
  if v_ped.status_comercial::text <> 'em_separacao' then raise exception 'Este pedido já saiu ou não está pronto.'; end if;
  if v_ped.entrega_tipo is null then raise exception 'A vendedora ainda não informou se é envio ou retirada.'; end if;
  if v_ped.entrega_tipo = 'envio' then
    perform app.avancar_entrega(p_pedido, 'transporte', null);
  else
    perform app.avancar_entrega(p_pedido, 'retirada', coalesce(v_ped.local_retirada, v_ped.entrega_meio));
  end if;
  update app.pedidos set despachado_por = app.uid(), despachado_em = now() where id = p_pedido;
  return v_ped.entrega_tipo;
end $$;
grant execute on function app.despachar_pedido(uuid) to vc_app;

-- Envio para o Paraguai: o passeiro leva para a loja CDE, onde a encarregada (Yessica) reorganiza e manda pela
-- transportadora para a cidade do cliente. Ela confirma aqui; só depois a vendedora finaliza (cliente recebeu).
alter table app.pedidos
  add column if not exists envio_confirmado_em timestamptz,
  add column if not exists envio_confirmado_por uuid references app.usuarios(id),
  add column if not exists envio_guia text check (length(envio_guia) <= 200);

create or replace function app.envio_py_pendente(p app.pedidos) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select p.entrega_tipo = 'envio' and p.envio_confirmado_em is null and p.status_comercial::text = 'enviado'
     and (select c.pais::text from app.clientes c where c.id = p.cliente_id) = 'PY'
$$;

create or replace function app.pode_confirmar_envio_py() returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce(app.pode_gerir(), false)
      or exists (select 1 from app.depositos d where d.codigo = 'loja-cde' and app.trabalha_na_unidade(d.id))
$$;
grant execute on function app.pode_confirmar_envio_py() to vc_app;

create or replace function app.confirmar_envio_py(p_pedido uuid, p_guia text) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos;
begin
  if not app.pode_confirmar_envio_py() then
    raise exception 'Só a loja CDE ou a gerência confirma os envios para o Paraguai.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_ped from app.pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if not app.envio_py_pendente(v_ped) then raise exception 'Este pedido não está esperando a confirmação do envio.'; end if;
  perform set_config('app.motivo', 'Envio pela transportadora confirmado (CDE)', true);
  update app.pedidos set envio_confirmado_em = now(), envio_confirmado_por = app.uid(), envio_guia = nullif(left(trim(coalesce(p_guia, '')), 200), '')
   where id = p_pedido;
end $$;
grant execute on function app.confirmar_envio_py(uuid, text) to vc_app;

-- Lista para a loja CDE (pendentes de confirmar)
create or replace function app.envios_py_pendentes()
returns table (id uuid, cliente text, cidade text, vendedora text, entrega_meio text, entrega_dados text, volumes int, despachado_em timestamptz)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.pode_confirmar_envio_py() then return; end if;
  return query select p.id, cl.nome, cl.cidade, v.nome, p.entrega_meio, p.entrega_dados, coalesce(p.volumes, p.caixas_separadas), p.despachado_em
    from app.pedidos p join app.clientes cl on cl.id = p.cliente_id join app.vendedoras v on v.id = p.vendedora_id
   where app.envio_py_pendente(p) order by p.despachado_em nulls first;
end $$;
grant execute on function app.envios_py_pendentes() to vc_app;

-- Finalizar (cliente recebeu) um envio para o Paraguai só depois da confirmação da loja CDE
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
    if app.envio_py_pendente(v_ped) then
      raise exception 'Aguardando a loja CDE confirmar o envio pela transportadora. Depois disso a vendedora finaliza.';
    end if;
    update app.pedidos set status_comercial = 'entregue', entregue_em = current_date, enviado_em = coalesce(enviado_em, current_date) where id = p_pedido;
  else
    raise exception 'Etapa inválida.';
  end if;
end $$;
grant execute on function app.avancar_entrega(uuid, text, text) to vc_app;
