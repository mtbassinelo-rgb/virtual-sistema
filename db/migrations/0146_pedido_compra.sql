-- =====================================================================
-- Pedido de compra por marca (pedido do dono, 31/10/2026).
-- Uma lista fixa no sistema: escolhe a marca, aparecem todos os produtos com o custo de compra
-- SEM frete (app.custo_produto) e cada um preenche a quantidade. A lista fica salva até zerar,
-- e é exportada em planilha para mandar ao fornecedor. Só gerente e dono (mostra custo).
-- Também:
--   * Rhenuks: caixa do fornecedor sempre com 12 peças (produto novo ou alterado).
--   * Kits Maycrene (shampoo + condicionador + máscara): custo sem frete R$ 16,00 (informado pelo dono).
-- Não mexe em nenhum preço de venda.
-- =====================================================================

create table app.compra_lista (
  produto_id    uuid primary key references app.produtos(id) on delete cascade,
  quantidade    int not null check (quantidade between 1 and 1000000),
  atualizado_por uuid references app.usuarios(id),
  atualizado_em timestamptz not null default now()
);
comment on table app.compra_lista is 'Pedido de compra em montagem: quantidade a comprar por produto (unidades). Some ao zerar.';

alter table app.compra_lista enable row level security;
create policy ler on app.compra_lista for select using (app.e_gestao());
grant select on app.compra_lista to vc_app;

-- Quantidade a comprar (unidades). Zero ou vazio tira o produto da lista.
create or replace function app.compra_definir_qtd(p_produto uuid, p_qtd int) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono monta o pedido de compra.'; end if;
  if not exists (select 1 from app.produtos where id = p_produto) then raise exception 'Produto não encontrado.'; end if;
  if coalesce(p_qtd, 0) < 0 or coalesce(p_qtd, 0) > 1000000 then raise exception 'Quantidade inválida.'; end if;
  if coalesce(p_qtd, 0) = 0 then
    delete from app.compra_lista where produto_id = p_produto;
  else
    insert into app.compra_lista (produto_id, quantidade, atualizado_por, atualizado_em)
    values (p_produto, p_qtd, app.uid(), now())
    on conflict (produto_id) do update set quantidade = excluded.quantidade, atualizado_por = excluded.atualizado_por, atualizado_em = now();
  end if;
end $$;

-- Custo de compra por unidade, sem frete (o mesmo custo real usado no sistema todo). Não mexe em preço de venda.
create or replace function app.compra_definir_custo(p_produto uuid, p_custo numeric) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono altera o custo.'; end if;
  if p_custo is null or p_custo < 0 or p_custo > 100000 then raise exception 'Custo inválido (em R$, sem frete).'; end if;
  update app.produtos set custo_unitario_brl = round(p_custo, 4), custo_origem = 'Pedido de compra', custo_atualizado_em = now()
   where id = p_produto and custo_unitario_brl is distinct from round(p_custo, 4);
end $$;

-- Zera as quantidades da marca (depois de mandar o pedido). Sem marca = a lista toda.
create or replace function app.compra_zerar(p_marca text) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare n int;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono zera o pedido de compra.'; end if;
  delete from app.compra_lista l using app.produtos p
   where p.id = l.produto_id and (nullif(trim(p_marca), '') is null or p.marca = p_marca);
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function app.compra_definir_qtd(uuid, int), app.compra_definir_custo(uuid, numeric), app.compra_zerar(text) to vc_app;

-- Rhenuks: caixa do fornecedor sempre 12. Roda depois do gatilho da caixa de venda (ordem alfabética).
create or replace function app.rhenuks_caixa_12() returns trigger language plpgsql as $$
begin
  if upper(trim(coalesce(new.marca, ''))) = 'RHENUKS' then
    new.unidades_caixa_fornecedor := 12;
    new.unidades_caixa := 12;
  end if;
  return new;
end $$;
create trigger z_rhenuks_caixa_12 before insert or update on app.produtos
  for each row execute function app.rhenuks_caixa_12();
update app.produtos set unidades_caixa_fornecedor = 12
 where upper(trim(marca)) = 'RHENUKS' and unidades_caixa_fornecedor is distinct from 12;

-- Kits Maycrene (shampoo + condicionador + máscara): R$ 16,00 sem frete. Kids e Arruda (outra composição) ficam como estão.
update app.produtos
   set custo_unitario_brl = 16, custo_origem = 'Informado pelo dono em 31/10/2026 (sem frete)', custo_atualizado_em = now()
 where upper(trim(marca)) = 'MAYCRENE' and ativo and upper(nome) like 'KIT%'
   and upper(nome) not like '%KIDS%' and upper(nome) not like '%ARRUDA%'
   and custo_unitario_brl is distinct from 16;
