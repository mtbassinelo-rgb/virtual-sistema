-- =====================================================================
-- Orçamento da vendedora: monta os produtos com os preços de uma tabela (PY/BR/CDE, Normal/VIP) para alguém que
-- ainda pode não ser cliente (nome e WhatsApp), manda pelo WhatsApp ou imprime, depois vincula a um cliente
-- e transforma em pedido. Ao vincular, os preços passam a ser os da tabela do cliente.
-- =====================================================================
create table app.orcamentos (
  id               uuid primary key default gen_random_uuid(),
  numero           bigserial unique,
  vendedora_id     uuid not null references app.vendedoras(id),
  cliente_id       uuid references app.clientes(id),
  contato_nome     text check (length(contato_nome) <= 120),
  contato_whatsapp text check (length(contato_whatsapp) <= 30),
  tabela           text not null references app.tabelas_preco(codigo),
  deposito_id      uuid references app.depositos(id),
  validade         date,
  observacoes      text check (length(observacoes) <= 1000),
  status           text not null default 'aberto' check (status in ('aberto', 'convertido', 'cancelado')),
  pedido_id        uuid references app.pedidos(id),
  total            numeric(16,2) not null default 0,
  criado_por       uuid references app.usuarios(id),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  constraint tem_destinatario check (cliente_id is not null or nullif(trim(contato_nome), '') is not null)
);
create index on app.orcamentos (vendedora_id, criado_em desc);

create table app.orcamento_itens (
  orcamento_id   uuid not null references app.orcamentos(id) on delete cascade,
  ordem          int not null,
  produto_id     uuid not null references app.produtos(id),
  descricao      text not null,
  quantidade     numeric(12,3) not null check (quantidade > 0),
  preco_unitario numeric(14,2),
  primary key (orcamento_id, ordem)
);

alter table app.orcamentos enable row level security;
alter table app.orcamento_itens enable row level security;
create policy ler on app.orcamentos for select using (app.e_gestao() or vendedora_id = app.minha_vendedora());
create policy ler on app.orcamento_itens for select using (exists (select 1 from app.orcamentos o where o.id = orcamento_id));
grant select on app.orcamentos, app.orcamento_itens to vc_app;
create trigger auditar after insert or update or delete on app.orcamentos for each row execute function app.auditar('id');

-- Recalcula os preços: do cliente (se vinculado) ou da tabela escolhida
create or replace function app._precificar_orcamento(p_id uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare o app.orcamentos; v_moeda app.moeda;
begin
  select * into o from app.orcamentos where id = p_id;
  select moeda into v_moeda from app.tabelas_preco where codigo = o.tabela;
  if o.cliente_id is not null then
    update app.orcamento_itens i set preco_unitario = (select f.preco from app.preco_final_moeda(o.cliente_id, i.produto_id, v_moeda) f)
     where i.orcamento_id = p_id;
  else
    update app.orcamento_itens i set preco_unitario = (select z.valor from app.precos z where z.produto_id = i.produto_id and z.tabela = o.tabela
                                                          and z.vigente_desde <= current_date order by z.vigente_desde desc limit 1)
     where i.orcamento_id = p_id;
  end if;
  update app.orcamentos set total = coalesce((select round(sum(quantidade * coalesce(preco_unitario, 0)), 2) from app.orcamento_itens where orcamento_id = p_id), 0),
         atualizado_em = now() where id = p_id;
end $$;

-- Cria ou atualiza. p: {cliente_id, contato_nome, contato_whatsapp, tabela, deposito_id, validade, observacoes,
--                      itens:[{produto_id, quantidade | caixas}]}
create or replace function app.salvar_orcamento(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id uuid := p_id; o app.orcamentos; v_vend uuid; it jsonb; v_prod app.produtos; v_qtd numeric; k int := 0;
        v_cli app.clientes; v_tab text := nullif(p->>'tabela', '');
begin
  if not app.pode_escrever() then raise exception 'Sem permissão.' using errcode = 'insufficient_privilege'; end if;
  if nullif(p->>'cliente_id', '') is not null then
    select * into v_cli from app.clientes where id = (p->>'cliente_id')::uuid and mesclado_em is null;
    if v_cli.id is null then raise exception 'Cliente não encontrado.'; end if;
    v_tab := coalesce(v_tab, v_cli.tabela_preco);
  end if;
  if v_tab is null or not exists (select 1 from app.tabelas_preco where codigo = v_tab) then raise exception 'Escolha a tabela de preço.'; end if;
  if v_cli.id is null and nullif(trim(coalesce(p->>'contato_nome', '')), '') is null then raise exception 'Informe o cliente ou o nome do contato.'; end if;
  v_vend := coalesce(app.minha_vendedora(), v_cli.vendedora_id);
  if v_vend is null then raise exception 'Escolha um cliente (o orçamento fica com a vendedora dele).'; end if;
  if v_id is null then
    insert into app.orcamentos (vendedora_id, cliente_id, contato_nome, contato_whatsapp, tabela, deposito_id, validade, observacoes, criado_por)
    values (v_vend, v_cli.id, nullif(left(trim(coalesce(p->>'contato_nome', '')), 120), ''), nullif(left(trim(coalesce(p->>'contato_whatsapp', '')), 30), ''),
            v_tab, nullif(p->>'deposito_id', '')::uuid, coalesce(nullif(p->>'validade', '')::date, current_date + 7),
            nullif(left(trim(coalesce(p->>'observacoes', '')), 1000), ''), app.uid())
    returning id into v_id;
  else
    select * into o from app.orcamentos where id = v_id for update;
    if o.id is null then raise exception 'Orçamento não encontrado.'; end if;
    if not (app.pode_gerir() or o.vendedora_id = app.minha_vendedora()) then raise exception 'Este orçamento é de outra vendedora.' using errcode = 'insufficient_privilege'; end if;
    if o.status <> 'aberto' then raise exception 'Orçamento já virou pedido ou foi cancelado.'; end if;
    update app.orcamentos set cliente_id = v_cli.id, contato_nome = nullif(left(trim(coalesce(p->>'contato_nome', '')), 120), ''),
           contato_whatsapp = nullif(left(trim(coalesce(p->>'contato_whatsapp', '')), 30), ''), tabela = v_tab,
           deposito_id = nullif(p->>'deposito_id', '')::uuid, validade = coalesce(nullif(p->>'validade', '')::date, validade),
           observacoes = nullif(left(trim(coalesce(p->>'observacoes', '')), 1000), '') where id = v_id;
    delete from app.orcamento_itens where orcamento_id = v_id;
  end if;
  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]')) loop
    select * into v_prod from app.produtos where id = nullif(it->>'produto_id', '')::uuid and ativo;
    continue when v_prod.id is null;
    v_qtd := coalesce(nullif(it->>'quantidade', '')::numeric, nullif(it->>'caixas', '')::numeric * coalesce(v_prod.unidades_caixa, 1));
    continue when v_qtd is null or v_qtd <= 0;
    k := k + 1;
    insert into app.orcamento_itens (orcamento_id, ordem, produto_id, descricao, quantidade) values (v_id, k, v_prod.id, v_prod.nome, v_qtd);
  end loop;
  if k = 0 then raise exception 'Coloque pelo menos um produto com quantidade.'; end if;
  perform app._precificar_orcamento(v_id);
  return v_id;
end $$;

-- Vincula a um cliente (os preços passam a ser os da tabela dele)
create or replace function app.vincular_orcamento(p_id uuid, p_cliente uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare o app.orcamentos; v_cli app.clientes;
begin
  select * into o from app.orcamentos where id = p_id for update;
  if o.id is null then raise exception 'Orçamento não encontrado.'; end if;
  if not (app.pode_gerir() or o.vendedora_id = app.minha_vendedora()) or app.perfil_atual() is null then
    raise exception 'Este orçamento é de outra vendedora.' using errcode = 'insufficient_privilege';
  end if;
  if o.status <> 'aberto' then raise exception 'Orçamento já virou pedido ou foi cancelado.'; end if;
  select * into v_cli from app.clientes where id = p_cliente and mesclado_em is null;
  if v_cli.id is null then raise exception 'Cliente não encontrado.'; end if;
  update app.orcamentos set cliente_id = v_cli.id, tabela = v_cli.tabela_preco, vendedora_id = coalesce(app.minha_vendedora(), v_cli.vendedora_id) where id = p_id;
  perform app._precificar_orcamento(p_id);
end $$;

-- Vira pedido (precisa de cliente). Usa a criação normal do pedido da vendedora.
create or replace function app.converter_orcamento(p_id uuid, p_deposito uuid, p_previsao date, p_para_cliente boolean default false) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare o app.orcamentos; v_ped uuid; v_moeda app.moeda;
begin
  select * into o from app.orcamentos where id = p_id for update;
  if o.id is null then raise exception 'Orçamento não encontrado.'; end if;
  if not (app.pode_gerir() or o.vendedora_id = app.minha_vendedora()) or app.perfil_atual() is null then
    raise exception 'Este orçamento é de outra vendedora.' using errcode = 'insufficient_privilege';
  end if;
  if o.status <> 'aberto' then raise exception 'Orçamento já virou pedido ou foi cancelado.'; end if;
  if o.cliente_id is null then raise exception 'Vincule o orçamento a um cliente antes de virar pedido.'; end if;
  select moeda into v_moeda from app.tabelas_preco where codigo = o.tabela;
  v_ped := app.criar_pedido_vendedora(o.cliente_id, v_moeda, coalesce(p_deposito, o.deposito_id), p_previsao,
             concat_ws(' · ', 'Orçamento nº ' || o.numero, o.observacoes),
             (select jsonb_agg(jsonb_build_object('produto_id', produto_id, 'quantidade', quantidade) order by ordem) from app.orcamento_itens where orcamento_id = p_id),
             coalesce(p_para_cliente, false));
  update app.orcamentos set status = 'convertido', pedido_id = v_ped, atualizado_em = now() where id = p_id;
  return v_ped;
end $$;

create or replace function app.cancelar_orcamento(p_id uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  update app.orcamentos set status = 'cancelado', atualizado_em = now()
   where id = p_id and status = 'aberto' and (app.pode_gerir() or vendedora_id = app.minha_vendedora()) and app.perfil_atual() is not null;
  if not found then raise exception 'Orçamento não encontrado ou já fechado.'; end if;
end $$;

revoke execute on function app._precificar_orcamento(uuid), app.salvar_orcamento(uuid, jsonb), app.vincular_orcamento(uuid, uuid),
  app.converter_orcamento(uuid, uuid, date, boolean), app.cancelar_orcamento(uuid) from public;
grant execute on function app.salvar_orcamento(uuid, jsonb), app.vincular_orcamento(uuid, uuid),
  app.converter_orcamento(uuid, uuid, date, boolean), app.cancelar_orcamento(uuid) to vc_app;
