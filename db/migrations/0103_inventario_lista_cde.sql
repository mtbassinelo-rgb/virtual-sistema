-- =====================================================================
-- Migração 0103: lista de inventário para conferir e lançar (CDE, 23/10/2026)
--
-- A contagem da loja de Ciudad del Este passada por fotos fica numa lista.
-- Na tela Estoque → Inventário → "Lista para conferir", o gerente vê a foto
-- de cada item, o produto que o sistema sugere, e escolhe:
--   • produto já cadastrado → a quantidade SOMA no estoque de CDE (nunca duplica);
--   • cadastrar como novo   → cria o produto (sem preço, estoque do Brasil fica 0)
--                              e soma em CDE; a foto da lista vira a foto do produto;
--   • não lançar.
-- Kit escolhido como produto soma nos componentes (o estoque do kit é calculado).
-- =====================================================================

create table if not exists app.inventario_lista (
  id              uuid primary key default gen_random_uuid(),
  lista           text not null,
  deposito_id     uuid not null references app.depositos(id),
  ordem           int not null,
  descricao       text not null,
  marca           text,
  quantidade      numeric(12,2) check (quantidade >= 0),
  caixas          numeric(12,2) check (caixas >= 0),
  foto_ref        text,
  foto_no_produto boolean not null default true,
  observacao      text,
  decisao         text not null default 'pendente' check (decisao in ('pendente','existente','novo','ignorar')),
  produto_id      uuid references app.produtos(id),
  status          text not null default 'aberto' check (status in ('aberto','lancado','ignorado')),
  lancado_em      timestamptz,
  lancado_por     uuid references app.usuarios(id),
  criado_em       timestamptz not null default now(),
  unique (lista, ordem)
);
alter table app.inventario_lista enable row level security;
drop policy if exists gerir on app.inventario_lista;
create policy gerir on app.inventario_lista for all using (app.pode_gerir()) with check (app.pode_gerir());
grant select on app.inventario_lista to vc_app;

-- Salva as escolhas da tela: [{"id","decisao","produto_id","quantidade"}]
create or replace function app.inventario_lista_decidir(p_linhas jsonb) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare r jsonb; v_dec text; v_prod uuid; v_qtd numeric; n int := 0;
begin
  if not coalesce(app.pode_gerir(), false) then
    raise exception 'Só gerente ou dono confere a lista de inventário.' using errcode = 'insufficient_privilege';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_linhas, '[]')) loop
    v_dec := coalesce(nullif(r->>'decisao', ''), 'pendente');
    if v_dec not in ('pendente','existente','novo','ignorar') then raise exception 'Escolha inválida.'; end if;
    v_prod := nullif(r->>'produto_id', '')::uuid;
    if v_dec = 'existente' and v_prod is null then raise exception 'Escolha o produto.'; end if;
    if v_dec <> 'existente' then v_prod := null; end if;
    v_qtd := nullif(replace(r->>'quantidade', ',', '.'), '')::numeric;
    if v_qtd is not null and v_qtd < 0 then raise exception 'Quantidade não pode ser negativa.'; end if;
    update app.inventario_lista set decisao = v_dec, produto_id = v_prod, quantidade = v_qtd
     where id = (r->>'id')::uuid and status = 'aberto';
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Lança no estoque as linhas decididas da lista. Devolve os produtos que podem receber a foto da lista.
create or replace function app.inventario_lista_lancar(p_lista text) returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare l app.inventario_lista; v_prod uuid; v_marca text; v_cod text; c record;
        n_exist int := 0; n_novo int := 0; n_ign int := 0; v_fotos jsonb := '[]';
begin
  if not coalesce(app.pode_gerir(), false) then
    raise exception 'Só gerente ou dono lança a lista de inventário.' using errcode = 'insufficient_privilege';
  end if;
  for l in select * from app.inventario_lista where lista = p_lista and status = 'aberto' and decisao <> 'pendente' order by ordem for update loop
    if l.decisao = 'ignorar' then
      update app.inventario_lista set status = 'ignorado', lancado_em = now(), lancado_por = app.uid() where id = l.id;
      n_ign := n_ign + 1;
      continue;
    end if;
    if coalesce(l.quantidade, 0) <= 0 then continue; end if;   -- falta a quantidade em unidades: fica para depois
    if l.decisao = 'novo' then
      -- usa a marca como já está escrita no sistema, se existir
      select p.marca into v_marca from app.produtos p
       where p.marca is not null and app.nome_normal(p.marca) = app.nome_normal(l.marca) limit 1;
      v_cod := 'CDE-' || upper(substr(replace(l.id::text, '-', ''), 1, 8));
      insert into app.produtos (codigo, nome, marca, ativo, codigo_provisorio)
      values (v_cod, l.descricao, coalesce(v_marca, l.marca), true, true)
      on conflict (codigo) do update set nome = excluded.nome
      returning id into v_prod;
      n_novo := n_novo + 1;
    else
      v_prod := l.produto_id;
      n_exist := n_exist + 1;
    end if;
    -- kit soma nos componentes
    for c in select * from app.componentes(v_prod, l.quantidade) loop
      perform app._lancar(l.deposito_id, c.produto_id, 'ajuste_entrada', c.quantidade, 'inventario', p_lista,
                          'Lista de inventário conferida: ' || l.descricao);
    end loop;
    update app.inventario_lista set status = 'lancado', produto_id = v_prod, lancado_em = now(), lancado_por = app.uid() where id = l.id;
    if l.foto_ref is not null and l.foto_no_produto
       and (select foto from app.produtos where id = v_prod) is null then
      v_fotos := v_fotos || jsonb_build_object('produto_id', v_prod, 'foto_ref', l.foto_ref);
    end if;
  end loop;
  return jsonb_build_object('existentes', n_exist, 'novos', n_novo, 'ignorados', n_ign, 'fotos', v_fotos);
end $$;
grant execute on function app.inventario_lista_decidir(jsonb), app.inventario_lista_lancar(text) to vc_app;

-- A lista de CDE de 23/10/2026 (quantidades em unidades; kits já separados em shampoo + máscara)
insert into app.inventario_lista (lista, deposito_id, ordem, descricao, marca, quantidade, caixas, foto_ref, foto_no_produto, observacao)
select 'CDE 23/10/2026', d.id, v.ordem, v.descricao, v.marca, v.quantidade, v.caixas, v.foto_ref, v.foto_no_produto, v.observacao
  from app.depositos d,
  (values
  (1, 'POMADA BIO PREMIUM', 'BIO INSTINTO', 12, null, null, false, 'Você passou como "pomada bio premium, 12 itens". Conferir qual pomada é.'),
  (2, 'FISIORELAX RHENUKS', 'RHENUKS', null, 3, null, false, '3 caixas: informe quantas unidades dá (ou escolha o produto que já tem as peças por caixa).'),
  (3, 'AGUA MICELAR', null, null, 1, null, false, '1 caixa, sem aloe vera. Pode ser a mesma Mousse Micelar PhalleBeauty (12): se for, marque "Não lançar" aqui.'),
  (4, 'SELAGEM CAPILAR REPARADOR DE PONTAS 30ML MAYCRENE', 'MAYCRENE', 27, null, '/inventario-cde/6db1932b.jpg', true, null),
  (5, 'SOUL DERM ON OFF PRE E POS MAKE 100ML', 'SOUL', 28, null, '/inventario-cde/3249d802.jpg', true, null),
  (6, 'CACHEADO BIO INSTINTO', 'BIO INSTINTO', 2, null, null, false, 'Conferir qual item da linha de cacheados.'),
  (7, 'CONDICIONADOR BABALU HIDRATANTE 500ML MAYCRENE', 'MAYCRENE', 7, null, '/inventario-cde/4e4d7f1d.jpg', false, null),
  (8, 'SHAMPOO BABALU HIDRATANTE 500ML MAYCRENE', 'MAYCRENE', 2, null, '/inventario-cde/4e4d7f1d.jpg', false, null),
  (9, 'SHAMPOO BABALU UVA MAYCRENE', 'MAYCRENE', 2, null, '/inventario-cde/1a17d643.jpg', true, 'Frasco roxo.'),
  (10, 'CONDICIONADOR MORANGO KIDS 400ML MAYCRENE', 'MAYCRENE', 9, null, '/inventario-cde/cfcd74a4.jpg', true, null),
  (11, 'SHAMPOO FORTALECEDOR ALHO 500ML MAYCRENE', 'MAYCRENE', 2, null, '/inventario-cde/681f1bc0.jpg', false, null),
  (12, 'CONDICIONADOR FORTALECEDOR ALHO 500ML MAYCRENE', 'MAYCRENE', 2, null, '/inventario-cde/681f1bc0.jpg', false, null),
  (13, 'MASCARA MANDIOCA E OLEO DE RICINUS 500G MAYCRENE', 'MAYCRENE', 1, null, '/inventario-cde/9d675829.jpg', true, null),
  (14, 'CONDICIONADOR MANDIOCA E OLEO DE RICINUS 500ML MAYCRENE', 'MAYCRENE', 1, null, '/inventario-cde/f859a5dc.jpg', true, null),
  (15, 'SHAMPOO DETOX ANTIRRESIDUO 500ML ZAP', 'ZAP', 4, null, '/inventario-cde/b970df40.jpg', false, 'Do kit ZAP (4 kits = 4 shampoos + 4 máscaras).'),
  (16, 'MASCARA ME LEVA 500ML ZAP', 'ZAP', 4, null, '/inventario-cde/b970df40.jpg', false, 'Do kit ZAP.'),
  (17, 'SHAMPOO QUIABO 300ML BONEQUINHA', 'BONEQUINHA', 6, null, '/inventario-cde/9f851e36.jpg', false, 'Do kit Quiabo 300ml (6 kits).'),
  (18, 'MASCARA QUIABO 300ML BONEQUINHA', 'BONEQUINHA', 6, null, '/inventario-cde/9f851e36.jpg', false, 'Do kit Quiabo 300ml.'),
  (19, 'SHAMPOO QUIABO 1L BONEQUINHA', 'BONEQUINHA', 6, null, '/inventario-cde/bad4ceec.jpg', false, 'Do kit Quiabo 1 litro (6 kits).'),
  (20, 'MASCARA QUIABO 1000ML BONEQUINHA', 'BONEQUINHA', 6, null, '/inventario-cde/38a5161c.jpg', false, 'Do kit Quiabo 1 litro.'),
  (21, 'SHAMPOO ORGANICA 300ML MARIA ESCANDALOSA', 'MARIA ESCANDALOSA', 5, null, '/inventario-cde/912955ad.jpg', false, 'Do kit Orgânica 300 (5 kits).'),
  (22, 'MASCARA ORGANICA 300G MARIA ESCANDALOSA', 'MARIA ESCANDALOSA', 5, null, '/inventario-cde/912955ad.jpg', false, 'Do kit Orgânica 300.'),
  (23, 'SHAMPOO MATIZADOR CABELOS LOIROS 300ML CAFE BRAZIL', 'CAFE BRAZIL', 4, null, '/inventario-cde/c13a26d1.jpg', true, null),
  (24, 'SUPREME BRUSHING ARGAN OIL 300ML CAFE BRAZIL', 'CAFE BRAZIL', 4, null, '/inventario-cde/cea363c8.jpg', true, null),
  (25, 'TOTAL REPAIR CONDITIONER CAFE BRAZIL', 'CAFE BRAZIL', 4, null, '/inventario-cde/c75fa7aa.jpg', true, null),
  (26, 'TOTAL REPAIR SHAMPOO CAFE BRAZIL', 'CAFE BRAZIL', 1, null, '/inventario-cde/46b3e25b.jpg', true, null),
  (27, 'COLORS MATIZADOR ICE BLUE 100G MARIA ESCANDALOSA', 'MARIA ESCANDALOSA', 36, null, '/inventario-cde/64c49106.jpg', true, null),
  (28, 'COLORS MATIZADOR GREEN 100G MARIA ESCANDALOSA', 'MARIA ESCANDALOSA', 48, null, '/inventario-cde/96495f5c.jpg', true, null),
  (29, 'MASCARA BTOX WHITE 1KG BONEQUINHA', 'BONEQUINHA', 2, null, '/inventario-cde/098cbaf0.jpg', true, null),
  (30, 'CAUTER PRO PREMIUM 1000ML CAFE BRAZIL', 'CAFE BRAZIL', 15, null, '/inventario-cde/01912715.jpg', true, null),
  (31, 'DEEP SHAMPOO PREMIUM 1000ML CAFE BRAZIL', 'CAFE BRAZIL', 4, null, '/inventario-cde/5c41eaf4.jpg', true, 'Vinha embalado junto com outro frasco: se for kit, escolha o produto certo.'),
  (32, 'COFFEELISS SHAMPOO 1000ML CAFE BRAZIL', 'CAFE BRAZIL', 6, null, '/inventario-cde/20b524c7.jpg', true, 'Vinha embalado junto com outro frasco: se for kit, escolha o produto certo.'),
  (33, 'SHAMPOO FOR FAMILY 3 EM 1 RHENUKS', 'RHENUKS', 1, null, '/inventario-cde/6b9bba46.jpg', true, null),
  (34, 'SHAMPOO ANTI RESIDUO 300ML BONEQUINHA', 'BONEQUINHA', 2, null, '/inventario-cde/fbda598f.jpg', false, 'Do kit Bonequinha azul + rosa (2 kits).'),
  (35, 'MASCARA CAPILAR 300ML BONEQUINHA', 'BONEQUINHA', 2, null, '/inventario-cde/fbda598f.jpg', false, 'Do kit Bonequinha azul + rosa.'),
  (36, 'SHAMPOO ESCANDALOSO ANTI RESIDUOS 1000ML MARIA ESCANDALOSA', 'MARIA ESCANDALOSA', 5, null, '/inventario-cde/683d0b8f.jpg', false, 'Do kit 1000ml (5 kits).'),
  (37, 'MASCARA ESCANDALOSA 1000ML MARIA ESCANDALOSA', 'MARIA ESCANDALOSA', 5, null, '/inventario-cde/683d0b8f.jpg', false, 'Do kit 1000ml.'),
  (38, 'DETOX SHAMPOO LIMPEZA PROFUNDA 1000ML MARIA ESCANDALOSA', 'MARIA ESCANDALOSA', 7, null, '/inventario-cde/c05a25d7.jpg', true, null),
  (39, 'MASCARA ORGANICA 1000ML BONEQUINHA JAPONESA', 'BONEQUINHA', 5, null, '/inventario-cde/fa62e135.jpg', true, null),
  (40, 'SHAMPOO ANTI RESIDUOS TECNOLOGIA 5D BONEQUINHA JAPONESA', 'BONEQUINHA', 7, null, '/inventario-cde/3f6266d3.jpg', true, null),
  (41, 'MASCARA JAPONESA TECNOLOGIA 5D BONEQUINHA JAPONESA', 'BONEQUINHA', 2, null, '/inventario-cde/9b795b80.jpg', true, null),
  (42, 'MASCARA CAPILAR BOHIKARI BONEQUINHA JAPONESA', 'BONEQUINHA', 4, null, '/inventario-cde/d8a1bd3f.jpg', true, null),
  (43, 'MASCARA CAPILAR BIYUME BONEQUINHA JAPONESA', 'BONEQUINHA', 5, null, '/inventario-cde/c38db4d7.jpg', true, null),
  (44, 'ULTRA WHITE ORGANICA 250G MARIA ESCANDALOSA', 'MARIA ESCANDALOSA', 11, null, '/inventario-cde/46f522cf.jpg', true, 'Soma de 5 fotos: vale conferir na prateleira.'),
  (45, 'BODY SPLASH BELLE ROSE 130ML BIO INSTINTO', 'BIO INSTINTO', 1, null, '/inventario-cde/076cce02.jpg', true, null),
  (46, 'PERFUME CAPILAR DESTINEI 110ML', null, 1, null, '/inventario-cde/62316729.jpg', true, 'Marca a confirmar.'),
  (47, 'CREME DESODORANTE SEBO DE CARNEIRO 240G BIO INSTINTO', 'BIO INSTINTO', 2, null, '/inventario-cde/55097b8a.jpg', false, null),
  (48, 'CREME PES E MAOS COM SEBO DE CARNEIRO 230G MAYCRENE', 'MAYCRENE', 2, null, '/inventario-cde/031b8afb.jpg', false, null),
  (49, 'MASCARA MATIZADORA PROFISSIONAL 250G NAXOS', 'NAXOS', 1, null, '/inventario-cde/e7f3526c.jpg', true, null),
  (50, 'PO SOLTO TRANSLUCIDO PHALLEBEAUTY', 'PHALLEBEAUTY', 38, null, '/inventario-cde/1e9791fd.jpg', true, null),
  (51, 'MASCARA SOS ABSOLUTO', null, 3, null, '/inventario-cde/221e4d4a.jpg', true, 'Pote preto. Marca a confirmar.'),
  (52, 'SABONETE INTIMO GEL FLOR DE LARANJEIRA 200ML BIO INSTINTO', 'BIO INSTINTO', 4, null, '/inventario-cde/829851be.jpg', true, null),
  (53, 'MASCARA BOTOX CAPILAR QUERO BRILHO 250G ARFANZI', 'ARFANZI', 4, null, '/inventario-cde/d0d0135e.jpg', true, null),
  (54, 'GEL FIX TRATAMENTO 250G COFFEELISS CAFE BRAZIL', 'CAFE BRAZIL', 4, null, '/inventario-cde/835c4518.jpg', true, null),
  (55, 'MASK NUTRITION MASCARA HIDRATACAO EFEITO TEIA MARIA ESCANDALOSA', 'MARIA ESCANDALOSA', 7, null, '/inventario-cde/79c7188a.jpg', true, null),
  (56, 'SOS RESGATE TOTAL DOS CABELOS 300ML MARIA ESCANDALOSA', 'MARIA ESCANDALOSA', 3, null, '/inventario-cde/f9a89c3d.jpg', false, null),
  (57, 'MASCARA SOS RESGATE TOTAL 250G MARIA ESCANDALOSA', 'MARIA ESCANDALOSA', 5, null, '/inventario-cde/94512a99.jpg', true, null),
  (58, 'BANHO DE VERNIZ 4 EM 1 MARIA ESCANDALOSA', 'MARIA ESCANDALOSA', 4, null, '/inventario-cde/3b481a86.jpg', true, null),
  (59, 'MASCARA ESCANDALOSA 300ML MARIA ESCANDALOSA', 'MARIA ESCANDALOSA', 1, null, '/inventario-cde/d2e8032f.jpg', false, 'Avulsa (fora dos kits).'),
  (60, 'REPARADOR DE PONTAS NAXOS', 'NAXOS', 24, null, '/inventario-cde/19549427.jpg', false, '1 caixa fechada de 24 unidades.'),
  (61, 'REPARADOR DE PONTAS BABALU 30ML MAYCRENE', 'MAYCRENE', 1, null, '/inventario-cde/947a6646.jpg', false, 'Frasco pequeno.'),
  (62, 'REPARADOR DE PONTAS BABALU HIDRATANTE 60ML MAYCRENE', 'MAYCRENE', 1, null, '/inventario-cde/947a6646.jpg', false, null),
  (63, 'SERUM CAPILAR CRINA E CAUDA 30ML MAYCRENE', 'MAYCRENE', 1, null, '/inventario-cde/fdff80df.jpg', true, null),
  (64, 'CONDICIONADOR POS PROGRESSIVA LISS 300ML MAYCRENE', 'MAYCRENE', 3, null, '/inventario-cde/0722595f.jpg', true, 'Você mandou "+3": se for 3 além do frasco da foto, são 4.'),
  (65, 'SHAMPOO JABORANDI ANTI QUEDA 400ML MAYCRENE', 'MAYCRENE', 2, null, '/inventario-cde/350445b9.jpg', false, null),
  (66, 'CREME DE PENTEAR JABORANDI ANTI QUEDA 300ML MAYCRENE', 'MAYCRENE', 2, null, '/inventario-cde/fa744353.jpg', false, 'Apareceu em 2 fotos: se era o mesmo frasco, é 1.'),
  (67, 'SHAMPOO MANDIOCA HIDRATANTE 400ML MAYCRENE', 'MAYCRENE', 1, null, '/inventario-cde/d56fd97f.jpg', true, null),
  (68, 'MASCARA BROTO DE BAMBU 500G MAYCRENE', 'MAYCRENE', 1, null, '/inventario-cde/8e81e822.jpg', true, null),
  (69, 'MASCARA BTOX WHITE 250G BONEQUINHA', 'BONEQUINHA', 1, null, '/inventario-cde/fa744353.jpg', false, 'Pote pequeno (diferente da de 1kg).'),
  (70, 'MASCARA BANHO DE PETROLEO 250G MAYCRENE NATURAL', 'MAYCRENE', 2, null, '/inventario-cde/34021590.jpg', true, null),
  (71, 'SHAMPOO BANHO DE PETROLEO 300ML MAYCRENE NATURAL', 'MAYCRENE', 8, null, '/inventario-cde/26e9243d.jpg', true, null),
  (72, 'MOUSSE MICELAR RESVERA 150ML PHALLEBEAUTY', 'PHALLEBEAUTY', 12, null, '/inventario-cde/b9b11a98.jpg', true, null)
  ) as v(ordem, descricao, marca, quantidade, caixas, foto_ref, foto_no_produto, observacao)
 where d.codigo = 'loja-cde'
on conflict (lista, ordem) do nothing;
