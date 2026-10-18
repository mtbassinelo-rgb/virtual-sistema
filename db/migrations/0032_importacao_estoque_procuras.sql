-- Importação do Bling em lote, sem duplicar produtos, com opção "só estoque";
-- e registro de produtos procurados sem estoque (o gerente usa para as próximas compras).

-- ---------------------------------------------------------------------
-- Nome normalizado: sem acento, minúsculo, espaços simples (reconhece o mesmo produto escrito diferente)
-- ---------------------------------------------------------------------
create or replace function app.nome_normal(p text) returns text
language sql immutable parallel safe set search_path = app, pg_temp as $$
  select nullif(regexp_replace(lower(translate(trim(coalesce(p, '')),
           'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
           'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '\s+', ' ', 'g'), '')
$$;
create index if not exists produtos_nome_normal on app.produtos (app.nome_normal(nome));

-- ---------------------------------------------------------------------
-- Importação v2
-- p_modo: 'completo' = cadastro (+ estoque e preço se escolhidos); 'estoque' = só o estoque dos produtos que já existem.
-- Cada linha pode trazer "codigos_extra" (códigos dos cadastros repetidos que foram juntados nela).
-- Como o mesmo produto é reconhecido: ID do Bling → código (ou código alternativo) → descrição igual (se só houver um).
-- Linhas que caem no mesmo produto têm o estoque SOMADO (cadastros repetidos no Bling).
-- ---------------------------------------------------------------------
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
          codigo_provisorio = (v_final like 'BLING-%' and v_cod is null), ativo = true, importado_em = now()
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

-- A função antiga continua existindo e passa a usar a nova (mesmo comportamento, sem duplicar)
create or replace function app.importar_produtos_bling(p_linhas jsonb, p_deposito uuid default null,
                                                       p_tabela_preco text default null, p_origem text default 'planilha')
returns jsonb language sql security definer set search_path = app, pg_temp as $$
  select app.importar_bling(p_linhas, p_deposito, p_tabela_preco, p_origem, 'completo')
$$;

-- ---------------------------------------------------------------------
-- Produtos procurados sem estoque
-- ---------------------------------------------------------------------
create table app.procuras (
  id                uuid primary key default gen_random_uuid(),
  produto_id        uuid references app.produtos(id),
  descricao         text,                                 -- quando o produto não está cadastrado
  quantidade        numeric(12,2) check (quantidade is null or quantidade > 0),
  cliente_id        uuid references app.clientes(id),
  contato_nome      text,
  contato_whatsapp  text,
  origem            text not null check (origem in ('site','portal','vendedora')),
  observacao        text,
  criado_por        uuid references app.usuarios(id),
  criado_em         timestamptz not null default now(),
  visto_em          timestamptz,
  visto_por         uuid references app.usuarios(id),
  check (produto_id is not null or nullif(trim(descricao), '') is not null)
);
create index on app.procuras (produto_id);
create index on app.procuras (criado_em desc);
create index on app.procuras (visto_em) where visto_em is null;
alter table app.procuras enable row level security;
create policy procuras_ler on app.procuras for select
  using (app.e_gestao() or criado_por = app.uid());
create policy procuras_registrar on app.procuras for insert
  with check (app.uid() is not null and origem = 'vendedora' and criado_por = app.uid());
create policy procuras_marcar on app.procuras for update using (app.pode_gerir()) with check (app.pode_gerir());
create trigger auditar after insert or update or delete on app.procuras for each row execute function app.auditar('id');

-- Cliente ou visitante da loja: "Quero este produto" num produto esgotado
create or replace function app.registrar_procura_site(p_produto uuid, p_quantidade numeric, p_nome text, p_whatsapp text,
                                                      p_sessao_hash text default null, p_obs text default null)
returns boolean language plpgsql security definer set search_path = app, pg_temp as $$
declare v_cli uuid; v_whats text := nullif(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), '');
begin
  if p_sessao_hash is not null then v_cli := app.portal_cliente_id(p_sessao_hash); end if;
  if not exists (select 1 from app.produtos where id = p_produto and ativo) then raise exception 'Produto não encontrado.'; end if;
  if v_cli is null and (nullif(trim(p_nome), '') is null or length(coalesce(v_whats, '')) < 8) then
    raise exception 'Informe seu nome e WhatsApp para avisarmos quando chegar.';
  end if;
  if p_quantidade is not null and (p_quantidade <= 0 or p_quantidade > 100000) then raise exception 'Quantidade inválida.'; end if;
  -- mesmo pedido repetido no mesmo dia não conta duas vezes; limite contra abuso
  if exists (select 1 from app.procuras where produto_id = p_produto and criado_em > now() - interval '1 day'
              and (cliente_id = v_cli or (v_cli is null and contato_whatsapp = v_whats))) then
    return false;
  end if;
  if (select count(*) from app.procuras where origem = 'site' and criado_em > now() - interval '1 hour'
       and (cliente_id = v_cli or (v_cli is null and contato_whatsapp = v_whats))) >= 20 then
    raise exception 'Muitos pedidos em pouco tempo. Fale com a nossa equipe pelo WhatsApp.';
  end if;
  insert into app.procuras (produto_id, quantidade, cliente_id, contato_nome, contato_whatsapp, origem, observacao)
  values (p_produto, p_quantidade, v_cli, left(nullif(trim(p_nome), ''), 120), left(v_whats, 30),
          case when v_cli is null then 'site' else 'portal' end, left(nullif(trim(p_obs), ''), 500));
  return true;
end $$;
grant execute on function app.registrar_procura_site(uuid, numeric, text, text, text, text) to vc_app;

-- Resumo por produto para as próximas compras
create or replace view app.v_procuras_resumo with (security_invoker = true) as
select coalesce(q.produto_id::text, 'x:' || app.nome_normal(q.descricao)) as chave,
       q.produto_id, coalesce(max(p.nome), max(q.descricao)) as produto, max(p.codigo) as codigo, max(p.marca) as marca,
       max(p.fornecedor) as fornecedor,
       count(*)::int as pedidos,
       count(distinct coalesce(q.cliente_id::text, q.contato_whatsapp, q.criado_por::text, q.id::text))::int as interessados,
       sum(q.quantidade) as quantidade,
       count(*) filter (where q.visto_em is null)::int as novos,
       max(q.criado_em) as ultima,
       (select coalesce(sum(s.quantidade), 0) from app.estoque_saldos s where s.produto_id = q.produto_id) as estoque_atual
  from app.procuras q left join app.produtos p on p.id = q.produto_id
 group by q.produto_id, coalesce(q.produto_id::text, 'x:' || app.nome_normal(q.descricao));

grant select, insert on app.procuras to vc_app;
grant update (visto_em, visto_por) on app.procuras to vc_app;
grant select on app.v_procuras_resumo to vc_app;
grant execute on function app.nome_normal(text) to vc_app, vc_sync;
