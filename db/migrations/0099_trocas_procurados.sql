-- =====================================================================
-- Migração 0099: produto sem estoque no pedido → troca com comprovante ou
-- remoção autorizada (vai para os procurados sem estoque)
--
-- 1. Trocar produto/aroma: a vendedora escolhe o substituto e anexa o print da
--    conversa com o cliente (obrigatório). O preço é o da tabela do cliente.
-- 2. Tirar do pedido: a vendedora pede; gerente ou dono autoriza. Ao autorizar,
--    o item sai do pedido (o cliente vê como indisponível) e vai para a lista
--    de procurados sem estoque.
-- 3. Lista de procurados (já existente) recebe os itens tirados; a tela soma
--    por marca na semana para a compra de quarta/quinta.
-- =====================================================================

create table if not exists app.pedido_trocas (
  id               uuid primary key default gen_random_uuid(),
  pedido_id        uuid not null references app.pedidos(id) on delete cascade,
  item_id          uuid,
  produto_antes    uuid references app.produtos(id) on delete set null,
  descricao_antes  text not null,
  quantidade_antes numeric(12,3) not null,
  preco_antes      numeric(14,2),
  produto_depois   uuid references app.produtos(id) on delete set null,
  descricao_depois text not null,
  quantidade       numeric(12,3) not null check (quantidade > 0),
  preco_depois     numeric(14,2) not null,
  arquivo          text not null,
  nome_original    text,
  mime             text not null,
  tamanho          int,
  sha256           text not null,
  observacao       text,
  feito_por        uuid references app.usuarios(id),
  feito_em         timestamptz not null default now()
);
create index if not exists pedido_trocas_pedido on app.pedido_trocas (pedido_id);
alter table app.pedido_trocas enable row level security;
drop policy if exists ler on app.pedido_trocas;
create policy ler on app.pedido_trocas for select using (exists (select 1 from app.pedidos p where p.id = pedido_id));
grant select on app.pedido_trocas to vc_app;

create table if not exists app.pedido_remocoes (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references app.pedidos(id) on delete cascade,
  item_id         uuid not null,
  produto_id      uuid references app.produtos(id) on delete set null,
  descricao       text not null,
  quantidade      numeric(12,3) not null,
  motivo          text,
  pedido_por      uuid references app.usuarios(id),
  pedido_em       timestamptz not null default now(),
  status          text not null default 'pendente' check (status in ('pendente','aprovada','recusada')),
  decidido_por    uuid references app.usuarios(id),
  decidido_em     timestamptz,
  motivo_decisao  text
);
create index if not exists pedido_remocoes_pedido on app.pedido_remocoes (pedido_id);
create unique index if not exists pedido_remocoes_uma_pendente on app.pedido_remocoes (item_id) where status = 'pendente';
alter table app.pedido_remocoes enable row level security;
drop policy if exists ler on app.pedido_remocoes;
create policy ler on app.pedido_remocoes for select using (exists (select 1 from app.pedidos p where p.id = pedido_id));
grant select on app.pedido_remocoes to vc_app;

-- Produtos tirados do pedido entram na lista de procurados (tela "Procurados sem estoque"),
-- junto com os pedidos avulsos das vendedoras e os "Quero este produto" do site.
alter table app.procuras add column if not exists pedido_id uuid references app.pedidos(id) on delete set null;
alter table app.procuras drop constraint if exists procuras_origem_check;
alter table app.procuras add constraint procuras_origem_check check (origem in ('site','portal','vendedora','pedido'));

-- Pedido em que a vendedora ainda pode mexer nos itens (antes do total ir ao cliente)
create or replace function app._pedido_editavel_itens(p_pedido uuid) returns app.pedidos
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos;
begin
  select * into v_ped from app.pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if v_ped.origem = 'bling' then raise exception 'Itens de pedido do Bling só mudam no Bling.'; end if;
  if v_ped.status_comercial::text not in ('aguardando_cliente','aguardando_aprovacao','em_separacao') then
    raise exception 'Só dá para mudar itens antes do pedido sair (aguardando ou em separação).';
  end if;
  if v_ped.total_confirmado_em is not null then
    raise exception 'O total já foi confirmado ao cliente: mudar itens agora mudaria o valor combinado.';
  end if;
  return v_ped;
end $$;

create or replace function app._recalcular_total_pedido(p_pedido uuid) returns numeric
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_total numeric;
begin
  select coalesce(sum(total), 0) into v_total from app.pedido_itens where pedido_id = p_pedido;
  update app.pedidos set valor_total = v_total where id = p_pedido;
  return v_total;
end $$;

-- 1. Troca de produto/aroma com comprovante (print da conversa) obrigatório
create or replace function app.trocar_item_pedido(p_item uuid, p_produto uuid, p_quantidade numeric,
  p_arquivo text, p_nome text, p_mime text, p_tamanho int, p_sha text, p_obs text default null) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare it app.pedido_itens; v_ped app.pedidos; v_prod app.produtos; f record; v_q numeric; v_id uuid;
begin
  select * into it from app.pedido_itens where id = p_item;
  if it.id is null then raise exception 'Item não encontrado (talvez já tenha sido trocado ou removido).'; end if;
  v_ped := app._pedido_editavel_itens(it.pedido_id);
  if not (app.pode_escrever() and app.ve_pedido(v_ped.vendedora_id)) then
    raise exception 'Só a vendedora do pedido ou a gerência troca produtos.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_arquivo, '') = '' or coalesce(p_sha, '') = '' then
    raise exception 'Anexe o print da conversa em que o cliente aceitou a troca.';
  end if;
  select * into v_prod from app.produtos where id = p_produto;
  if v_prod.id is null then raise exception 'Produto substituto não encontrado.'; end if;
  if not v_prod.ativo then raise exception 'O produto % está inativo.', v_prod.nome; end if;
  if v_prod.id = it.produto_id then raise exception 'Escolha um produto diferente do atual.'; end if;
  v_q := coalesce(p_quantidade, it.quantidade);
  if v_q <= 0 then raise exception 'Quantidade inválida.'; end if;
  select * into f from app.preco_final_moeda(v_ped.cliente_id, v_prod.id, v_ped.moeda);
  if f.preco is null then
    raise exception 'O produto % não tem preço na tabela deste cliente.', v_prod.nome;
  end if;

  insert into app.pedido_trocas (pedido_id, item_id, produto_antes, descricao_antes, quantidade_antes, preco_antes,
                                 produto_depois, descricao_depois, quantidade, preco_depois,
                                 arquivo, nome_original, mime, tamanho, sha256, observacao, feito_por)
  values (it.pedido_id, it.id, it.produto_id, it.descricao, it.quantidade, it.preco_unitario,
          v_prod.id, v_prod.nome, v_q, f.preco, p_arquivo, p_nome, p_mime, p_tamanho, p_sha, nullif(trim(p_obs), ''), app.uid())
  returning id into v_id;

  update app.pedido_itens
     set produto_id = v_prod.id, codigo = v_prod.codigo, descricao = v_prod.nome,
         quantidade = v_q, quantidade_pedida = v_q, preco_unitario = f.preco, tabela_preco = f.tabela, desconto = 0
   where id = it.id;
  perform app._recalcular_total_pedido(it.pedido_id);
  return v_id;
end $$;

-- 2a. Vendedora pede para tirar um item (cliente não quis trocar)
create or replace function app.pedir_remocao_item(p_item uuid, p_motivo text) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare it app.pedido_itens; v_ped app.pedidos; v_id uuid;
begin
  select * into it from app.pedido_itens where id = p_item;
  if it.id is null then raise exception 'Item não encontrado.'; end if;
  v_ped := app._pedido_editavel_itens(it.pedido_id);
  if not (app.pode_escrever() and app.ve_pedido(v_ped.vendedora_id)) then
    raise exception 'Só a vendedora do pedido ou a gerência pede a remoção.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Explique o motivo (ex.: cliente não quis outro aroma).'; end if;
  if exists (select 1 from app.pedido_remocoes where item_id = p_item and status = 'pendente') then
    raise exception 'Já existe um pedido de remoção deste item aguardando autorização.';
  end if;
  insert into app.pedido_remocoes (pedido_id, item_id, produto_id, descricao, quantidade, motivo, pedido_por)
  values (it.pedido_id, it.id, it.produto_id, it.descricao, it.quantidade, trim(p_motivo), app.uid())
  returning id into v_id;
  return v_id;
end $$;

-- 2b. Gerente ou dono decide. Aprovado: item sai do pedido e vai para os procurados.
create or replace function app.decidir_remocao_item(p_remocao uuid, p_aprovar boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare r app.pedido_remocoes; it app.pedido_itens; v_ped app.pedidos;
begin
  if not coalesce(app.pode_gerir(), false) then
    raise exception 'Só gerente ou dono autoriza tirar produto do pedido.' using errcode = 'insufficient_privilege';
  end if;
  select * into r from app.pedido_remocoes where id = p_remocao for update;
  if r.id is null then raise exception 'Pedido de remoção não encontrado.'; end if;
  if r.status <> 'pendente' then raise exception 'Este pedido de remoção já foi decidido.'; end if;

  if not p_aprovar then
    update app.pedido_remocoes set status = 'recusada', decidido_por = app.uid(), decidido_em = now(),
           motivo_decisao = nullif(trim(p_motivo), '') where id = r.id;
    return;
  end if;

  v_ped := app._pedido_editavel_itens(r.pedido_id);
  select * into it from app.pedido_itens where id = r.item_id;
  if it.id is null then raise exception 'O item já não está no pedido (foi trocado ou removido).'; end if;

  delete from app.pedido_itens_indisponiveis where pedido_id = r.pedido_id and descricao = it.descricao;
  insert into app.pedido_itens_indisponiveis (pedido_id, produto_id, descricao, quantidade_pedida, quantidade_faltou, registrado_por)
  values (r.pedido_id, it.produto_id, it.descricao, coalesce(it.quantidade_pedida, it.quantidade), it.quantidade, app.uid());
  delete from app.pedido_itens where id = it.id;
  perform app._recalcular_total_pedido(r.pedido_id);

  insert into app.procuras (produto_id, descricao, quantidade, cliente_id, origem, observacao, criado_por, pedido_id)
  values (it.produto_id, case when it.produto_id is null then it.descricao end, it.quantidade, v_ped.cliente_id, 'pedido',
          left('Tirado do pedido: ' || coalesce(r.motivo, ''), 500), r.pedido_por, r.pedido_id);

  update app.pedido_remocoes set status = 'aprovada', decidido_por = app.uid(), decidido_em = now(),
         motivo_decisao = nullif(trim(p_motivo), '') where id = r.id;
end $$;

grant execute on function
  app.trocar_item_pedido(uuid, uuid, numeric, text, text, text, int, text, text),
  app.pedir_remocao_item(uuid, text),
  app.decidir_remocao_item(uuid, boolean, text)
to vc_app;
revoke execute on function app._pedido_editavel_itens(uuid), app._recalcular_total_pedido(uuid) from public;
