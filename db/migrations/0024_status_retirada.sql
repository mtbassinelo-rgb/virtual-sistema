-- Acompanhamento do pedido: nova etapa "aguardando retirada" (chegou ao local de destino) e registro
-- dos itens que a expedição tirou da lista por falta de estoque (o cliente vê como "não disponível").
alter type app.status_comercial add value if not exists 'aguardando_retirada' before 'entregue';
alter table app.pedidos add column chegou_em timestamptz, add column local_retirada text check (length(local_retirada) <= 200);

create table app.pedido_itens_indisponiveis (
  id                uuid primary key default gen_random_uuid(),
  pedido_id         uuid not null references app.pedidos(id) on delete cascade,
  produto_id        uuid references app.produtos(id) on delete set null,
  descricao         text not null,
  quantidade_pedida numeric(12,3) not null,
  quantidade_faltou numeric(12,3) not null check (quantidade_faltou > 0),
  registrado_em     timestamptz not null default now(),
  registrado_por    uuid references app.usuarios(id)
);
create index on app.pedido_itens_indisponiveis (pedido_id);
alter table app.pedido_itens_indisponiveis enable row level security;
create policy ler on app.pedido_itens_indisponiveis for select using (exists (select 1 from app.pedidos p where p.id = pedido_id));
grant select on app.pedido_itens_indisponiveis to vc_app;
