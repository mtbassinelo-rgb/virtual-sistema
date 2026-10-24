-- =====================================================================
-- Caixa de venda sempre com 12 unidades (pedido do dono, 24/10/2026).
-- unidades_caixa passa a ser a CAIXA DE VENDA (12 para todo produto vendido por caixa): site, pedidos, orçamentos,
-- descontos por caixa e metas contam caixas de 12.
-- unidades_caixa_fornecedor guarda a caixa física que chega do fornecedor (24, 36, 48... ou 6): usada na entrada
-- de nota, inventário, compras, custo e na separação (o estoquista vê quantas caixas físicas mandar).
-- Quem gravar "peças por caixa" (tela, planilha, importação) grava a caixa do fornecedor; a de venda fica 12.
-- =====================================================================
alter table app.produtos add column unidades_caixa_fornecedor int check (unidades_caixa_fornecedor between 1 and 1000);
comment on column app.produtos.unidades_caixa_fornecedor is 'Peças na caixa física do fornecedor. A caixa de venda (unidades_caixa) é sempre 12.';

create or replace function app.caixa_venda_12() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.unidades_caixa_fornecedor is null and new.unidades_caixa is not null then new.unidades_caixa_fornecedor := new.unidades_caixa; end if;
  elsif new.unidades_caixa_fornecedor is not distinct from old.unidades_caixa_fornecedor
        and new.unidades_caixa is distinct from old.unidades_caixa then
    -- gravaram "peças por caixa" na coluna antiga: é a caixa do fornecedor
    new.unidades_caixa_fornecedor := new.unidades_caixa;
  end if;
  new.unidades_caixa := case when new.unidades_caixa_fornecedor is null then null else 12 end;
  return new;
end $$;

-- carga: a caixa atual vira a do fornecedor; a de venda passa a 12 (antes de ligar o gatilho)
update app.produtos set unidades_caixa_fornecedor = unidades_caixa, unidades_caixa = 12 where unidades_caixa is not null;
create trigger caixa_venda_12 before insert or update of unidades_caixa, unidades_caixa_fornecedor on app.produtos
  for each row execute function app.caixa_venda_12();

-- Planilha/tela de peças por caixa: grava a caixa do fornecedor
create or replace function app.definir_caixas(p_linhas jsonb) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare r jsonb; n int := 0; v int;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono altera produtos.' using errcode = 'insufficient_privilege';
  end if;
  for r in select * from jsonb_array_elements(p_linhas) loop
    v := nullif(r->>'unidades','')::int;
    if v is not null and (v < 1 or v > 1000) then raise exception 'Peças por caixa de % precisa ser entre 1 e 1000.', r->>'codigo'; end if;
    update app.produtos set unidades_caixa_fornecedor = v where codigo = trim(r->>'codigo') and unidades_caixa_fornecedor is distinct from v;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
