-- =====================================================================
-- Migração 0119: separação pelo estoquista (sem alterar o pedido)
--
-- O estoquista não mexe em produto, preço nem aumenta quantidade. Ele CONFIRMA,
-- item por item, a quantidade exata que separou (ou marca "Não tem") e informa
-- o total de caixas separadas. O que faltou fica registrado e a vendedora vê
-- no painel dela para avisar o cliente.
-- =====================================================================

alter table app.pedidos add column if not exists caixas_separadas int check (caixas_separadas between 0 and 10000);

-- Quantidade que o estoquista confirmou em cada item (fica mesmo quando a linha sai do pedido por "Não tem")
create table if not exists app.pedido_separacao (
  pedido_id   uuid not null references app.pedidos(id),
  item_id     uuid not null,
  produto_id  uuid references app.produtos(id),
  descricao   text not null,
  pedida      numeric(12,3) not null,
  separada    numeric(12,3) not null,
  em          timestamptz not null default now(),
  por         uuid references app.usuarios(id),
  primary key (pedido_id, item_id)
);
alter table app.pedido_separacao enable row level security;
create policy ler on app.pedido_separacao for select using (
  exists (select 1 from app.pedidos p where p.id = pedido_id and (app.ve_pedido(p.vendedora_id) or app.pode_operar_deposito(p.deposito_id))));
grant select on app.pedido_separacao to vc_app;

-- p_itens: [{"item_id": "...", "quantidade": 12}] — TODOS os itens do pedido precisam vir, com a quantidade conferida.
create or replace function app.confirmar_separacao_estoque(p_pedido uuid, p_itens jsonb, p_caixas int) returns numeric
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; it record; v_q numeric; v_total numeric; v_sep numeric := 0;
begin
  select * into v_ped from app.pedidos where id = p_pedido;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if not (app.pode_gerir() or app.pode_operar_deposito(v_ped.deposito_id)) then
    raise exception 'Só a expedição do depósito ou a gerência confere a separação.' using errcode = 'insufficient_privilege';
  end if;
  if v_ped.separacao_conferida_em is not null then raise exception 'Este pedido já foi conferido.'; end if;
  if jsonb_typeof(p_itens) <> 'array' then raise exception 'Itens inválidos.'; end if;

  for it in select * from app.pedido_itens where pedido_id = p_pedido loop
    select (r->>'quantidade')::numeric into v_q from jsonb_array_elements(p_itens) r where (r->>'item_id')::uuid = it.id;
    if v_q is null then
      raise exception 'Confirme a quantidade separada de % (ou marque Não tem).', it.descricao;
    end if;
    if v_q < 0 or v_q > it.quantidade then
      raise exception 'Quantidade separada de % deve ficar entre 0 e % (o pedido não pode ser aumentado na separação).', it.descricao, it.quantidade;
    end if;
    insert into app.pedido_separacao (pedido_id, item_id, produto_id, descricao, pedida, separada, por)
    values (p_pedido, it.id, it.produto_id, it.descricao, it.quantidade, v_q, app.uid())
    on conflict (pedido_id, item_id) do update set separada = excluded.separada, pedida = excluded.pedida, em = now(), por = excluded.por;
    v_sep := v_sep + v_q;
  end loop;
  if v_sep > 0 and coalesce(p_caixas, 0) <= 0 then raise exception 'Informe o total de caixas separadas.'; end if;
  if p_caixas is not null and (p_caixas < 0 or p_caixas > 10000) then raise exception 'Total de caixas inválido.'; end if;

  -- mesma regra de sempre: o que faltou vira "indisponível" (cliente e vendedora veem) e o total é recalculado
  v_total := app.conferir_separacao(p_pedido, p_itens);
  update app.pedidos set caixas_separadas = p_caixas, volumes = coalesce(volumes, p_caixas) where id = p_pedido;
  return v_total;
end $$;
grant execute on function app.confirmar_separacao_estoque(uuid, jsonb, int) to vc_app;
