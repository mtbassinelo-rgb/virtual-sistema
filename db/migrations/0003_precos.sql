-- =====================================================================
-- Migração 0003: produtos, tabelas de preço por moeda e itens de pedido
--
-- No cadastro do cliente ficam o País (define a moeda) e a categoria de preço
-- (Normal ou VIP). A tabela usada é a combinação dos dois:
--   Paraguai: py_normal, py_vip (Gs)   ·   Brasil: br_normal, br_vip (R$)
-- Os preços vêm prontos da tabela oficial (aba Preços); o sistema não converte
-- moeda na hora da venda. O preço usado num pedido fica congelado no item.
-- =====================================================================

create table app.produtos (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique,          -- ex.: RHE-001
  nome             text not null,
  fornecedor       text,
  bling_produto_id bigint unique,
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now()
);

create table app.tabelas_preco (
  codigo  text primary key,
  nome    text not null,
  moeda   app.moeda not null,
  pais    app.pais not null
);
insert into app.tabelas_preco values
  ('py_normal','Paraguai · Normal','GS','PY'),
  ('py_vip','Paraguai · VIP','GS','PY'),
  ('br_normal','Brasil · Normal','BRL','BR'),
  ('br_vip','Brasil · VIP','BRL','BR');

-- Histórico de preços: um novo preço passa a valer a partir de uma data,
-- sem apagar o anterior.
create table app.precos (
  produto_id     uuid not null references app.produtos(id),
  tabela         text not null references app.tabelas_preco(codigo),
  valor          numeric(14,2) not null check (valor > 0),
  vigente_desde  date not null default current_date,
  definido_por   uuid references app.usuarios(id),
  primary key (produto_id, tabela, vigente_desde)
);

create type app.categoria_preco as enum ('normal','vip');

-- Cadastro do cliente: país e categoria de preço. A tabela é derivada.
alter table app.clientes add column pais app.pais;
alter table app.clientes add column categoria_preco app.categoria_preco not null default 'normal';
update app.clientes c set pais = v.pais from app.vendedoras v where v.id = c.vendedora_id and c.pais is null;

-- Cliente novo sem país herda o país da vendedora
create or replace function app.pais_padrao_cliente() returns trigger language plpgsql as $$
begin
  if new.pais is null then
    select pais into new.pais from app.vendedoras where id = new.vendedora_id;
  end if;
  return new;
end $$;
create trigger pais_padrao before insert on app.clientes
  for each row execute function app.pais_padrao_cliente();
alter table app.clientes alter column pais set not null;
alter table app.clientes add column tabela_preco text
  generated always as (case
    when pais = 'PY' and categoria_preco = 'vip' then 'py_vip'
    when pais = 'PY' then 'py_normal'
    when categoria_preco = 'vip' then 'br_vip'
    else 'br_normal' end) stored
  references app.tabelas_preco(codigo);
alter table app.clientes add column moeda app.moeda
  generated always as (case pais when 'PY' then 'GS'::app.moeda else 'BRL'::app.moeda end) stored;

-- Preço vigente de um produto para um cliente (na moeda da tabela dele)
create or replace function app.preco_para_cliente(p_cliente uuid, p_produto uuid, p_data date default current_date)
returns table (valor numeric, moeda app.moeda, tabela text)
language sql stable as $$
  select pr.valor, t.moeda, t.codigo
    from app.clientes c
    join app.tabelas_preco t on t.codigo = c.tabela_preco
    join app.precos pr on pr.tabela = t.codigo and pr.produto_id = p_produto and pr.vigente_desde <= p_data
   where c.id = p_cliente
   order by pr.vigente_desde desc
   limit 1
$$;

-- Itens do pedido, com preço congelado
create table app.pedido_itens (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references app.pedidos(id),
  produto_id      uuid references app.produtos(id),
  codigo          text,
  descricao       text not null,
  quantidade      numeric(12,3) not null check (quantidade > 0),
  preco_unitario  numeric(14,2) not null check (preco_unitario >= 0),
  tabela_preco    text references app.tabelas_preco(codigo),
  desconto        numeric(14,2) not null default 0 check (desconto >= 0),
  total           numeric(14,2) generated always as (round(quantidade * preco_unitario - desconto, 2)) stored
);
create index on app.pedido_itens (pedido_id);

-- O item precisa estar na moeda do pedido
create or replace function app.validar_item() returns trigger language plpgsql as $$
declare v_moeda_ped app.moeda; v_moeda_tab app.moeda;
begin
  select moeda into v_moeda_ped from app.pedidos where id = new.pedido_id;
  if new.tabela_preco is not null then
    select moeda into v_moeda_tab from app.tabelas_preco where codigo = new.tabela_preco;
    if v_moeda_tab <> v_moeda_ped then
      raise exception 'Preço em % não pode entrar num pedido em %.', v_moeda_tab, v_moeda_ped;
    end if;
  end if;
  if current_user in ('vc_app','vc_sync')
     and exists (select 1 from app.pedidos where id = new.pedido_id and origem = 'bling') then
    raise exception 'Itens de pedido do Bling só mudam no Bling.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger validar before insert or update on app.pedido_itens
  for each row execute function app.validar_item();

-- Auditoria
create trigger auditar after insert or update or delete on app.produtos    for each row execute function app.auditar('id');
create trigger auditar after insert or update or delete on app.precos      for each row execute function app.auditar('produto_id');
create trigger auditar after insert or update or delete on app.pedido_itens for each row execute function app.auditar('id');

-- Permissões: todos leem produtos e preços; só gestão altera preços
alter table app.produtos enable row level security;
alter table app.tabelas_preco enable row level security;
alter table app.precos enable row level security;
alter table app.pedido_itens enable row level security;

create policy ler on app.produtos for select using (app.uid() is not null);
create policy gerir on app.produtos for all using (app.pode_gerir()) with check (app.pode_gerir());
create policy ler on app.tabelas_preco for select using (app.uid() is not null);
create policy ler on app.precos for select using (app.uid() is not null);
create policy gerir on app.precos for all using (app.pode_gerir()) with check (app.pode_gerir());
create policy ler on app.pedido_itens for select using (exists (select 1 from app.pedidos p where p.id = pedido_id));
create policy escrever on app.pedido_itens for all
  using (app.pode_escrever() and exists (select 1 from app.pedidos p where p.id = pedido_id))
  with check (app.pode_escrever() and exists (select 1 from app.pedidos p where p.id = pedido_id));

grant select on app.produtos, app.tabelas_preco, app.precos, app.pedido_itens to vc_app;
grant insert, update on app.produtos, app.precos to vc_app;
grant insert, update, delete on app.pedido_itens to vc_app;
grant select on app.produtos to vc_sync;
grant execute on function app.preco_para_cliente(uuid, uuid, date) to vc_app;
grant execute on function app.pais_padrao_cliente(), app.validar_item() to vc_app, vc_sync;
