-- Pedidos da Shopee e do Mercado Livre ao vivo na área do estoquista.
-- O aviso (webhook) do marketplace entra por app.marketplace_receber: grava o aviso (sem repetir), cria/atualiza o pedido na fila
-- e avisa as telas abertas pelo canal do Postgres 'marketplace_fila' (LISTEN/NOTIFY). A tela do estoquista recebe por SSE.
-- A fila NÃO mexe no estoque: a baixa continua pelo lançamento das vendas (Estoque → Vendas de marketplace), que não repete pedido.

create table app.marketplace_avisos (
  id          bigserial primary key,
  canal       text not null references app.canais(codigo),
  chave       text not null,                -- identifica o aviso (o mesmo aviso reenviado não entra duas vezes)
  payload     jsonb not null,
  recebido_em timestamptz not null default now(),
  unique (canal, chave)
);

create table app.marketplace_fila (
  id             bigserial primary key,
  canal          text not null references app.canais(codigo),
  numero_externo text not null,
  deposito_id    uuid references app.depositos(id),
  status_externo text,
  situacao       text not null default 'a_separar' check (situacao in ('aguardando', 'a_separar', 'separado', 'cancelado')),
  comprador      text,
  itens          jsonb not null default '[]',   -- [{sku, descricao, quantidade, valor}]
  total          numeric(12,2),
  enviar_ate     timestamptz,
  com_detalhes   boolean not null default false,
  recebido_em    timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  separado_em    timestamptz,
  separado_por   uuid references app.usuarios(id),
  cancelado_depois_de_separar boolean not null default false,
  unique (canal, numero_externo)
);
create index marketplace_fila_abertos on app.marketplace_fila (deposito_id, recebido_em) where situacao in ('a_separar', 'aguardando');

alter table app.marketplace_avisos enable row level security;
alter table app.marketplace_fila enable row level security;
create policy ler on app.marketplace_avisos for select using (app.pode_gerir());
create policy ler on app.marketplace_fila for select using (app.pode_gerir() or app.pode_operar_deposito(deposito_id));
grant select on app.marketplace_avisos, app.marketplace_fila to vc_app;

-- Recebe um aviso do marketplace (chamado pelo webhook, sem usuário logado).
-- p_situacao: 'a_separar' | 'aguardando' | 'cancelado' | null (não sabe ainda: mantém o que já estava; pedido novo entra como 'a_separar').
-- p_detalhes (opcional): {comprador, itens, total, enviar_ate}.
-- Devolve o id na fila, ou null quando o aviso é repetido.
create or replace function app.marketplace_receber(p_canal text, p_numero text, p_chave text, p_status_externo text,
                                                   p_situacao text, p_payload jsonb, p_detalhes jsonb default null)
returns bigint language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id bigint; v_antes app.marketplace_fila; v_evento text; v_situacao text;
begin
  if not exists (select 1 from app.canais where codigo = p_canal and marketplace) then raise exception 'Canal de marketplace desconhecido.'; end if;
  p_numero := nullif(left(trim(coalesce(p_numero, '')), 60), '');
  if p_numero is null then raise exception 'Aviso sem número de pedido.'; end if;
  if p_situacao is not null and p_situacao not in ('a_separar', 'aguardando', 'cancelado') then raise exception 'Situação inválida: %', p_situacao; end if;

  insert into app.marketplace_avisos (canal, chave, payload) values (p_canal, left(coalesce(p_chave, md5(p_payload::text)), 200), coalesce(p_payload, '{}'))
  on conflict (canal, chave) do nothing;
  if not found then return null; end if;

  select * into v_antes from app.marketplace_fila where canal = p_canal and numero_externo = p_numero for update;
  if v_antes.id is null then
    insert into app.marketplace_fila (canal, numero_externo, deposito_id, status_externo, situacao)
    values (p_canal, p_numero, (select deposito_id from app.canais where codigo = p_canal), left(p_status_externo, 60), coalesce(p_situacao, 'a_separar'))
    returning id into v_id;
    v_evento := 'novo';
    v_situacao := coalesce(p_situacao, 'a_separar');
  else
    v_id := v_antes.id;
    -- separado só volta atrás por cancelamento; cancelado não "descancela"
    v_situacao := case
      when p_situacao is null then v_antes.situacao
      when v_antes.situacao = 'cancelado' then 'cancelado'
      when v_antes.situacao = 'separado' and p_situacao <> 'cancelado' then 'separado'
      else p_situacao end;
    update app.marketplace_fila set status_externo = coalesce(left(p_status_externo, 60), status_externo), situacao = v_situacao,
           cancelado_depois_de_separar = cancelado_depois_de_separar or (v_antes.situacao = 'separado' and v_situacao = 'cancelado'),
           atualizado_em = now()
     where id = v_id;
    v_evento := case when v_situacao = 'cancelado' and v_antes.situacao <> 'cancelado' then 'cancelado'
                     when v_antes.situacao = 'aguardando' and v_situacao = 'a_separar' then 'novo'
                     else 'atualizado' end;
  end if;

  if p_detalhes is not null and jsonb_typeof(p_detalhes) = 'object' then
    update app.marketplace_fila set
      comprador  = coalesce(left(nullif(p_detalhes->>'comprador', ''), 120), comprador),
      itens      = case when jsonb_typeof(p_detalhes->'itens') = 'array' then p_detalhes->'itens' else itens end,
      total      = coalesce(nullif(p_detalhes->>'total', '')::numeric, total),
      enviar_ate = coalesce(nullif(p_detalhes->>'enviar_ate', '')::timestamptz, enviar_ate),
      com_detalhes = com_detalhes or jsonb_typeof(p_detalhes->'itens') = 'array'
     where id = v_id;
  end if;

  perform pg_notify('marketplace_fila', json_build_object('id', v_id, 'evento', v_evento, 'situacao', v_situacao)::text);
  return v_id;
end $$;

-- Estoquista marca o pedido do marketplace como separado (sai da fila de todas as telas abertas).
create or replace function app.marketplace_marcar_separado(p_id bigint) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare f app.marketplace_fila;
begin
  select * into f from app.marketplace_fila where id = p_id for update;
  if f.id is null then raise exception 'Pedido não encontrado na fila.'; end if;
  if not (coalesce(app.pode_gerir(), false) or app.pode_operar_deposito(f.deposito_id)) then
    raise exception 'Só quem opera o estoque da unidade marca pedido separado.' using errcode = 'insufficient_privilege';
  end if;
  if f.situacao = 'cancelado' then raise exception 'Este pedido foi cancelado no marketplace: não separe.'; end if;
  if f.situacao = 'separado' then return; end if;
  update app.marketplace_fila set situacao = 'separado', separado_em = now(), separado_por = app.uid(), atualizado_em = now() where id = p_id;
  perform pg_notify('marketplace_fila', json_build_object('id', p_id, 'evento', 'separado', 'situacao', 'separado')::text);
end $$;

-- Cancelado depois de separado: estoquista confirma que devolveu à prateleira (some do aviso).
create or replace function app.marketplace_confirmar_devolucao(p_id bigint) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare f app.marketplace_fila;
begin
  select * into f from app.marketplace_fila where id = p_id for update;
  if f.id is null then raise exception 'Pedido não encontrado na fila.'; end if;
  if not (coalesce(app.pode_gerir(), false) or app.pode_operar_deposito(f.deposito_id)) then
    raise exception 'Sem permissão.' using errcode = 'insufficient_privilege';
  end if;
  update app.marketplace_fila set cancelado_depois_de_separar = false, atualizado_em = now() where id = p_id;
  perform pg_notify('marketplace_fila', json_build_object('id', p_id, 'evento', 'atualizado', 'situacao', f.situacao)::text);
end $$;

revoke execute on function app.marketplace_receber(text, text, text, text, text, jsonb, jsonb),
                           app.marketplace_marcar_separado(bigint), app.marketplace_confirmar_devolucao(bigint) from public;
grant execute on function app.marketplace_receber(text, text, text, text, text, jsonb, jsonb),
                          app.marketplace_marcar_separado(bigint), app.marketplace_confirmar_devolucao(bigint) to vc_app;
