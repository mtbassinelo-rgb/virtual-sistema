-- Importação do cadastro de produtos a partir da planilha exportada do Bling
-- (Cadastros → Produtos → Exportar dados para planilha).
-- A chave é o ID do produto no Bling: importar de novo atualiza, nunca duplica.
-- Produto sem código no Bling recebe um código provisório "BLING-<id>" e fica marcado.

alter table app.produtos
  add column gtin              text,
  add column unidade           text,
  add column marca             text,
  add column ncm               text,
  add column custo             numeric(14,4),
  add column preco_bling       numeric(14,2),
  add column codigo_provisorio boolean not null default false,
  add column foto              text,
  add column importado_em      timestamptz;

-- p_linhas: [{"bling_id": 123, "codigo": "RHE-001", "nome": "...", "preco": 10.5, "custo": 6, "estoque": 12,
--             "gtin": "...", "unidade": "UN", "marca": "...", "ncm": "...", "fornecedor": "..."}, ...]
-- p_deposito: se informado, o estoque da planilha vira o saldo contado desse depósito (ajuste de inventário).
-- p_tabela_preco: se informada (br_normal ou br_vip), o preço do Bling vira o preço dessa tabela a partir de hoje.
create or replace function app.importar_produtos_bling(p_linhas jsonb, p_deposito uuid default null,
                                                       p_tabela_preco text default null, p_origem text default 'planilha')
returns jsonb language plpgsql security definer set search_path = app, pg_temp as $$
declare
  r jsonb; v_id uuid; v_bid bigint; v_cod text; v_final text; v_atual app.produtos; v_preco numeric; v_qtd numeric;
  v_vigente numeric; v_outro text;
  n_novos int := 0; n_atualizados int := 0; n_estoque int := 0; n_precos int := 0; n_provisorios int := 0;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono importa produtos.' using errcode = 'insufficient_privilege';
  end if;
  if p_tabela_preco is not null and p_tabela_preco not in ('br_normal','br_vip') then
    raise exception 'O preço do Bling está em reais: só pode alimentar as tabelas do Brasil.';
  end if;
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    raise exception 'A planilha não tem produtos.';
  end if;

  for r in select * from jsonb_array_elements(p_linhas) loop
    v_bid := nullif(r->>'bling_id','')::bigint;
    if v_bid is null then raise exception 'Linha sem ID do Bling: %', coalesce(r->>'nome','?'); end if;
    if coalesce(trim(r->>'nome'),'') = '' then raise exception 'Produto % do Bling sem descrição.', v_bid; end if;
    v_cod := nullif(trim(r->>'codigo'),'');

    -- Mesmo produto: pelo ID do Bling; senão, um produto já cadastrado aqui com o mesmo código
    select * into v_atual from app.produtos where bling_produto_id = v_bid;
    if v_atual.id is null and v_cod is not null then
      select * into v_atual from app.produtos where codigo = v_cod and bling_produto_id is null;
    end if;

    v_final := coalesce(v_cod, case when v_atual.id is not null and not v_atual.codigo_provisorio then v_atual.codigo end,
                        'BLING-' || v_bid);
    select nome into v_outro from app.produtos where codigo = v_final and id is distinct from v_atual.id;
    if v_outro is not null then
      raise exception 'O código % já é de outro produto ("%"). Corrija no Bling e exporte de novo.', v_final, v_outro;
    end if;

    if v_atual.id is null then
      insert into app.produtos (codigo, nome, fornecedor, bling_produto_id, gtin, unidade, marca, ncm, custo,
                                preco_bling, codigo_provisorio, importado_em)
      values (v_final, trim(r->>'nome'), nullif(trim(r->>'fornecedor'),''), v_bid, nullif(trim(r->>'gtin'),''),
              nullif(trim(r->>'unidade'),''), nullif(trim(r->>'marca'),''), nullif(trim(r->>'ncm'),''),
              nullif(r->>'custo','')::numeric, nullif(nullif(r->>'preco','')::numeric, 0), v_cod is null, now())
      returning id into v_id;
      n_novos := n_novos + 1;
    else
      v_id := v_atual.id;
      update app.produtos set
        codigo = v_final, nome = trim(r->>'nome'), bling_produto_id = v_bid,
        fornecedor = coalesce(nullif(trim(r->>'fornecedor'),''), fornecedor),
        gtin = coalesce(nullif(trim(r->>'gtin'),''), gtin), unidade = coalesce(nullif(trim(r->>'unidade'),''), unidade),
        marca = coalesce(nullif(trim(r->>'marca'),''), marca), ncm = coalesce(nullif(trim(r->>'ncm'),''), ncm),
        custo = coalesce(nullif(r->>'custo','')::numeric, custo),
        preco_bling = coalesce(nullif(nullif(r->>'preco','')::numeric, 0), preco_bling),
        codigo_provisorio = (v_final like 'BLING-%' and v_cod is null), ativo = true, importado_em = now()
      where id = v_id;
      -- o código antigo continua reconhecido nos pedidos de marketplace
      if v_atual.codigo <> v_final and not v_atual.codigo_provisorio then
        insert into app.produto_codigos (codigo, produto_id) values (v_atual.codigo, v_id) on conflict do nothing;
      end if;
      n_atualizados := n_atualizados + 1;
    end if;
    if v_cod is null then n_provisorios := n_provisorios + 1; end if;

    -- Preço do Bling como preço de uma tabela do Brasil
    v_preco := nullif(nullif(r->>'preco','')::numeric, 0);
    if p_tabela_preco is not null and v_preco is not null then
      select valor into v_vigente from app.precos
       where produto_id = v_id and tabela = p_tabela_preco and vigente_desde <= current_date
       order by vigente_desde desc limit 1;
      if v_vigente is distinct from round(v_preco, 2) then
        insert into app.precos (produto_id, tabela, valor, vigente_desde, definido_por)
        values (v_id, p_tabela_preco, round(v_preco, 2), current_date, app.uid())
        on conflict (produto_id, tabela, vigente_desde) do update set valor = excluded.valor, definido_por = excluded.definido_por;
        n_precos := n_precos + 1;
      end if;
    end if;

    -- Estoque: a quantidade da planilha é a contagem do depósito escolhido (negativo conta como zero)
    if p_deposito is not null and r ? 'estoque' and (select tipo from app.produtos where id = v_id) = 'simples' then
      v_qtd := greatest(coalesce(nullif(r->>'estoque','')::numeric, 0), 0);
      if app.ajustar_estoque(p_deposito, v_id, v_qtd, 'Importação do Bling (' || p_origem || ')') <> 0 then
        n_estoque := n_estoque + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('novos', n_novos, 'atualizados', n_atualizados, 'estoque_ajustado', n_estoque,
                            'precos', n_precos, 'codigo_provisorio', n_provisorios);
end $$;

grant execute on function app.importar_produtos_bling(jsonb, uuid, text, text) to vc_app;

-- ---------------------------------------------------------------------
-- Montar um kit a partir de um produto já cadastrado (ex.: Kit Platinum vindo do Bling)
-- p_componentes: [{"produto_id": "...", "quantidade": 1}, ...]; lista vazia desfaz o kit.
-- ---------------------------------------------------------------------
create or replace function app.definir_kit(p_kit uuid, p_componentes jsonb)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare v_saldo numeric;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono monta kits.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from app.produtos where id = p_kit) then raise exception 'Produto do kit não encontrado.'; end if;
  delete from app.kit_componentes where kit_id = p_kit;
  if coalesce(jsonb_array_length(p_componentes), 0) = 0 then
    update app.produtos set tipo = 'simples' where id = p_kit;
    return;
  end if;
  select sum(quantidade) into v_saldo from app.estoque_saldos where produto_id = p_kit and quantidade <> 0;
  if v_saldo is not null then
    raise exception 'Este produto tem % unidade(s) em estoque. Kit não tem estoque próprio: zere o saldo (ajuste de inventário) antes de transformá-lo em kit.', v_saldo;
  end if;
  update app.produtos set tipo = 'kit' where id = p_kit;
  insert into app.kit_componentes (kit_id, componente_id, quantidade)
  select p_kit, (c->>'produto_id')::uuid, sum((c->>'quantidade')::numeric)
    from jsonb_array_elements(p_componentes) c group by (c->>'produto_id')::uuid;
end $$;
grant execute on function app.definir_kit(uuid, jsonb) to vc_app;
