-- =====================================================================
-- Saldo anterior do cliente: o que ele já devia antes do sistema (lançado à mão pela vendedora).
-- Lançamentos de dívida e de pagamento; saldo = dívidas − pagamentos. Não é venda (não entra em vendas,
-- lucro nem metas), mas entra no contas a receber, na ficha do cliente e na área do cliente na loja.
-- =====================================================================
create table app.saldos_anteriores (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references app.clientes(id),
  tipo          text not null check (tipo in ('divida', 'pagamento')),
  moeda         app.moeda not null,
  valor         numeric(16,2) not null check (valor > 0),
  data          date not null default current_date,
  vencimento    date,
  descricao     text check (length(descricao) <= 300),
  criado_por    uuid references app.usuarios(id),
  criado_em     timestamptz not null default now(),
  cancelado_em  timestamptz,
  cancelado_por uuid references app.usuarios(id)
);
create index on app.saldos_anteriores (cliente_id) where cancelado_em is null;
alter table app.saldos_anteriores enable row level security;
-- vê quem vê o cliente (a vendedora dele, gestão)
create policy ler on app.saldos_anteriores for select using (exists (select 1 from app.clientes c where c.id = cliente_id));
grant select on app.saldos_anteriores to vc_app;
create trigger auditar after insert or update or delete on app.saldos_anteriores for each row execute function app.auditar('id');

create or replace function app.lancar_saldo_anterior(p_cliente uuid, p_tipo text, p_moeda app.moeda, p_valor numeric,
  p_data date default null, p_vencimento date default null, p_descricao text default null) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_cli app.clientes; v_id uuid;
begin
  if not coalesce(app.pode_escrever(), false) then raise exception 'Sem permissão.' using errcode = 'insufficient_privilege'; end if;
  select * into v_cli from app.clientes where id = p_cliente and mesclado_em is null;
  if v_cli.id is null then raise exception 'Cliente não encontrado.'; end if;
  if not (coalesce(app.pode_gerir(), false) or v_cli.vendedora_id = app.minha_vendedora()) then
    raise exception 'Este cliente é de outra vendedora.' using errcode = 'insufficient_privilege';
  end if;
  if p_tipo not in ('divida', 'pagamento') then raise exception 'Tipo inválido.'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor.'; end if;
  if p_tipo = 'divida' and nullif(trim(coalesce(p_descricao, '')), '') is null then
    raise exception 'Diga de onde vem a dívida (ex.: saldo de setembro, pedido de 15/09).';
  end if;
  insert into app.saldos_anteriores (cliente_id, tipo, moeda, valor, data, vencimento, descricao, criado_por)
  values (p_cliente, p_tipo, coalesce(p_moeda, v_cli.moeda), round(p_valor, 2), coalesce(p_data, current_date), p_vencimento,
          nullif(left(trim(coalesce(p_descricao, '')), 300), ''), app.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Cancelar um lançamento errado: gestão, ou quem lançou
create or replace function app.cancelar_saldo_anterior(p_id uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  update app.saldos_anteriores set cancelado_em = now(), cancelado_por = app.uid()
   where id = p_id and cancelado_em is null and app.perfil_atual() is not null
     and (coalesce(app.pode_gerir(), false) or criado_por = app.uid());
  if not found then raise exception 'Lançamento não encontrado, já cancelado, ou lançado por outra pessoa.'; end if;
end $$;

-- Saldo anterior em aberto por cliente e moeda
create or replace view app.v_saldo_anterior with (security_invoker = true) as
select s.cliente_id, s.moeda,
       sum(case when s.tipo = 'divida' then s.valor else -s.valor end) as saldo,
       min(s.vencimento) filter (where s.tipo = 'divida') as vencimento,
       max(s.data) as ultimo
  from app.saldos_anteriores s
 where s.cancelado_em is null
 group by 1, 2;
grant select on app.v_saldo_anterior to vc_app;

-- Área do cliente: os lançamentos dele
create or replace function app.portal_saldo_anterior(p_sessao_hash text)
returns table (data date, tipo text, descricao text, moeda app.moeda, valor numeric, vencimento date)
language sql stable security definer set search_path = app, pg_temp as $$
  select s.data, s.tipo, s.descricao, s.moeda, s.valor, s.vencimento from app.saldos_anteriores s
   where s.cliente_id = app.portal_cliente_id(p_sessao_hash) and s.cancelado_em is null
   order by s.data, s.criado_em
$$;

revoke execute on function app.lancar_saldo_anterior(uuid, text, app.moeda, numeric, date, date, text), app.cancelar_saldo_anterior(uuid),
  app.portal_saldo_anterior(text) from public;
grant execute on function app.lancar_saldo_anterior(uuid, text, app.moeda, numeric, date, date, text), app.cancelar_saldo_anterior(uuid),
  app.portal_saldo_anterior(text) to vc_app;
