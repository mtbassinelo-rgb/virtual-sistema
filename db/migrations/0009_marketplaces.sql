-- =====================================================================
-- Migração 0009: pedidos de marketplace (Shopee, Mercado Livre...) vindos do Bling
--
-- * Cada loja do Bling é ligada a um canal, com depósito e "vendedora" responsável.
-- * Ao chegar um pedido novo de marketplace: itens mapeados pelo código (SKU),
--   kits desmontados nos componentes e saída do estoque do depósito do canal.
-- * Sem estoque suficiente no sistema, a sincronização NÃO trava: a diferença vira
--   uma pendência de estoque para conferir (o Bling continua sendo o oficial na fase A).
-- * Pedido cancelado no Bling devolve a mercadoria ao estoque.
-- * SKU desconhecido também vira pendência, para cadastrar o produto ou o vínculo.
-- =====================================================================

alter table app.canais add column deposito_id uuid references app.depositos(id);
alter table app.canais add column vendedora_id uuid references app.vendedoras(id);
alter table app.pedidos add column estoque_baixado boolean not null default false;

-- Responsável pelos pedidos de marketplace (aparece como "vendedora" Marketplace)
insert into app.vendedoras (nome, pais, moeda)
select 'Marketplace', 'BR', 'BRL' where not exists (select 1 from app.vendedoras where nome = 'Marketplace');
update app.canais set deposito_id = (select id from app.depositos where codigo = 'cd-foz'),
                      vendedora_id = (select id from app.vendedoras where nome = 'Marketplace')
 where marketplace;

-- Códigos que o marketplace/Bling usa e não batem com o nosso código (ex.: SKU do anúncio)
create table app.produto_codigos (
  codigo      text primary key,
  produto_id  uuid not null references app.produtos(id)
);

-- Situações do Bling: o significado é configurado depois da primeira leitura real
create table app.bling_situacoes (
  id           bigint primary key,
  nome         text not null,
  significado  text not null check (significado in ('aberto','atendido','cancelado','outro'))
);

create table app.estoque_pendencias (
  id           bigserial primary key,
  em           timestamptz not null default now(),
  tipo         text not null check (tipo in ('sem_estoque','sku_desconhecido')),
  pedido_id    uuid references app.pedidos(id),
  deposito_id  uuid references app.depositos(id),
  produto_id   uuid references app.produtos(id),
  codigo       text,
  quantidade   numeric(12,3),
  detalhe      text,
  resolvida_em timestamptz,
  resolvida_por uuid references app.usuarios(id)
);
create index on app.estoque_pendencias (resolvida_em) where resolvida_em is null;

create or replace function app.produto_por_codigo(p_codigo text) returns uuid
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce((select id from app.produtos where codigo = p_codigo),
                  (select produto_id from app.produto_codigos where codigo = p_codigo))
$$;

-- Itens e saída de estoque de um pedido de marketplace (uma única vez por pedido)
create or replace function app.baixar_pedido_marketplace(p_pedido uuid, p_itens jsonb)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; it jsonb; v_prod uuid; v_cod text; v_qtd numeric; c record;
begin
  select * into v_ped from app.pedidos where id = p_pedido for update;
  if v_ped.estoque_baixado or v_ped.deposito_id is null then return; end if;
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    v_cod := coalesce(it->>'codigo', it->'produto'->>'codigo');
    v_qtd := coalesce((it->>'quantidade')::numeric, 0);
    continue when v_qtd <= 0;
    v_prod := app.produto_por_codigo(v_cod);
    if v_prod is null then
      insert into app.estoque_pendencias (tipo, pedido_id, deposito_id, codigo, quantidade, detalhe)
      values ('sku_desconhecido', p_pedido, v_ped.deposito_id, v_cod, v_qtd, coalesce(it->>'descricao', 'Item sem cadastro'));
      continue;
    end if;
    insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario)
    values (p_pedido, v_prod, v_cod, coalesce(it->>'descricao', (select nome from app.produtos where id = v_prod)),
            v_qtd, coalesce((it->>'valor')::numeric, 0));
    for c in select * from app.componentes(v_prod, v_qtd) loop
      begin
        perform app._lancar(v_ped.deposito_id, c.produto_id, 'saida_venda', c.quantidade, 'pedido', p_pedido::text,
                            'Pedido ' || v_ped.canal || coalesce(' ' || v_ped.numero_externo, ''));
      exception when others then
        insert into app.estoque_pendencias (tipo, pedido_id, deposito_id, produto_id, codigo, quantidade, detalhe)
        values ('sem_estoque', p_pedido, v_ped.deposito_id, c.produto_id,
                (select codigo from app.produtos where id = c.produto_id), c.quantidade,
                'Saída não lançada: estoque do sistema insuficiente');
      end;
    end loop;
  end loop;
  update app.pedidos set estoque_baixado = true where id = p_pedido;
end $$;

-- Devolve ao estoque o que saiu por um pedido de marketplace cancelado
create or replace function app.estornar_pedido_marketplace(p_pedido uuid)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare m record;
begin
  if not (select estoque_baixado from app.pedidos where id = p_pedido) then return; end if;
  for m in select deposito_id, produto_id, sum(quantidade) q from app.estoque_movimentos
            where referencia_tipo = 'pedido' and referencia_id = p_pedido::text and tipo = 'saida_venda' group by 1, 2 loop
    perform app._lancar(m.deposito_id, m.produto_id, 'devolucao_cliente', m.q, 'pedido', p_pedido::text, 'Cancelado no marketplace');
  end loop;
  update app.pedidos set estoque_baixado = false where id = p_pedido;
end $$;

-- Sincronização com o Bling (redefinida): pedidos de marketplace entram com itens e baixa de estoque
create or replace function app.bling_upsert_pedido(p jsonb)
returns text language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_id bigint := (p->>'id')::bigint;
  v_hash text := md5(p::text);
  v_old app.bling_pedidos;
  v_vend app.vendedoras;
  v_canal app.canais;
  v_ped uuid;
  v_res text;
  v_cancelado boolean;
begin
  if v_id is null then raise exception 'Pedido do Bling sem id.'; end if;
  select * into v_old from app.bling_pedidos where bling_id = v_id;
  if found and v_old.conteudo_hash = v_hash then
    update app.bling_pedidos set sincronizado_em = now() where bling_id = v_id;
    return 'sem_mudanca';
  end if;

  insert into app.bling_pedidos as b (bling_id, numero, numero_loja, loja_id, data, data_prevista,
      contato_bling_id, contato_nome, vendedor_bling_id, situacao_id, situacao_nome, total, total_produtos,
      itens, payload, conteudo_hash, sincronizado_em, mudou_em)
  values (v_id, (p->>'numero')::bigint, nullif(p->>'numeroLoja',''), nullif((p->'loja'->>'id')::bigint, 0),
      (p->>'data')::date, nullif(p->>'dataPrevista','')::date,
      (p->'contato'->>'id')::bigint, p->'contato'->>'nome', nullif((p->'vendedor'->>'id')::bigint, 0),
      (p->'situacao'->>'id')::bigint,
      coalesce((select nome from app.bling_situacoes where id = (p->'situacao'->>'id')::bigint), p->'situacao'->>'nome', p->'situacao'->>'valor'),
      (p->>'total')::numeric, (p->>'totalProdutos')::numeric,
      coalesce(p->'itens','[]'), p, v_hash, now(), now())
  on conflict (bling_id) do update set
      numero = excluded.numero, numero_loja = excluded.numero_loja, loja_id = excluded.loja_id,
      data = excluded.data, data_prevista = excluded.data_prevista,
      contato_bling_id = excluded.contato_bling_id, contato_nome = excluded.contato_nome,
      vendedor_bling_id = excluded.vendedor_bling_id, situacao_id = excluded.situacao_id,
      situacao_nome = excluded.situacao_nome, total = excluded.total, total_produtos = excluded.total_produtos,
      itens = excluded.itens, payload = excluded.payload, conteudo_hash = excluded.conteudo_hash,
      sincronizado_em = now(), mudou_em = now();
  v_res := case when v_old.bling_id is null then 'criado' else 'atualizado' end;
  v_cancelado := exists (select 1 from app.bling_situacoes where id = (p->'situacao'->>'id')::bigint and significado = 'cancelado');
  select * into v_canal from app.canais where bling_loja_id = nullif((p->'loja'->>'id')::bigint, 0);

  select id into v_ped from app.pedidos where bling_id = v_id;
  if v_ped is null then
    -- Pedido da planilha ou conferido com este número: só liga, sem trocar a origem
    select id into v_ped from app.pedidos where bling_numero = (p->>'numero')::bigint and bling_id is null;
    if v_ped is not null then
      update app.pedidos set bling_id = v_id where id = v_ped;
      return v_res || '_vinculado';
    end if;
    select * into v_vend from app.vendedoras
     where id = coalesce((select id from app.vendedoras where bling_vendedor_id = nullif((p->'vendedor'->>'id')::bigint, 0)),
                         v_canal.vendedora_id);
    if v_vend.id is null then
      return v_res || '_sem_vendedora';         -- fica só na cópia até a vendedora (ou o canal) ser vinculado
    end if;
    insert into app.pedidos (origem, bling_id, bling_numero, canal, numero_externo, cliente_id, vendedora_id,
        data_pedido, moeda, valor_total, previsao_envio, deposito_id, status_comercial)
    values ('bling', v_id, (p->>'numero')::bigint, coalesce(v_canal.codigo,'direto'), nullif(p->>'numeroLoja',''),
        (select id from app.clientes where bling_contato_id = (p->'contato'->>'id')::bigint),
        v_vend.id, (p->>'data')::date, v_vend.moeda, coalesce((p->>'total')::numeric, 0),
        nullif(p->>'dataPrevista','')::date, v_canal.deposito_id,
        case when v_cancelado then 'cancelado'::app.status_comercial
             when coalesce(v_canal.marketplace, false) then 'enviado'::app.status_comercial
             else 'em_separacao'::app.status_comercial end)
    returning id into v_ped;
    -- Marketplace: o pedido já está pago e faturado; registra itens e tira do estoque
    if coalesce(v_canal.marketplace, false) and not v_cancelado then
      perform app.baixar_pedido_marketplace(v_ped, coalesce(p->'itens','[]'));
    end if;
    return v_res;
  else
    update app.pedidos set valor_total = coalesce((p->>'total')::numeric, valor_total),
                           data_pedido = coalesce((p->>'data')::date, data_pedido)
     where id = v_ped and origem = 'bling';
    if v_cancelado then
      perform app.estornar_pedido_marketplace(v_ped);
      update app.pedidos set status_comercial = 'cancelado' where id = v_ped and status_comercial <> 'cancelado';
    end if;
    return v_res;
  end if;
end $$;

create or replace function app.resolver_pendencia(p_id bigint) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.pode_gerir() then raise exception 'Só gerente ou dono resolve pendências.' using errcode = 'insufficient_privilege'; end if;
  update app.estoque_pendencias set resolvida_em = now(), resolvida_por = app.uid() where id = p_id and resolvida_em is null;
end $$;

create trigger auditar after insert or update or delete on app.produto_codigos for each row execute function app.auditar('codigo');
create trigger auditar after insert or update or delete on app.bling_situacoes for each row execute function app.auditar('id');

alter table app.produto_codigos enable row level security;
alter table app.bling_situacoes enable row level security;
alter table app.estoque_pendencias enable row level security;
create policy ler on app.produto_codigos for select using (app.uid() is not null);
create policy gerir on app.produto_codigos for all using (app.pode_gerir()) with check (app.pode_gerir());
create policy ler on app.bling_situacoes for select using (app.uid() is not null);
create policy gerir on app.bling_situacoes for all using (app.pode_gerir()) with check (app.pode_gerir());
create policy ler on app.estoque_pendencias for select using (app.pode_gerir());

grant select, insert, update, delete on app.produto_codigos, app.bling_situacoes to vc_app;
grant select on app.estoque_pendencias to vc_app;
grant update (deposito_id, vendedora_id, bling_loja_id) on app.canais to vc_app;
grant execute on function app.produto_por_codigo(text), app.resolver_pendencia(bigint) to vc_app;
grant execute on function app.produto_por_codigo(text) to vc_sync;
