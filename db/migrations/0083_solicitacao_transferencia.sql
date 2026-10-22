-- =====================================================================
-- Solicitação de mercadoria entre unidades (ex.: vendedora de CDE pede ao CD Foz):
--   solicitada  → a unidade de destino pede (vendedora ligada à unidade)
--   separada    → o estoquista da origem confere o que tem e o que faltou
--   enviada     → o gerente (ou a pessoa encarregada) aprova: sai do estoque de origem, fica em trânsito
--   recebida    → o destino confere a chegada e entra no estoque dele
-- Cada item guarda o custo na hora do envio: a mercadoria transferida conta como custo da unidade que recebe.
-- =====================================================================
alter table app.transferencias drop constraint if exists transferencias_status_check;
alter table app.transferencias add constraint transferencias_status_check
  check (status in ('solicitada','separada','rascunho','enviada','recebida','recebida_com_divergencia','cancelada'));
alter table app.transferencias
  add column separada_por uuid references app.usuarios(id),
  add column separada_em timestamptz,
  add column cancelada_por uuid references app.usuarios(id),
  add column cancelada_em timestamptz,
  add column motivo_cancelamento text check (length(motivo_cancelamento) <= 300),
  add column pedido_origem_id uuid references app.pedidos(id),
  add column valor_custo numeric(14,2);
comment on column app.transferencias.valor_custo is 'Custo (R$) da mercadoria enviada: entra como custo da unidade de destino.';
comment on column app.transferencias.pedido_origem_id is 'Pedido cancelado cuja mercadoria foi pedida para outra unidade.';

alter table app.transferencia_itens drop constraint if exists transferencia_itens_quantidade_enviada_check;
alter table app.transferencia_itens add constraint transferencia_itens_quantidade_enviada_check check (quantidade_enviada >= 0);
alter table app.transferencia_itens
  add column quantidade_solicitada numeric(12,3) check (quantidade_solicitada > 0),
  add column custo_unit numeric(14,4);

-- Quem pode aprovar o envio além do gerente/dono (ex.: vendedora encarregada do estoquista)
alter table app.usuarios add column aprova_transferencias boolean not null default false;
grant select (aprova_transferencias) on app.usuarios to vc_app;

create or replace function app.pode_aprovar_transferencia() returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce(app.pode_gerir(), false)
      or exists (select 1 from app.usuarios where id = app.uid() and aprova_transferencias and ativo and app.perfil_atual() is not null)
$$;

-- Quem trabalha na unidade (opera o depósito ou é vendedora ligada a ela)
create or replace function app.trabalha_na_unidade(p_deposito uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select app.pode_caixa(p_deposito)
$$;

-- Pedido da unidade de destino. itens: [{produto_id, quantidade}]
create or replace function app.solicitar_transferencia(p_origem uuid, p_destino uuid, p_itens jsonb, p_obs text default null, p_pedido uuid default null)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id uuid; i jsonb; v_q numeric; n int := 0;
begin
  if not app.trabalha_na_unidade(p_destino) then
    raise exception 'Você não trabalha na unidade que vai receber.' using errcode = 'insufficient_privilege';
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

-- Estoquista da origem confere: quanto separou de cada item (0 = não tem). itens: [{produto_id, quantidade}]
create or replace function app.separar_transferencia(p_id uuid, p_itens jsonb) returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare t app.transferencias; it record; v_q numeric; v_tem int := 0; v_falta int := 0;
begin
  select * into t from app.transferencias where id = p_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if not app.pode_operar_deposito(t.origem_id) then
    raise exception 'Só quem opera o estoque de origem separa.' using errcode = 'insufficient_privilege';
  end if;
  if t.status not in ('solicitada', 'separada') then raise exception 'Esta solicitação já foi enviada ou cancelada.'; end if;
  for it in select * from app.transferencia_itens where transferencia_id = p_id loop
    select (r->>'quantidade')::numeric into v_q from jsonb_array_elements(coalesce(p_itens, '[]')) r where (r->>'produto_id')::uuid = it.produto_id;
    v_q := greatest(coalesce(v_q, it.quantidade_enviada), 0);
    if v_q > app.saldo_disponivel(t.origem_id, it.produto_id) then
      raise exception 'Não há % de % no estoque de origem (tem %).', v_q, (select nome from app.produtos where id = it.produto_id),
        app.saldo_disponivel(t.origem_id, it.produto_id);
    end if;
    update app.transferencia_itens set quantidade_enviada = v_q where transferencia_id = p_id and produto_id = it.produto_id;
    if v_q > 0 then v_tem := v_tem + 1; else v_falta := v_falta + 1; end if;
  end loop;
  update app.transferencias set status = 'separada', separada_por = app.uid(), separada_em = now() where id = p_id;
  return jsonb_build_object('tem', v_tem, 'falta', v_falta);
end $$;

-- Saída do estoque de origem (comum ao envio direto e à aprovação)
create or replace function app._despachar_transferencia(t app.transferencias) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare it record; v_total numeric := 0; v_custo numeric;
begin
  if not exists (select 1 from app.transferencia_itens where transferencia_id = t.id and quantidade_enviada > 0) then
    raise exception 'Nenhum item separado para enviar.';
  end if;
  for it in select * from app.transferencia_itens where transferencia_id = t.id and quantidade_enviada > 0 loop
    perform app._lancar(t.origem_id, it.produto_id, 'transferencia_saida', it.quantidade_enviada, 'transferencia', t.numero::text, null);
    v_custo := app.custo_produto(it.produto_id);
    update app.transferencia_itens set custo_unit = v_custo where transferencia_id = t.id and produto_id = it.produto_id;
    v_total := v_total + coalesce(v_custo, 0) * it.quantidade_enviada;
  end loop;
  update app.transferencias set status = 'enviada', enviada_por = app.uid(), enviada_em = now(), valor_custo = round(v_total, 2) where id = t.id;
end $$;

-- Aprovação (gerente, dono ou encarregada): envia o que foi separado
create or replace function app.aprovar_transferencia(p_id uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare t app.transferencias;
begin
  select * into t from app.transferencias where id = p_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if not app.pode_aprovar_transferencia() then
    raise exception 'Só o gerente, o dono ou a pessoa encarregada aprova o envio.' using errcode = 'insufficient_privilege';
  end if;
  if t.status = 'solicitada' then raise exception 'O estoquista ainda não separou esta solicitação.'; end if;
  if t.status not in ('separada', 'rascunho') then raise exception 'Esta transferência já foi enviada ou cancelada.'; end if;
  perform app._despachar_transferencia(t);
end $$;

-- Envio direto de quem opera a origem (rascunho), agora guardando o custo
create or replace function app.enviar_transferencia(p_id uuid)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare t app.transferencias;
begin
  select * into t from app.transferencias where id = p_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if not app.pode_operar_deposito(t.origem_id) then
    raise exception 'Sem permissão para enviar deste depósito.' using errcode = 'insufficient_privilege';
  end if;
  if t.status = 'separada' then
    if not app.pode_aprovar_transferencia() then raise exception 'Solicitação separada: falta a aprovação do gerente ou da encarregada.'; end if;
  elsif t.status <> 'rascunho' then raise exception 'Só transferência em rascunho pode ser enviada.';
  end if;
  perform app._despachar_transferencia(t);
end $$;

-- Cancelar antes do envio: quem pediu, quem opera a origem ou quem aprova
drop function app.cancelar_transferencia(uuid);
create function app.cancelar_transferencia(p_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare t app.transferencias;
begin
  select * into t from app.transferencias where id = p_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if not (app.pode_operar_deposito(t.origem_id) or app.pode_aprovar_transferencia() or t.criada_por = app.uid()) then
    raise exception 'Sem permissão.' using errcode = 'insufficient_privilege';
  end if;
  if t.status not in ('rascunho', 'solicitada', 'separada') then
    raise exception 'Transferência já enviada não pode ser cancelada: receba-a no destino (com 0 se não chegou).';
  end if;
  update app.transferencias set status = 'cancelada', cancelada_por = app.uid(), cancelada_em = now(),
         motivo_cancelamento = nullif(left(trim(coalesce(p_motivo, '')), 300), '') where id = p_id;
end $$;
-- Recebimento: igual ao anterior, ignorando itens que não foram enviados (0)
create or replace function app.receber_transferencia(p_id uuid, p_recebidos jsonb default '[]', p_obs text default null)
returns text language plpgsql security definer set search_path = app, pg_temp as $$
declare t app.transferencias; it record; v_qtd numeric; v_div boolean := false;
begin
  select * into t from app.transferencias where id = p_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if not (app.pode_operar_deposito(t.destino_id) or app.trabalha_na_unidade(t.destino_id)) then
    raise exception 'Sem permissão para receber neste depósito.' using errcode = 'insufficient_privilege';
  end if;
  if t.status <> 'enviada' then raise exception 'Só transferência enviada pode ser recebida.'; end if;
  for it in select * from app.transferencia_itens where transferencia_id = p_id and quantidade_enviada > 0 loop
    select (r->>'quantidade')::numeric into v_qtd from jsonb_array_elements(coalesce(p_recebidos,'[]')) r
     where (r->>'produto_id')::uuid = it.produto_id;
    v_qtd := coalesce(v_qtd, it.quantidade_enviada);
    if v_qtd < 0 or v_qtd > it.quantidade_enviada then
      raise exception 'Quantidade recebida inválida: deve ficar entre 0 e %.', it.quantidade_enviada;
    end if;
    if v_qtd > 0 then
      perform app._lancar(t.destino_id, it.produto_id, 'transferencia_entrada', v_qtd, 'transferencia', t.numero::text, p_obs);
    end if;
    if v_qtd < it.quantidade_enviada then v_div := true; end if;
    update app.transferencia_itens set quantidade_recebida = v_qtd where transferencia_id = p_id and produto_id = it.produto_id;
  end loop;
  update app.transferencias
     set status = case when v_div then 'recebida_com_divergencia' else 'recebida' end,
         recebida_por = app.uid(), recebida_em = now(),
         observacao = nullif(concat_ws(' | ', observacao, nullif(trim(coalesce(p_obs, '')), '')), '')
   where id = p_id;
  return case when v_div then 'recebida_com_divergencia' else 'recebida' end;
end $$;

revoke execute on function app.solicitar_transferencia(uuid, uuid, jsonb, text, uuid), app.separar_transferencia(uuid, jsonb),
  app.aprovar_transferencia(uuid), app.cancelar_transferencia(uuid, text), app._despachar_transferencia(app.transferencias) from public;
grant execute on function app.solicitar_transferencia(uuid, uuid, jsonb, text, uuid), app.separar_transferencia(uuid, jsonb),
  app.aprovar_transferencia(uuid), app.cancelar_transferencia(uuid, text), app.pode_aprovar_transferencia(), app.trabalha_na_unidade(uuid) to vc_app;

-- Equipe: marcar quem aprova envio entre unidades (só gerente/dono)
create or replace function app.definir_aprova_transferencias(p_usuario uuid, p_aprova boolean) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono define quem aprova envios.'; end if;
  update app.usuarios set aprova_transferencias = coalesce(p_aprova, false) where id = p_usuario;
end $$;
revoke execute on function app.definir_aprova_transferencias(uuid, boolean) from public;
grant execute on function app.definir_aprova_transferencias(uuid, boolean) to vc_app;
