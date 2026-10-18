-- Importar a planilha do Bling não reativa produto que a equipe inativou (soltos vendidos só em kit,
-- anúncios de marketplace, pacotes, duplicados). Produto novo entra ativo; o existente mantém a situação.
create or replace function app.importar_bling(p_linhas jsonb, p_deposito uuid default null, p_tabela_preco text default null,
                                              p_origem text default 'planilha', p_modo text default 'completo')
returns jsonb language plpgsql security definer set search_path = app, pg_temp as $$
declare
  r jsonb; v_id uuid; v_bid bigint; v_cod text; v_final text; v_atual app.produtos; v_preco numeric; v_qtd numeric;
  v_vigente numeric; v_outro text; v_extra text; v_n int;
  n_novos int := 0; n_atualizados int := 0; n_estoque int := 0; n_precos int := 0; n_provisorios int := 0;
  n_juntados int := 0; n_esgotados int := 0;
  nao_achados jsonb := '[]';
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono importa produtos.' using errcode = 'insufficient_privilege';
  end if;
  if p_modo not in ('completo','estoque') then raise exception 'Modo de importação inválido.'; end if;
  if p_modo = 'estoque' and p_deposito is null then raise exception 'Escolha o depósito que recebe o estoque.'; end if;
  if p_tabela_preco is not null and p_tabela_preco not in ('br_normal','br_vip') then
    raise exception 'O preço do Bling está em reais: só pode alimentar as tabelas do Brasil.';
  end if;
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    raise exception 'A planilha não tem produtos.';
  end if;

  create temp table if not exists _imp_estoque (produto_id uuid primary key, qtd numeric not null, linhas int not null) on commit drop;
  truncate _imp_estoque;

  for r in select * from jsonb_array_elements(p_linhas) loop
    v_bid := nullif(r->>'bling_id','')::bigint;
    if v_bid is null then raise exception 'Linha sem ID do Bling: %', coalesce(r->>'nome','?'); end if;
    if coalesce(trim(r->>'nome'),'') = '' then raise exception 'Produto % do Bling sem descrição.', v_bid; end if;
    v_cod := nullif(trim(r->>'codigo'),'');
    v_atual := null;

    -- 1) ID do Bling
    select * into v_atual from app.produtos where bling_produto_id = v_bid;
    -- 2) código (principal ou alternativo); no modo completo, só se o produto ainda não estiver ligado a outro ID do Bling
    if v_atual.id is null and v_cod is not null then
      select p.* into v_atual from app.produtos p
       where (p.codigo = v_cod or p.id = (select produto_id from app.produto_codigos where codigo = v_cod))
         and (p_modo = 'estoque' or p.bling_produto_id is null or p.id in (select produto_id from _imp_estoque))
       limit 1;
    end if;
    -- 3) mesma descrição, quando existe um único produto com ela
    if v_atual.id is null then
      select count(*) into v_n from app.produtos
       where app.nome_normal(nome) = app.nome_normal(r->>'nome')
         and (p_modo = 'estoque' or bling_produto_id is null or id in (select produto_id from _imp_estoque));
      if v_n = 1 then
        select * into v_atual from app.produtos
         where app.nome_normal(nome) = app.nome_normal(r->>'nome')
           and (p_modo = 'estoque' or bling_produto_id is null or id in (select produto_id from _imp_estoque));
      end if;
    end if;

    if p_modo = 'estoque' then
      if v_atual.id is null then
        nao_achados := nao_achados || jsonb_build_object('bling_id', v_bid, 'codigo', v_cod, 'nome', r->>'nome', 'estoque', r->'estoque');
        continue;
      end if;
      v_id := v_atual.id;
    else
      v_final := coalesce(v_cod, case when v_atual.id is not null and not v_atual.codigo_provisorio then v_atual.codigo end,
                          'BLING-' || v_bid);
      select nome into v_outro from app.produtos where codigo = v_final and id is distinct from v_atual.id;
      if v_outro is not null then
        if v_atual.id is null and exists (select 1 from _imp_estoque e join app.produtos p on p.id = e.produto_id where p.codigo = v_final) then
          -- o código é de um produto que já veio nesta mesma planilha: cadastro repetido, junta
          select * into v_atual from app.produtos where codigo = v_final;
          v_outro := null;
        else
          raise exception 'O código % já é de outro produto ("%"). Corrija no Bling e exporte de novo.', v_final, v_outro;
        end if;
      end if;

      if v_atual.id is null then
        insert into app.produtos (codigo, nome, fornecedor, bling_produto_id, gtin, unidade, marca, ncm, custo,
                                  preco_bling, codigo_provisorio, importado_em)
        values (v_final, trim(r->>'nome'), nullif(trim(r->>'fornecedor'),''), v_bid, nullif(trim(r->>'gtin'),''),
                nullif(trim(r->>'unidade'),''), nullif(trim(r->>'marca'),''), nullif(trim(r->>'ncm'),''),
                nullif(r->>'custo','')::numeric, nullif(nullif(r->>'preco','')::numeric, 0), v_cod is null, now())
        returning id into v_id;
        n_novos := n_novos + 1;
      elsif exists (select 1 from _imp_estoque where produto_id = v_atual.id) then
        -- segunda linha do mesmo produto nesta planilha: não sobrescreve o cadastro, só soma o estoque
        v_id := v_atual.id;
        n_juntados := n_juntados + 1;
        if v_cod is not null and v_cod <> v_atual.codigo then
          insert into app.produto_codigos (codigo, produto_id) values (v_cod, v_id) on conflict do nothing;
        end if;
      else
        v_id := v_atual.id;
        update app.produtos set
          codigo = v_final, nome = trim(r->>'nome'),
          bling_produto_id = case when exists (select 1 from app.produtos o where o.bling_produto_id = v_bid and o.id <> v_id)
                                  then bling_produto_id else v_bid end,
          fornecedor = coalesce(nullif(trim(r->>'fornecedor'),''), fornecedor),
          gtin = coalesce(nullif(trim(r->>'gtin'),''), gtin), unidade = coalesce(nullif(trim(r->>'unidade'),''), unidade),
          marca = coalesce(nullif(trim(r->>'marca'),''), marca), ncm = coalesce(nullif(trim(r->>'ncm'),''), ncm),
          custo = coalesce(nullif(r->>'custo','')::numeric, custo),
          preco_bling = coalesce(nullif(nullif(r->>'preco','')::numeric, 0), preco_bling),
          codigo_provisorio = (v_final like 'BLING-%' and v_cod is null), importado_em = now()
        where id = v_id;
        if v_atual.codigo <> v_final and not v_atual.codigo_provisorio then
          insert into app.produto_codigos (codigo, produto_id) values (v_atual.codigo, v_id) on conflict do nothing;
        end if;
        n_atualizados := n_atualizados + 1;
      end if;
      if v_cod is null then n_provisorios := n_provisorios + 1; end if;

      -- códigos dos cadastros repetidos que foram juntados nesta linha continuam reconhecidos (Shopee, ML, pedidos)
      for v_extra in select jsonb_array_elements_text(coalesce(r->'codigos_extra', '[]')) loop
        if nullif(trim(v_extra), '') is not null and trim(v_extra) <> (select codigo from app.produtos where id = v_id)
           and not exists (select 1 from app.produtos where codigo = trim(v_extra) and id <> v_id) then
          insert into app.produto_codigos (codigo, produto_id) values (trim(v_extra), v_id) on conflict do nothing;
        end if;
      end loop;

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
    end if;

    -- estoque: acumula por produto (cadastros repetidos somam); negativo conta como zero
    if p_deposito is not null and r ? 'estoque' and nullif(r->>'estoque','') is not null then
      insert into _imp_estoque values (v_id, greatest((r->>'estoque')::numeric, 0), 1)
      on conflict (produto_id) do update set qtd = _imp_estoque.qtd + excluded.qtd, linhas = _imp_estoque.linhas + 1;
    elsif not exists (select 1 from _imp_estoque where produto_id = v_id) then
      insert into _imp_estoque values (v_id, 0, 0) on conflict do nothing;   -- marca como visto (para juntar repetidos)
    end if;
  end loop;

  -- grava o estoque contado (só produtos simples: kit usa o estoque dos componentes)
  if p_deposito is not null then
    for v_id, v_qtd in
      select e.produto_id, e.qtd from _imp_estoque e join app.produtos p on p.id = e.produto_id
       where e.linhas > 0 and p.tipo = 'simples'
    loop
      if app.ajustar_estoque(p_deposito, v_id, v_qtd, 'Importação do Bling (' || p_origem || ')') <> 0 then
        n_estoque := n_estoque + 1;
      end if;
      if v_qtd = 0 then n_esgotados := n_esgotados + 1; end if;
    end loop;
  end if;

  return jsonb_build_object('novos', n_novos, 'atualizados', n_atualizados, 'estoque_ajustado', n_estoque,
                            'precos', n_precos, 'codigo_provisorio', n_provisorios, 'juntados', n_juntados,
                            'esgotados', n_esgotados, 'nao_encontrados', jsonb_array_length(nao_achados),
                            'lista_nao_encontrados', nao_achados);
end $$;
grant execute on function app.importar_bling(jsonb, uuid, text, text, text) to vc_app;
