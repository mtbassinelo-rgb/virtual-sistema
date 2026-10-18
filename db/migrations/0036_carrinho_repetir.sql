-- Área do cliente: "Pedir de novo" e carrinho guardado (para a vendedora ver carrinhos parados).

-- Itens de um pedido do próprio cliente, para montar o carrinho de novo
create or replace function app.portal_itens_pedido(p_sessao_hash text, p_pedido uuid)
returns table (produto_id uuid, quantidade numeric)
language sql stable security definer set search_path = app, pg_temp as $$
  select i.produto_id, sum(i.quantidade)
    from app.pedido_itens i join app.pedidos p on p.id = i.pedido_id
   where p.id = p_pedido and p.cliente_id = app.portal_cliente_id(p_sessao_hash) and i.produto_id is not null
   group by i.produto_id
$$;

-- Carrinho do cliente logado (um por cliente). Some quando o pedido é enviado ou o carrinho esvazia.
create table app.carrinhos (
  cliente_id     uuid primary key references app.clientes(id),
  itens          jsonb not null check (jsonb_typeof(itens) = 'array'),
  atualizado_em  timestamptz not null default now(),
  avisado_em     timestamptz            -- quando a vendedora chamou o cliente
);
alter table app.carrinhos enable row level security;   -- acesso só pelas funções

create or replace function app.portal_salvar_carrinho(p_sessao_hash text, p_itens jsonb) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_cli uuid := app.portal_cliente_id(p_sessao_hash); v jsonb;
begin
  if v_cli is null then return; end if;
  -- só o essencial: produto e quantidade (até 200 itens)
  select coalesce(jsonb_agg(jsonb_build_object('produto_id', x->>'produto_id', 'qtd', (x->>'qtd')::numeric)), '[]') into v
    from (select x from jsonb_array_elements(coalesce(p_itens, '[]')) x
           where (x->>'produto_id') ~ '^[0-9a-f-]{36}$' and (x->>'qtd') ~ '^[0-9]+(\.[0-9]+)?$' limit 200) s;
  if jsonb_array_length(v) = 0 then
    delete from app.carrinhos where cliente_id = v_cli;
  else
    insert into app.carrinhos (cliente_id, itens) values (v_cli, v)
    on conflict (cliente_id) do update set itens = excluded.itens, atualizado_em = now(),
      avisado_em = case when app.carrinhos.itens = excluded.itens then app.carrinhos.avisado_em end;
  end if;
end $$;

-- Pedido enviado pela área do cliente: o carrinho guardado some
create or replace function app.limpar_carrinho_pedido() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if new.cliente_id is not null then delete from app.carrinhos where cliente_id = new.cliente_id; end if;
  return new;
end $$;
create trigger limpar_carrinho after insert on app.pedidos for each row execute function app.limpar_carrinho_pedido();

-- Para a equipe: carrinhos parados há mais de 2 horas (cada vendedora vê os seus clientes)
create or replace function app.carrinhos_parados()
returns table (cliente_id uuid, cliente text, whatsapp text, vendedora text, itens int, pecas numeric,
               produtos text, atualizado_em timestamptz, avisado_em timestamptz)
language sql stable security definer set search_path = app, pg_temp as $$
  select c.id, c.nome, coalesce(c.whatsapp, c.telefone), v.nome, jsonb_array_length(k.itens),
         (select sum((x->>'qtd')::numeric) from jsonb_array_elements(k.itens) x),
         (select string_agg(p.nome, ' · ' order by p.nome) from jsonb_array_elements(k.itens) x join app.produtos p on p.id = (x->>'produto_id')::uuid),
         k.atualizado_em, k.avisado_em
    from app.carrinhos k join app.clientes c on c.id = k.cliente_id join app.vendedoras v on v.id = c.vendedora_id
   where app.uid() is not null and app.ve_pedido(c.vendedora_id)
     and k.atualizado_em < now() - interval '2 hours'
   order by k.avisado_em nulls first, k.atualizado_em desc
$$;

create or replace function app.marcar_carrinho_avisado(p_cliente uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not exists (select 1 from app.clientes where id = p_cliente and app.ve_pedido(vendedora_id)) then
    raise exception 'Sem permissão.' using errcode = 'insufficient_privilege';
  end if;
  update app.carrinhos set avisado_em = now() where cliente_id = p_cliente;
end $$;

grant execute on function app.portal_itens_pedido(text, uuid), app.portal_salvar_carrinho(text, jsonb),
  app.carrinhos_parados(), app.marcar_carrinho_avisado(uuid) to vc_app;
