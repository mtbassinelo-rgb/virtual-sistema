-- =====================================================================
-- Custo real por unidade (R$), vindo da planilha de precificação do dono (aba Clientes VIP).
-- Fica numa coluna própria, que a importação do Bling NÃO sobrescreve.
-- O cálculo de custo (lucro das vendas, rentabilidade) passa a usar este custo quando existir.
-- A importação: grava custo e frete; preço de venda só é preenchido onde está em branco;
-- nunca ativa nem desativa produto.
-- =====================================================================

alter table app.produtos
  add column custo_unitario_brl numeric(14,4) check (custo_unitario_brl >= 0),
  add column custo_origem text check (length(custo_origem) <= 120),
  add column custo_atualizado_em timestamptz;
comment on column app.produtos.custo_unitario_brl is 'Custo real por unidade em R$, sem frete (planilha do dono). Tem prioridade sobre o custo do Bling.';

-- Custo usado em todo o sistema: o real da planilha; senão o do cadastro (Bling); kit sem custo = soma dos componentes
create or replace function app.custo_produto(p_produto uuid) returns numeric
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce(
    (select coalesce(custo_unitario_brl, custo) from app.produtos where id = p_produto),
    (select case when count(*) > 0 and count(*) = count(coalesce(pr.custo_unitario_brl, pr.custo))
                 then sum(k.quantidade * coalesce(pr.custo_unitario_brl, pr.custo)) end
       from app.kit_componentes k join app.produtos pr on pr.id = k.componente_id
      where k.kit_id = p_produto))
$$;

-- Importa linhas {codigo, custo, frete, normal, vip, origem}. Só gestão (gerente ou dono).
-- Devolve quantos custos foram gravados, quantos preços em branco foram preenchidos e os códigos não encontrados.
create or replace function app.importar_custos(p_linhas jsonb, p_origem text default 'Planilha Clientes VIP')
returns jsonb language plpgsql security definer set search_path = app, pg_temp as $$
declare r jsonb; v_id uuid; n_custo int := 0; n_frete int := 0; n_preco int := 0; v_nao text[] := '{}';
        v_custo numeric; v_frete numeric; v_normal numeric; v_vip numeric;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono importa custos.'; end if;
  if jsonb_typeof(p_linhas) <> 'array' then raise exception 'Formato inválido.'; end if;
  for r in select * from jsonb_array_elements(p_linhas) loop
    select id into v_id from app.produtos where codigo = trim(r->>'codigo');
    if v_id is null then v_nao := v_nao || coalesce(r->>'codigo', '?'); continue; end if;
    v_custo := nullif(r->>'custo', '')::numeric; v_frete := nullif(r->>'frete', '')::numeric;
    v_normal := nullif(r->>'normal', '')::numeric; v_vip := nullif(r->>'vip', '')::numeric;
    if v_custo is not null then
      if v_custo < 0 or v_custo > 100000 then raise exception 'Custo fora do esperado no código %.', r->>'codigo'; end if;
      update app.produtos set custo_unitario_brl = v_custo, custo_origem = left(coalesce(nullif(r->>'origem', ''), p_origem), 120),
             custo_atualizado_em = now()
       where id = v_id and custo_unitario_brl is distinct from v_custo;
      if found then n_custo := n_custo + 1; end if;
    end if;
    if v_frete is not null then
      if v_frete < 0 or v_frete > 10000 then raise exception 'Frete fora do esperado no código %.', r->>'codigo'; end if;
      update app.produtos set frete_unidade_brl = v_frete where id = v_id and frete_unidade_brl is distinct from v_frete;
      if found then n_frete := n_frete + 1; end if;
    end if;
    -- Preço de venda: só onde não existe nenhum preço vigente na tabela
    if v_normal > 0 and not exists (select 1 from app.precos where produto_id = v_id and tabela = 'py_normal' and vigente_desde <= current_date) then
      insert into app.precos (produto_id, tabela, valor, vigente_desde, definido_por) values (v_id, 'py_normal', v_normal, current_date, app.uid());
      n_preco := n_preco + 1;
    end if;
    if v_vip > 0 and not exists (select 1 from app.precos where produto_id = v_id and tabela = 'py_vip' and vigente_desde <= current_date) then
      insert into app.precos (produto_id, tabela, valor, vigente_desde, definido_por) values (v_id, 'py_vip', v_vip, current_date, app.uid());
      n_preco := n_preco + 1;
    end if;
  end loop;
  return jsonb_build_object('custos', n_custo, 'fretes', n_frete, 'precos_preenchidos', n_preco, 'nao_encontrados', to_jsonb(v_nao));
end $$;

revoke execute on function app.importar_custos(jsonb, text) from public;
grant execute on function app.importar_custos(jsonb, text) to vc_app;
