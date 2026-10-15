-- =====================================================================
-- Migração 0006: estoque por depósito e transferências
--
-- Depósitos: CD Principal (Foz do Iguaçu) e Loja (Ciudad del Este).
-- O estoque funciona como um extrato: cada entrada, saída, transferência e
-- ajuste é um lançamento que não se altera nem se apaga. O saldo de cada
-- depósito é mantido junto e nunca fica negativo.
--
-- Transferência: rascunho -> enviada (sai da origem, fica em trânsito)
--   -> recebida (entra no destino com a quantidade conferida na chegada).
--   Diferença entre enviado e recebido fica registrada como divergência.
--
-- Fase A (Bling ainda oficial): este estoque roda em paralelo para conferência.
-- =====================================================================

create table app.depositos (
  id      uuid primary key default gen_random_uuid(),
  codigo  text not null unique,
  nome    text not null,
  pais    app.pais not null,
  cidade  text,
  tipo    text not null check (tipo in ('cd','loja')),
  ativo   boolean not null default true
);
insert into app.depositos (codigo, nome, pais, cidade, tipo) values
  ('cd-foz',   'CD Principal',          'BR', 'Foz do Iguaçu',    'cd'),
  ('loja-cde', 'Loja Ciudad del Este',  'PY', 'Ciudad del Este', 'loja');

-- Pessoas responsáveis por operar um depósito (além de gerente e dono),
-- por exemplo quem atende na loja de CDE
create table app.deposito_responsaveis (
  deposito_id uuid not null references app.depositos(id),
  usuario_id  uuid not null references app.usuarios(id),
  primary key (deposito_id, usuario_id)
);

create type app.tipo_movimento as enum (
  'entrada_compra','saida_venda','transferencia_saida','transferencia_entrada',
  'ajuste_entrada','ajuste_saida','devolucao_cliente','perda');

create table app.estoque_saldos (
  deposito_id uuid not null references app.depositos(id),
  produto_id  uuid not null references app.produtos(id),
  quantidade  numeric(12,3) not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (deposito_id, produto_id),
  constraint saldo_nao_negativo check (quantidade >= 0)
);

create table app.estoque_movimentos (
  id              bigserial primary key,
  deposito_id     uuid not null references app.depositos(id),
  produto_id      uuid not null references app.produtos(id),
  tipo            app.tipo_movimento not null,
  quantidade      numeric(12,3) not null check (quantidade > 0),
  referencia_tipo text,                 -- pedido, transferencia, compra, inventario
  referencia_id   text,
  observacao      text,
  usuario_id      uuid,
  em              timestamptz not null default clock_timestamp()
);
create index on app.estoque_movimentos (deposito_id, produto_id, em);
create index on app.estoque_movimentos (referencia_tipo, referencia_id);

-- Cada lançamento atualiza o saldo; saldo negativo cancela a operação inteira
create or replace function app.aplicar_movimento() returns trigger language plpgsql as $$
declare v_sinal int := case when new.tipo in ('entrada_compra','transferencia_entrada','ajuste_entrada','devolucao_cliente') then 1 else -1 end;
begin
  -- trava a linha do saldo: duas saídas simultâneas não passam do estoque
  update app.estoque_saldos set quantidade = quantidade + v_sinal * new.quantidade, atualizado_em = now()
   where deposito_id = new.deposito_id and produto_id = new.produto_id;
  if not found then
    insert into app.estoque_saldos (deposito_id, produto_id, quantidade)
    values (new.deposito_id, new.produto_id, v_sinal * new.quantidade);
  end if;
  return new;
exception when check_violation then
  raise exception 'Estoque insuficiente de % no depósito % (operação: %).',
    (select codigo || ' ' || nome from app.produtos where id = new.produto_id),
    (select nome from app.depositos where id = new.deposito_id), new.tipo;
end $$;
create trigger aplicar after insert on app.estoque_movimentos
  for each row execute function app.aplicar_movimento();

create or replace function app.movimento_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'Lançamento de estoque não pode ser alterado nem apagado. Faça um ajuste.' using errcode = 'insufficient_privilege';
end $$;
create trigger imutavel before update or delete on app.estoque_movimentos
  for each row execute function app.movimento_imutavel();
create trigger imutavel_truncate before truncate on app.estoque_movimentos
  for each statement execute function app.movimento_imutavel();

create or replace function app.pode_operar_deposito(p_deposito uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select app.perfil_atual() in ('gerente','dono')
      or exists (select 1 from app.deposito_responsaveis where deposito_id = p_deposito and usuario_id = app.uid())
$$;

-- Lançamento interno (só usado pelas funções abaixo)
create or replace function app._lancar(p_dep uuid, p_prod uuid, p_tipo app.tipo_movimento, p_qtd numeric,
                                       p_ref_tipo text, p_ref_id text, p_obs text)
returns void language sql security definer set search_path = app, pg_temp as $$
  insert into app.estoque_movimentos (deposito_id, produto_id, tipo, quantidade, referencia_tipo, referencia_id, observacao, usuario_id)
  values (p_dep, p_prod, p_tipo, p_qtd, p_ref_tipo, p_ref_id, p_obs, app.uid())
$$;

-- ---------------------------------------------------------------------
-- Entradas de compra e ajustes de inventário
-- itens: [{"produto_id": "...", "quantidade": 12}, ...]
-- ---------------------------------------------------------------------
create or replace function app.entrada_compra(p_deposito uuid, p_itens jsonb, p_referencia text, p_obs text default null)
returns int language plpgsql security definer set search_path = app, pg_temp as $$
declare i jsonb; n int := 0;
begin
  if not app.pode_operar_deposito(p_deposito) then
    raise exception 'Sem permissão para operar este depósito.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_referencia),'') = '' then raise exception 'Informe a referência da compra (nota, pedido do fornecedor).'; end if;
  for i in select * from jsonb_array_elements(p_itens) loop
    perform app._lancar(p_deposito, (i->>'produto_id')::uuid, 'entrada_compra', (i->>'quantidade')::numeric, 'compra', p_referencia, p_obs);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function app.ajustar_estoque(p_deposito uuid, p_produto uuid, p_quantidade_contada numeric, p_motivo text)
returns numeric language plpgsql security definer set search_path = app, pg_temp as $$
declare v_atual numeric; v_dif numeric;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono ajusta estoque.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_motivo),'') = '' then raise exception 'Informe o motivo do ajuste.'; end if;
  if p_quantidade_contada < 0 then raise exception 'Quantidade contada não pode ser negativa.'; end if;
  select coalesce(quantidade, 0) into v_atual from app.estoque_saldos where deposito_id = p_deposito and produto_id = p_produto;
  v_dif := p_quantidade_contada - coalesce(v_atual, 0);
  if v_dif > 0 then perform app._lancar(p_deposito, p_produto, 'ajuste_entrada', v_dif, 'inventario', null, p_motivo);
  elsif v_dif < 0 then perform app._lancar(p_deposito, p_produto, 'ajuste_saida', -v_dif, 'inventario', null, p_motivo);
  end if;
  return v_dif;
end $$;

-- ---------------------------------------------------------------------
-- Transferências entre depósitos
-- ---------------------------------------------------------------------
create table app.transferencias (
  id            uuid primary key default gen_random_uuid(),
  numero        bigserial unique,
  origem_id     uuid not null references app.depositos(id),
  destino_id    uuid not null references app.depositos(id),
  status        text not null default 'rascunho'
                check (status in ('rascunho','enviada','recebida','recebida_com_divergencia','cancelada')),
  observacao    text,
  criada_por    uuid references app.usuarios(id),
  criada_em     timestamptz not null default now(),
  enviada_por   uuid references app.usuarios(id),
  enviada_em    timestamptz,
  recebida_por  uuid references app.usuarios(id),
  recebida_em   timestamptz,
  constraint depositos_diferentes check (origem_id <> destino_id)
);

create table app.transferencia_itens (
  transferencia_id    uuid not null references app.transferencias(id),
  produto_id          uuid not null references app.produtos(id),
  quantidade_enviada  numeric(12,3) not null check (quantidade_enviada > 0),
  quantidade_recebida numeric(12,3) check (quantidade_recebida >= 0),
  primary key (transferencia_id, produto_id)
);

create or replace function app.criar_transferencia(p_origem uuid, p_destino uuid, p_itens jsonb, p_obs text default null)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id uuid; i jsonb;
begin
  if not app.pode_operar_deposito(p_origem) then
    raise exception 'Sem permissão para tirar mercadoria deste depósito.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_array_length(coalesce(p_itens,'[]')) = 0 then raise exception 'A transferência precisa de pelo menos um item.'; end if;
  insert into app.transferencias (origem_id, destino_id, observacao, criada_por)
  values (p_origem, p_destino, p_obs, app.uid()) returning id into v_id;
  for i in select * from jsonb_array_elements(p_itens) loop
    insert into app.transferencia_itens (transferencia_id, produto_id, quantidade_enviada)
    values (v_id, (i->>'produto_id')::uuid, (i->>'quantidade')::numeric);
  end loop;
  return v_id;
end $$;

-- Envio: a mercadoria sai do depósito de origem e fica em trânsito
create or replace function app.enviar_transferencia(p_id uuid)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare t app.transferencias; it record;
begin
  select * into t from app.transferencias where id = p_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if not app.pode_operar_deposito(t.origem_id) then
    raise exception 'Sem permissão para enviar deste depósito.' using errcode = 'insufficient_privilege';
  end if;
  if t.status <> 'rascunho' then raise exception 'Só transferência em rascunho pode ser enviada.'; end if;
  for it in select * from app.transferencia_itens where transferencia_id = p_id loop
    perform app._lancar(t.origem_id, it.produto_id, 'transferencia_saida', it.quantidade_enviada, 'transferencia', t.numero::text, null);
  end loop;
  update app.transferencias set status = 'enviada', enviada_por = app.uid(), enviada_em = now() where id = p_id;
end $$;

-- Recebimento: entra no destino a quantidade CONFERIDA na chegada.
-- p_recebidos: [{"produto_id": "...", "quantidade": 10}]; item omitido = recebido completo.
create or replace function app.receber_transferencia(p_id uuid, p_recebidos jsonb default '[]', p_obs text default null)
returns text language plpgsql security definer set search_path = app, pg_temp as $$
declare t app.transferencias; it record; v_qtd numeric; v_div boolean := false;
begin
  select * into t from app.transferencias where id = p_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if not app.pode_operar_deposito(t.destino_id) then
    raise exception 'Sem permissão para receber neste depósito.' using errcode = 'insufficient_privilege';
  end if;
  if t.status <> 'enviada' then raise exception 'Só transferência enviada pode ser recebida.'; end if;
  for it in select * from app.transferencia_itens where transferencia_id = p_id loop
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
    update app.transferencia_itens set quantidade_recebida = v_qtd
     where transferencia_id = p_id and produto_id = it.produto_id;
  end loop;
  update app.transferencias
     set status = case when v_div then 'recebida_com_divergencia' else 'recebida' end,
         recebida_por = app.uid(), recebida_em = now(),
         observacao = coalesce(observacao || ' | ', '') || coalesce(p_obs, '')
   where id = p_id;
  return case when v_div then 'recebida_com_divergencia' else 'recebida' end;
end $$;

create or replace function app.cancelar_transferencia(p_id uuid)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare t app.transferencias;
begin
  select * into t from app.transferencias where id = p_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if not app.pode_operar_deposito(t.origem_id) then
    raise exception 'Sem permissão.' using errcode = 'insufficient_privilege';
  end if;
  if t.status <> 'rascunho' then
    raise exception 'Transferência já enviada não pode ser cancelada: receba-a no destino (com 0 se não chegou).';
  end if;
  update app.transferencias set status = 'cancelada' where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Pedidos: de qual depósito sai a mercadoria
-- Ao marcar "enviado", os itens do pedido saem do estoque do depósito.
-- Se um pedido enviado for cancelado, a mercadoria volta como devolução.
-- (Pedidos de origem Bling seguem o estoque do Bling na fase A.)
-- ---------------------------------------------------------------------
alter table app.pedidos add column deposito_id uuid references app.depositos(id);

create or replace function app.estoque_do_pedido() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare it record;
begin
  if new.deposito_id is null or new.origem = 'bling' then return new; end if;
  if new.status_comercial = 'enviado' and old.status_comercial = 'em_separacao' then
    for it in select produto_id, sum(quantidade) q from app.pedido_itens
               where pedido_id = new.id and produto_id is not null group by produto_id loop
      perform app._lancar(new.deposito_id, it.produto_id, 'saida_venda', it.q, 'pedido', new.id::text, null);
    end loop;
  elsif new.status_comercial = 'cancelado' and old.status_comercial in ('enviado','entregue') then
    for it in select produto_id, sum(quantidade) q from app.pedido_itens
               where pedido_id = new.id and produto_id is not null group by produto_id loop
      perform app._lancar(new.deposito_id, it.produto_id, 'devolucao_cliente', it.q, 'pedido', new.id::text, 'Pedido cancelado após envio');
    end loop;
  end if;
  return new;
end $$;
create trigger estoque after update of status_comercial on app.pedidos
  for each row execute function app.estoque_do_pedido();

-- Visão de saldos com o que está em trânsito
create or replace view app.v_estoque with (security_invoker = true) as
select d.id as deposito_id, d.nome as deposito, p.id as produto_id, p.codigo, p.nome as produto,
       coalesce(s.quantidade, 0) as saldo,
       coalesce((select sum(ti.quantidade_enviada) from app.transferencia_itens ti
                   join app.transferencias t on t.id = ti.transferencia_id
                  where t.status = 'enviada' and t.destino_id = d.id and ti.produto_id = p.id), 0) as a_receber
  from app.depositos d cross join app.produtos p
  left join app.estoque_saldos s on s.deposito_id = d.id and s.produto_id = p.id
 where d.ativo and p.ativo;

-- Auditoria
create trigger auditar after insert or update or delete on app.depositos for each row execute function app.auditar('id');
create trigger auditar after insert or update or delete on app.deposito_responsaveis for each row execute function app.auditar('usuario_id');
create trigger auditar after insert or update or delete on app.transferencias for each row execute function app.auditar('id');
create trigger auditar after insert or update or delete on app.transferencia_itens for each row execute function app.auditar('transferencia_id');

-- Permissões: todos consultam estoque; operações só pelas funções
alter table app.depositos enable row level security;
alter table app.deposito_responsaveis enable row level security;
alter table app.estoque_saldos enable row level security;
alter table app.estoque_movimentos enable row level security;
alter table app.transferencias enable row level security;
alter table app.transferencia_itens enable row level security;
create policy ler on app.depositos for select using (app.uid() is not null);
create policy dono on app.depositos for all using (app.perfil_atual() = 'dono') with check (app.perfil_atual() = 'dono');
create policy ler on app.deposito_responsaveis for select using (app.uid() is not null);
create policy gerir on app.deposito_responsaveis for all using (app.pode_gerir()) with check (app.pode_gerir());
create policy ler on app.estoque_saldos for select using (app.uid() is not null);
create policy ler on app.estoque_movimentos for select using (app.uid() is not null);
create policy ler on app.transferencias for select using (app.uid() is not null);
create policy ler on app.transferencia_itens for select using (app.uid() is not null);

grant select on app.depositos, app.deposito_responsaveis, app.estoque_saldos, app.estoque_movimentos,
  app.transferencias, app.transferencia_itens, app.v_estoque to vc_app;
grant insert, update on app.depositos to vc_app;
grant insert, delete on app.deposito_responsaveis to vc_app;
grant update (deposito_id) on app.pedidos to vc_app;
grant execute on function app.entrada_compra(uuid, jsonb, text, text), app.ajustar_estoque(uuid, uuid, numeric, text),
  app.criar_transferencia(uuid, uuid, jsonb, text), app.enviar_transferencia(uuid),
  app.receber_transferencia(uuid, jsonb, text), app.cancelar_transferencia(uuid),
  app.pode_operar_deposito(uuid) to vc_app;
grant execute on function app.aplicar_movimento(), app.movimento_imutavel(), app.estoque_do_pedido() to vc_app, vc_sync;

-- ---------------------------------------------------------------------
-- De quais depósitos cada vendedora pode vender (definido pelo gerente)
-- ---------------------------------------------------------------------
create table app.vendedora_depositos (
  vendedora_id uuid not null references app.vendedoras(id),
  deposito_id  uuid not null references app.depositos(id),
  padrao       boolean not null default false,   -- depósito sugerido nos pedidos dela
  primary key (vendedora_id, deposito_id)
);
create unique index on app.vendedora_depositos (vendedora_id) where padrao;

create or replace function app.validar_deposito_pedido() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if new.deposito_id is null then
    select deposito_id into new.deposito_id from app.vendedora_depositos
     where vendedora_id = new.vendedora_id and padrao;
  end if;
  if new.deposito_id is not null
     and (tg_op = 'INSERT' or new.deposito_id is distinct from old.deposito_id or new.vendedora_id is distinct from old.vendedora_id)
     and app.perfil_atual() = 'vendedora'
     and not exists (select 1 from app.vendedora_depositos
                      where vendedora_id = new.vendedora_id and deposito_id = new.deposito_id) then
    raise exception 'Você não tem permissão para vender do depósito %.',
      (select nome from app.depositos where id = new.deposito_id) using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and new.deposito_id is distinct from old.deposito_id and old.status_comercial <> 'em_separacao' then
    raise exception 'O depósito só pode ser trocado enquanto o pedido está em separação.';
  end if;
  return new;
end $$;
create trigger validar_deposito before insert or update of deposito_id, vendedora_id on app.pedidos
  for each row execute function app.validar_deposito_pedido();

create trigger auditar after insert or update or delete on app.vendedora_depositos
  for each row execute function app.auditar('vendedora_id');
alter table app.vendedora_depositos enable row level security;
create policy ler on app.vendedora_depositos for select using (app.uid() is not null);
create policy gerir on app.vendedora_depositos for all using (app.pode_gerir()) with check (app.pode_gerir());
grant select, insert, update, delete on app.vendedora_depositos to vc_app;
grant execute on function app.validar_deposito_pedido() to vc_app, vc_sync;
