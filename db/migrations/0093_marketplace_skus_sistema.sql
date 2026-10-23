-- =====================================================================
-- Estoque dos marketplaces pelo sistema (22/10/2026): os SKUs da Shopee e do Mercado Livre passam a apontar para
-- produtos do sistema. Kits vendidos nos marketplaces (Platinum, Marsala, Abacate, quantidades...) viram kits do sistema
-- com os componentes reais (a venda baixa os produtos de verdade). Os códigos antigos dos anúncios (MPLA-SCM, MMAR-SC,
-- papel3x120, códigos numéricos do Mercado Livre...) viram códigos alternativos do kit/produto certo.
-- Não mexe em preços. Pedido cancelado no marketplace: devolve o estoque (cancelar_vendas_marketplace).
-- =====================================================================

-- Cria/atualiza um kit de marketplace: produto tipo kit, fora do site, componentes pelos códigos do sistema.
-- Componente que já é kit entra pelos componentes dele. Devolve 'ok', 'faltando: <códigos>' ou 'com estoque'.
create or replace function app.registrar_kit_marketplace(p_codigo text, p_nome text, p_componentes jsonb) returns text
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_kit uuid; c jsonb; v_comp uuid; v_falta text[] := '{}'; r record; v_itens jsonb := '[]';
begin
  for c in select * from jsonb_array_elements(p_componentes) loop
    v_comp := app.produto_por_codigo(c->>'codigo');
    if v_comp is null then v_falta := v_falta || (c->>'codigo'); continue; end if;
    for r in select * from app.componentes(v_comp, (c->>'quantidade')::numeric) loop
      v_itens := v_itens || jsonb_build_object('id', r.produto_id, 'q', r.quantidade);
    end loop;
  end loop;
  if cardinality(v_falta) > 0 then return 'faltando: ' || array_to_string(v_falta, ', '); end if;
  select id into v_kit from app.produtos where codigo = p_codigo;
  if v_kit is null then
    select produto_id into v_kit from app.produto_codigos where codigo = p_codigo;
  end if;
  if v_kit is not null and exists (select 1 from app.estoque_saldos where produto_id = v_kit and quantidade <> 0) then return 'com estoque'; end if;
  if v_kit is null then
    insert into app.produtos (codigo, nome, tipo, mostrar_no_site, ativo) values (p_codigo, left(p_nome, 200), 'kit', false, true) returning id into v_kit;
  else
    update app.produtos set tipo = 'kit', mostrar_no_site = false, ativo = true where id = v_kit;
  end if;
  delete from app.kit_componentes where kit_id = v_kit;
  insert into app.kit_componentes (kit_id, componente_id, quantidade)
  select v_kit, (x->>'id')::uuid, sum((x->>'q')::numeric) from jsonb_array_elements(v_itens) x group by 2;
  return 'ok';
end $$;

-- Código antigo de anúncio → produto/kit do sistema. Se o código já é um produto do sistema (o "kit" vazio do Bling),
-- ele vira kit com os componentes do destino (só se não tiver estoque próprio).
create or replace function app.ligar_codigo_marketplace(p_codigo text, p_destino text) returns text
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_dest uuid := app.produto_por_codigo(p_destino); v_prod uuid; r record;
begin
  if v_dest is null then return 'destino não encontrado'; end if;
  select id into v_prod from app.produtos where codigo = p_codigo;
  if v_prod is null then
    insert into app.produto_codigos (codigo, produto_id) values (p_codigo, v_dest) on conflict (codigo) do update set produto_id = excluded.produto_id;
    return 'ok';
  end if;
  if v_prod = v_dest then return 'ok'; end if;
  if exists (select 1 from app.estoque_saldos where produto_id = v_prod and quantidade <> 0) then return 'com estoque'; end if;
  update app.produtos set tipo = 'kit', mostrar_no_site = false where id = v_prod;
  delete from app.kit_componentes where kit_id = v_prod;
  insert into app.kit_componentes (kit_id, componente_id, quantidade)
  select v_prod, x.produto_id, sum(x.quantidade) from app.componentes(v_dest, 1) x group by 2;
  return 'ok';
end $$;

-- Saída de estoque do pedido (redefinida a partir da 0025, com a proteção acima)
create or replace function app.estoque_do_pedido() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare it record;
begin
  if new.deposito_id is null or new.origem = 'bling' then return new; end if;
  -- pedido de marketplace já estornado pelos movimentos (cancelar_vendas_marketplace): não devolve de novo
  if new.origem = 'planilha' and new.status_comercial::text = 'cancelado' and not coalesce(old.estoque_baixado, false) then return new; end if;
  if new.status_comercial::text in ('enviado','aguardando_retirada','entregue')
     and old.status_comercial::text in ('em_separacao','aguardando_aprovacao') then
    for it in select c.produto_id, sum(c.quantidade) q
                from app.pedido_itens i cross join lateral app.componentes(i.produto_id, i.quantidade) c
               where i.pedido_id = new.id and i.produto_id is not null group by 1 loop
      perform app._lancar(new.deposito_id, it.produto_id, 'saida_venda', it.q, 'pedido', new.id::text, null);
    end loop;
  elsif new.status_comercial::text = 'cancelado' and old.status_comercial::text in ('enviado','aguardando_retirada','entregue') then
    for it in select c.produto_id, sum(c.quantidade) q
                from app.pedido_itens i cross join lateral app.componentes(i.produto_id, i.quantidade) c
               where i.pedido_id = new.id and i.produto_id is not null group by 1 loop
      perform app._lancar(new.deposito_id, it.produto_id, 'devolucao_cliente', it.q, 'pedido', new.id::text, 'Pedido cancelado após envio');
    end loop;
  end if;
  return new;
end $$;

-- Pedidos cancelados no marketplace: cancela no sistema e devolve o estoque. Devolve quantos foram cancelados.
create or replace function app.cancelar_vendas_marketplace(p_canal text, p_numeros text[]) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v record; n int := 0;
begin
  if not (coalesce(app.pode_gerir(), false) or exists (select 1 from app.deposito_responsaveis where usuario_id = app.uid())) or app.perfil_atual() is null then
    raise exception 'Sem permissão.' using errcode = 'insufficient_privilege';
  end if;
  for v in select id from app.pedidos where canal = p_canal and numero_externo = any(p_numeros) and status_comercial <> 'cancelado' for update loop
    perform app.estornar_pedido_marketplace(v.id);
    update app.pedidos set status_comercial = 'cancelado' where id = v.id;
    update app.estoque_pendencias set resolvida_em = now(), resolvida_por = app.uid() where pedido_id = v.id and resolvida_em is null;
    n := n + 1;
  end loop;
  return n;
end $$;

-- registrar_kit_marketplace e ligar_codigo_marketplace: só para cargas por migração (a aplicação não chama)
revoke execute on function app.registrar_kit_marketplace(text, text, jsonb), app.ligar_codigo_marketplace(text, text), app.cancelar_vendas_marketplace(text, text[]) from public;
grant execute on function app.cancelar_vendas_marketplace(text, text[]) to vc_app;

-- Carga: kits criados no Bling e na Shopee em 22/10/2026 e códigos antigos dos anúncios
do $$
declare d jsonb := '{
"kits": [
{
"codigo": "KC-ALEC-SCM",
"nome": "KIT ALECRIM MAYCRENE SHAMPOO + COND + MASCARA",
"componentes": [
{
"codigo": "2407203193",
"quantidade": 1
},
{
"codigo": "2407203192",
"quantidade": 1
},
{
"codigo": "2407203191",
"quantidade": 1
}
]
},
{
"codigo": "KC-CASTANHA-COPAIBA",
"nome": "KIT CREME CASTANHA DA INDIA + GEL MASSAGEADOR COPAIBA SOUL",
"componentes": [
{
"codigo": "2407203237",
"quantidade": 1
},
{
"codigo": "2407202912",
"quantidade": 1
}
]
},
{
"codigo": "KC-COCO-SCM",
"nome": "KIT OLEO DE COCO MAYCRENE SCM",
"componentes": [
{
"codigo": "2407202964",
"quantidade": 1
},
{
"codigo": "2407202963",
"quantidade": 1
},
{
"codigo": "2407202962",
"quantidade": 1
}
]
},
{
"codigo": "KC-JAB-CM",
"nome": "KIT JABORANDI E BABOSA CM",
"componentes": [
{
"codigo": "2407203177",
"quantidade": 1
},
{
"codigo": "2407203176",
"quantidade": 1
}
]
},
{
"codigo": "KC-JAB-SC",
"nome": "KIT JABORANDI E BABOSA SC",
"componentes": [
{
"codigo": "2407203178",
"quantidade": 1
},
{
"codigo": "2407203177",
"quantidade": 1
}
]
},
{
"codigo": "KC-JAB-SCM",
"nome": "KIT JABORANDI E BABOSA SCM",
"componentes": [
{
"codigo": "2407203178",
"quantidade": 1
},
{
"codigo": "2407203177",
"quantidade": 1
},
{
"codigo": "2407203176",
"quantidade": 1
}
]
},
{
"codigo": "KC-JAB-SM",
"nome": "KIT JABORANDI E BABOSA SM",
"componentes": [
{
"codigo": "2407203178",
"quantidade": 1
},
{
"codigo": "2407203176",
"quantidade": 1
}
]
},
{
"codigo": "KC-KIDSROSA-SCP",
"nome": "KIT KIDS ROSA MAYCRENE SHAMPOO + COND + CREME PENTEAR",
"componentes": [
{
"codigo": "2407202939",
"quantidade": 1
},
{
"codigo": "2407202938",
"quantidade": 1
},
{
"codigo": "2407202615",
"quantidade": 1
}
]
},
{
"codigo": "KC-LAMA-C1M1",
"nome": "KIT LAMA NEGRA MAYCRENE C1M1",
"componentes": [
{
"codigo": "2407202974",
"quantidade": 1
},
{
"codigo": "2407202973",
"quantidade": 1
}
]
},
{
"codigo": "KC-LAMA-C2",
"nome": "KIT LAMA NEGRA MAYCRENE C2",
"componentes": [
{
"codigo": "2407202974",
"quantidade": 2
}
]
},
{
"codigo": "KC-LAMA-M2",
"nome": "KIT LAMA NEGRA MAYCRENE M2",
"componentes": [
{
"codigo": "2407202973",
"quantidade": 2
}
]
},
{
"codigo": "KC-LAMA-S1C1",
"nome": "KIT LAMA NEGRA MAYCRENE S1C1",
"componentes": [
{
"codigo": "2407202975",
"quantidade": 1
},
{
"codigo": "2407202974",
"quantidade": 1
}
]
},
{
"codigo": "KC-LAMA-S1C1M1",
"nome": "KIT LAMA NEGRA MAYCRENE S1C1M1",
"componentes": [
{
"codigo": "2407202975",
"quantidade": 1
},
{
"codigo": "2407202974",
"quantidade": 1
},
{
"codigo": "2407202973",
"quantidade": 1
}
]
},
{
"codigo": "KC-LAMA-S1M1",
"nome": "KIT LAMA NEGRA MAYCRENE S1M1",
"componentes": [
{
"codigo": "2407202975",
"quantidade": 1
},
{
"codigo": "2407202973",
"quantidade": 1
}
]
},
{
"codigo": "KC-LAMA-S2",
"nome": "KIT LAMA NEGRA MAYCRENE S2",
"componentes": [
{
"codigo": "2407202975",
"quantidade": 2
}
]
},
{
"codigo": "KC-LAMA-S2C2M2",
"nome": "KIT LAMA NEGRA MAYCRENE S2C2M2",
"componentes": [
{
"codigo": "2407202975",
"quantidade": 2
},
{
"codigo": "2407202974",
"quantidade": 2
},
{
"codigo": "2407202973",
"quantidade": 2
}
]
},
{
"codigo": "KC-MABA-SCA",
"nome": "KIT OLEO DE ABACATE MAYCRENE SCA",
"componentes": [
{
"codigo": "2407203181",
"quantidade": 1
},
{
"codigo": "2407203180",
"quantidade": 1
},
{
"codigo": "2407203175",
"quantidade": 1
}
]
},
{
"codigo": "KC-MABA-SCM",
"nome": "KIT OLEO DE ABACATE MAYCRENE SCM",
"componentes": [
{
"codigo": "2407203181",
"quantidade": 1
},
{
"codigo": "2407203180",
"quantidade": 1
},
{
"codigo": "2407203179",
"quantidade": 1
}
]
},
{
"codigo": "KC-MABA-SCMA",
"nome": "KIT OLEO DE ABACATE MAYCRENE SCMA",
"componentes": [
{
"codigo": "2407203181",
"quantidade": 1
},
{
"codigo": "2407203180",
"quantidade": 1
},
{
"codigo": "2407203179",
"quantidade": 1
},
{
"codigo": "2407203175",
"quantidade": 1
}
]
},
{
"codigo": "KC-MABA-SCMAO",
"nome": "KIT OLEO DE ABACATE MAYCRENE SCMAO",
"componentes": [
{
"codigo": "2407203181",
"quantidade": 1
},
{
"codigo": "2407203180",
"quantidade": 1
},
{
"codigo": "2407203179",
"quantidade": 1
},
{
"codigo": "2407203175",
"quantidade": 1
},
{
"codigo": "2407203174",
"quantidade": 1
}
]
},
{
"codigo": "KC-MABA-SM",
"nome": "KIT OLEO DE ABACATE MAYCRENE SM",
"componentes": [
{
"codigo": "2407203181",
"quantidade": 1
},
{
"codigo": "2407203179",
"quantidade": 1
}
]
},
{
"codigo": "KC-MAND-S2C2M2",
"nome": "KIT 2 KITS MANDIOCA MAYCRENE (2S+2C+2M)",
"componentes": [
{
"codigo": "2407203201",
"quantidade": 2
},
{
"codigo": "2407203200",
"quantidade": 2
},
{
"codigo": "2407203199",
"quantidade": 2
}
]
},
{
"codigo": "KC-MMAR-MMM",
"nome": "KIT MATIZADOR MARSALA MAYCRENE MMM",
"componentes": [
{
"codigo": "2407203185",
"quantidade": 3
}
]
},
{
"codigo": "KC-MMAR-MMMPER",
"nome": "KIT MATIZADOR MARSALA MAYCRENE MMMPER",
"componentes": [
{
"codigo": "2407203185",
"quantidade": 3
},
{
"codigo": "2407202801",
"quantidade": 1
}
]
},
{
"codigo": "KC-MMAR-SC",
"nome": "KIT MATIZADOR MARSALA MAYCRENE SC",
"componentes": [
{
"codigo": "2407202981",
"quantidade": 1
},
{
"codigo": "2407203188",
"quantidade": 1
}
]
},
{
"codigo": "KC-MMAR-SCM",
"nome": "KIT MATIZADOR MARSALA MAYCRENE SCM",
"componentes": [
{
"codigo": "2407202981",
"quantidade": 1
},
{
"codigo": "2407203188",
"quantidade": 1
},
{
"codigo": "2407203185",
"quantidade": 1
}
]
},
{
"codigo": "KC-MMAR-SCMPER",
"nome": "KIT MATIZADOR MARSALA MAYCRENE SCMPER",
"componentes": [
{
"codigo": "2407202981",
"quantidade": 1
},
{
"codigo": "2407203188",
"quantidade": 1
},
{
"codigo": "2407203185",
"quantidade": 1
},
{
"codigo": "2407202801",
"quantidade": 1
}
]
},
{
"codigo": "KC-MMAR-SCMPRO",
"nome": "KIT MATIZADOR MARSALA MAYCRENE SCMPRO",
"componentes": [
{
"codigo": "2407202981",
"quantidade": 1
},
{
"codigo": "2407203188",
"quantidade": 1
},
{
"codigo": "2407203185",
"quantidade": 1
},
{
"codigo": "2407202618",
"quantidade": 1
}
]
},
{
"codigo": "KC-MMAR-SCPER",
"nome": "KIT MATIZADOR MARSALA MAYCRENE SCPER",
"componentes": [
{
"codigo": "2407202981",
"quantidade": 1
},
{
"codigo": "2407203188",
"quantidade": 1
},
{
"codigo": "2407202801",
"quantidade": 1
}
]
},
{
"codigo": "KC-MMAR-SCPRO",
"nome": "KIT MATIZADOR MARSALA MAYCRENE SCPRO",
"componentes": [
{
"codigo": "2407202981",
"quantidade": 1
},
{
"codigo": "2407203188",
"quantidade": 1
},
{
"codigo": "2407202618",
"quantidade": 1
}
]
},
{
"codigo": "KC-MMAR-SM",
"nome": "KIT MATIZADOR MARSALA MAYCRENE SM",
"componentes": [
{
"codigo": "2407202981",
"quantidade": 1
},
{
"codigo": "2407203185",
"quantidade": 1
}
]
},
{
"codigo": "KC-MPLA-CC",
"nome": "KIT MATIZADOR PLATINUM MAYCRENE CC",
"componentes": [
{
"codigo": "2407203195",
"quantidade": 2
}
]
},
{
"codigo": "KC-MPLA-CM",
"nome": "KIT MATIZADOR PLATINUM MAYCRENE CM",
"componentes": [
{
"codigo": "2407203195",
"quantidade": 1
},
{
"codigo": "2407203190",
"quantidade": 1
}
]
},
{
"codigo": "KC-MPLA-MM",
"nome": "KIT MATIZADOR PLATINUM MAYCRENE MM",
"componentes": [
{
"codigo": "2407203190",
"quantidade": 2
}
]
},
{
"codigo": "KC-MPLA-MMM",
"nome": "KIT MATIZADOR PLATINUM MAYCRENE MMM",
"componentes": [
{
"codigo": "2407203190",
"quantidade": 3
}
]
},
{
"codigo": "KC-MPLA-SC",
"nome": "KIT MATIZADOR PLATINUM MAYCRENE SC",
"componentes": [
{
"codigo": "2407203198",
"quantidade": 1
},
{
"codigo": "2407203195",
"quantidade": 1
}
]
},
{
"codigo": "KC-MPLA-SCM",
"nome": "KIT MATIZADOR PLATINUM MAYCRENE SCM",
"componentes": [
{
"codigo": "2407203198",
"quantidade": 1
},
{
"codigo": "2407203195",
"quantidade": 1
},
{
"codigo": "2407203190",
"quantidade": 1
}
]
},
{
"codigo": "KC-MPLA-SCMPER",
"nome": "KIT MATIZADOR PLATINUM MAYCRENE SCMPER",
"componentes": [
{
"codigo": "2407203198",
"quantidade": 1
},
{
"codigo": "2407203195",
"quantidade": 1
},
{
"codigo": "2407203190",
"quantidade": 1
},
{
"codigo": "2407202925",
"quantidade": 1
}
]
},
{
"codigo": "KC-MPLA-SCMPRO",
"nome": "KIT MATIZADOR PLATINUM MAYCRENE SCMPRO",
"componentes": [
{
"codigo": "2407203198",
"quantidade": 1
},
{
"codigo": "2407203195",
"quantidade": 1
},
{
"codigo": "2407203190",
"quantidade": 1
},
{
"codigo": "2407202618",
"quantidade": 1
}
]
},
{
"codigo": "KC-MPLA-SCMSCM",
"nome": "KIT MATIZADOR PLATINUM MAYCRENE SCMSCM",
"componentes": [
{
"codigo": "2407203198",
"quantidade": 2
},
{
"codigo": "2407203195",
"quantidade": 2
},
{
"codigo": "2407203190",
"quantidade": 2
}
]
},
{
"codigo": "KC-MPLA-SM",
"nome": "KIT MATIZADOR PLATINUM MAYCRENE SM",
"componentes": [
{
"codigo": "2407203198",
"quantidade": 1
},
{
"codigo": "2407203190",
"quantidade": 1
}
]
},
{
"codigo": "KC-MPLA-SS",
"nome": "KIT MATIZADOR PLATINUM MAYCRENE SS",
"componentes": [
{
"codigo": "2407203198",
"quantidade": 2
}
]
},
{
"codigo": "KC-MPLA-SSCM",
"nome": "KIT MATIZADOR PLATINUM MAYCRENE SSCM",
"componentes": [
{
"codigo": "2407203198",
"quantidade": 2
},
{
"codigo": "2407203195",
"quantidade": 1
},
{
"codigo": "2407203190",
"quantidade": 1
}
]
},
{
"codigo": "KC-MPLA-SSMM",
"nome": "KIT MATIZADOR PLATINUM MAYCRENE SSMM",
"componentes": [
{
"codigo": "2407203198",
"quantidade": 2
},
{
"codigo": "2407203190",
"quantidade": 2
}
]
},
{
"codigo": "KC-NAXOS-BLACK-SM",
"nome": "KIT NAXOS BLACK SHAMPOO 300ML + MASCARA 250G",
"componentes": [
{
"codigo": "2407202983",
"quantidade": 1
},
{
"codigo": "2407202985",
"quantidade": 1
}
]
},
{
"codigo": "KC-NAXOS-BLACK-SMP",
"nome": "KIT NAXOS BLACK SHAMPOO + MASCARA + PERFUME CAPILAR SOUL BLACK",
"componentes": [
{
"codigo": "2407202983",
"quantidade": 1
},
{
"codigo": "2407202985",
"quantidade": 1
},
{
"codigo": "2407202925",
"quantidade": 1
}
]
},
{
"codigo": "KC-NAXOS-MARS-SM",
"nome": "KIT NAXOS MARSALA SHAMPOO 300ML + MASCARA 250G",
"componentes": [
{
"codigo": "2407203125",
"quantidade": 1
},
{
"codigo": "2407202905",
"quantidade": 1
}
]
},
{
"codigo": "KC-NAXOS-RUIVO-SM",
"nome": "KIT NAXOS RUIVO SHAMPOO 300ML + MASCARA 250G",
"componentes": [
{
"codigo": "2407202980",
"quantidade": 1
},
{
"codigo": "2407202906",
"quantidade": 1
}
]
},
{
"codigo": "KC-PAPEL-180+200",
"nome": "KIT PAPEL MECHAS 180 FLS + 200 FLS",
"componentes": [
{
"codigo": "papel180",
"quantidade": 1
},
{
"codigo": "papel200",
"quantidade": 1
}
]
},
{
"codigo": "KC-PAPEL-1KG+200",
"nome": "KIT PAPEL MECHAS 1 KG + 200 FLS",
"componentes": [
{
"codigo": "papel1000",
"quantidade": 1
},
{
"codigo": "papel200",
"quantidade": 1
}
]
},
{
"codigo": "KC-PAPEL-200+30",
"nome": "KIT PAPEL MECHAS 200 FLS + 30 FLS",
"componentes": [
{
"codigo": "papel200",
"quantidade": 1
},
{
"codigo": "2407202683",
"quantidade": 1
}
]
},
{
"codigo": "KC-PAPEL-3X120",
"nome": "KIT 3 PAPEL MECHAS STANDARD 120 FLS",
"componentes": [
{
"codigo": "papel120",
"quantidade": 3
}
]
},
{
"codigo": "KC-PAPEL-3X180",
"nome": "KIT 3 PAPEL MECHAS STANDARD 180 FLS",
"componentes": [
{
"codigo": "papel180",
"quantidade": 3
}
]
},
{
"codigo": "KC-PAPEL-3X30",
"nome": "KIT 3 PAPEL MECHAS STANDARD 30 FLS",
"componentes": [
{
"codigo": "2407202683",
"quantidade": 3
}
]
},
{
"codigo": "KC-SEBO-12",
"nome": "CAIXA 12 CREME SEBO DE CARNEIRO RHENUKS",
"componentes": [
{
"codigo": "2407203291",
"quantidade": 12
}
]
},
{
"codigo": "KC-SEBO-3",
"nome": "KIT 3 CREME SEBO DE CARNEIRO RHENUKS",
"componentes": [
{
"codigo": "2407203291",
"quantidade": 3
}
]
},
{
"codigo": "KC-SEBOF-3",
"nome": "KIT 3 SEBO DE CARNEIRO UREIA 10% FASHION",
"componentes": [
{
"codigo": "2407203299",
"quantidade": 3
}
]
},
{
"codigo": "KC-SEL-CM",
"nome": "KIT SELAGEM CAPILAR MAYCRENE CM",
"componentes": [
{
"codigo": "2407203183",
"quantidade": 1
},
{
"codigo": "2407203182",
"quantidade": 1
}
]
},
{
"codigo": "KC-SEL-SC",
"nome": "KIT SELAGEM CAPILAR MAYCRENE SC",
"componentes": [
{
"codigo": "2407203184",
"quantidade": 1
},
{
"codigo": "2407203183",
"quantidade": 1
}
]
},
{
"codigo": "KC-SEL-SCM",
"nome": "KIT SELAGEM CAPILAR MAYCRENE SCM",
"componentes": [
{
"codigo": "2407203184",
"quantidade": 1
},
{
"codigo": "2407203183",
"quantidade": 1
},
{
"codigo": "2407203182",
"quantidade": 1
}
]
},
{
"codigo": "KC-SEL-SM",
"nome": "KIT SELAGEM CAPILAR MAYCRENE SM",
"componentes": [
{
"codigo": "2407203184",
"quantidade": 1
},
{
"codigo": "2407203182",
"quantidade": 1
}
]
},
{
"codigo": "KIT12-2407202746",
"nome": "KIT 12 UN - POMADA DESODORANTE MASSAGEADORA FISIOFORT + PREMIUM BIO INSTINTO 150 G",
"componentes": [
{
"codigo": "2407202746",
"quantidade": 12
}
]
},
{
"codigo": "KIT12-2407203264",
"nome": "KIT 12 UN - LOCAO MILAGROSA DESODORANTE PARA OS PES BIO INSTINTO 30 ML",
"componentes": [
{
"codigo": "2407203264",
"quantidade": 12
}
]
},
{
"codigo": "KIT2-2407202746",
"nome": "KIT 2 UN - POMADA DESODORANTE MASSAGEADORA FISIOFORT + PREMIUM BIO INSTINTO 150 G",
"componentes": [
{
"codigo": "2407202746",
"quantidade": 2
}
]
},
{
"codigo": "KIT2-2407202835",
"nome": "KIT 2 UN - FIXADOR DE MAQUIAGEM PHALLEBEAUTY",
"componentes": [
{
"codigo": "2407202835",
"quantidade": 2
}
]
},
{
"codigo": "KIT2-2407202891",
"nome": "KIT 2 UN - Tônico Capilar Antiqueda Cavalo de Raça 30ml - Bio Instinto",
"componentes": [
{
"codigo": "2407202891",
"quantidade": 2
}
]
},
{
"codigo": "KIT2-2407202936",
"nome": "KIT 2 UN - Gotas da Paixão 15ml - FANTASY",
"componentes": [
{
"codigo": "2407202936",
"quantidade": 2
}
]
},
{
"codigo": "KIT2-2407202948",
"nome": "KIT 2 UN - FIRMADOR BUMBUM - RHENUKS",
"componentes": [
{
"codigo": "2407202948",
"quantidade": 2
}
]
},
{
"codigo": "KIT2-2407203260",
"nome": "KIT 2 UN - POMADA DESODORANTE MASSAGEADORA FISIOFORT BIO INSTINTO 150 G",
"componentes": [
{
"codigo": "2407203260",
"quantidade": 2
}
]
},
{
"codigo": "KIT2-2407203264",
"nome": "KIT 2 UN - LOCAO MILAGROSA DESODORANTE PARA OS PES BIO INSTINTO 30 ML",
"componentes": [
{
"codigo": "2407203264",
"quantidade": 2
}
]
},
{
"codigo": "KIT2-2407203279",
"nome": "KIT 2 UN - PROTETOR TÉRMICO SPRAY  MEU LISO MINHA VIDA - RHENUKS",
"componentes": [
{
"codigo": "2407203279",
"quantidade": 2
}
]
},
{
"codigo": "KIT3-2407202746",
"nome": "KIT 3 UN - POMADA DESODORANTE MASSAGEADORA FISIOFORT + PREMIUM BIO INSTINTO 150 G",
"componentes": [
{
"codigo": "2407202746",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407202749",
"nome": "KIT 3 UN - Perfume Capilar Soul feminino - ATTAFF ROSÉ - 110 ml",
"componentes": [
{
"codigo": "2407202749",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407202801",
"nome": "KIT 3 UN - PERFUME CAPILAR SOUL RED 110ML",
"componentes": [
{
"codigo": "2407202801",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407202835",
"nome": "KIT 3 UN - FIXADOR DE MAQUIAGEM PHALLEBEAUTY",
"componentes": [
{
"codigo": "2407202835",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407202891",
"nome": "KIT 3 UN - Tônico Capilar Antiqueda Cavalo de Raça 30ml - Bio Instinto",
"componentes": [
{
"codigo": "2407202891",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407202925",
"nome": "KIT 3 UN - Perfume Capilar Soul feminino - BLACK - 110 ml",
"componentes": [
{
"codigo": "2407202925",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407202926",
"nome": "KIT 3 UN - Perfume Capilar Soul feminino DESTINEÉ - 110 ml",
"componentes": [
{
"codigo": "2407202926",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407202936",
"nome": "KIT 3 UN - Gotas da Paixão 15ml - FANTASY",
"componentes": [
{
"codigo": "2407202936",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407202948",
"nome": "KIT 3 UN - FIRMADOR BUMBUM - RHENUKS",
"componentes": [
{
"codigo": "2407202948",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407203013",
"nome": "KIT 3 UN - CREME REDUTOR DE MEDIDAS PIMENTA NEGRA RHENUKS",
"componentes": [
{
"codigo": "2407203013",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407203022",
"nome": "KIT 3 UN - Leite Siliconizado - Fashion - 400ML",
"componentes": [
{
"codigo": "2407203022",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407203227",
"nome": "KIT 3 UN - HIDRATANTE CORPORAL BABASOUL TUTTI-FRUTTI 240ML",
"componentes": [
{
"codigo": "2407203227",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407203228",
"nome": "KIT 3 UN - HIDRATANTE CORPORAL BABASOUL MORANGUINHO 240ML",
"componentes": [
{
"codigo": "2407203228",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407203229",
"nome": "KIT 3 UN - HIDRANTANTE CORPORAL BABASOUL MELANCIA 240ML",
"componentes": [
{
"codigo": "2407203229",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407203258",
"nome": "KIT 3 UN - KIT PODOX PODOLOGIA BIO INSTINTO",
"componentes": [
{
"codigo": "2407203258",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407203260",
"nome": "KIT 3 UN - POMADA DESODORANTE MASSAGEADORA FISIOFORT BIO INSTINTO 150 G",
"componentes": [
{
"codigo": "2407203260",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407203279",
"nome": "KIT 3 UN - PROTETOR TÉRMICO SPRAY  MEU LISO MINHA VIDA - RHENUKS",
"componentes": [
{
"codigo": "2407203279",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407203285",
"nome": "KIT 3 UN - SABONETE INTIMO CATUABA - RHENUKS",
"componentes": [
{
"codigo": "2407203285",
"quantidade": 3
}
]
},
{
"codigo": "KIT3-2407203290",
"nome": "KIT 3 UN - SABONETE INTIMO MORANGO PAIXAO - RHENUKS",
"componentes": [
{
"codigo": "2407203290",
"quantidade": 3
}
]
},
{
"codigo": "KIT36-2407203264",
"nome": "KIT 36 UN - LOCAO MILAGROSA DESODORANTE PARA OS PES BIO INSTINTO 30 ML",
"componentes": [
{
"codigo": "2407203264",
"quantidade": 36
}
]
},
{
"codigo": "KIT5-2407203279",
"nome": "KIT 5 UN - PROTETOR TÉRMICO SPRAY  MEU LISO MINHA VIDA - RHENUKS",
"componentes": [
{
"codigo": "2407203279",
"quantidade": 5
}
]
},
{
"codigo": "KIT6-2407202746",
"nome": "KIT 6 UN - POMADA DESODORANTE MASSAGEADORA FISIOFORT + PREMIUM BIO INSTINTO 150 G",
"componentes": [
{
"codigo": "2407202746",
"quantidade": 6
}
]
},
{
"codigo": "KIT6-2407203260",
"nome": "KIT 6 UN - POMADA DESODORANTE MASSAGEADORA FISIOFORT BIO INSTINTO 150 G",
"componentes": [
{
"codigo": "2407203260",
"quantidade": 6
}
]
},
{
"codigo": "KIT6-2407203264",
"nome": "KIT 6 UN - LOCAO MILAGROSA DESODORANTE PARA OS PES BIO INSTINTO 30 ML",
"componentes": [
{
"codigo": "2407203264",
"quantidade": 6
}
]
}
],
"aliases": {
"MPLA-SC": "KC-MPLA-SC",
"MPLA-SM": "KC-MPLA-SM",
"MPLA-CM": "KC-MPLA-CM",
"MPLA-SCM": "KC-MPLA-SCM",
"MPLA-SCMPER": "KC-MPLA-SCMPER",
"MPLA-SCMPRO": "KC-MPLA-SCMPRO",
"MPLA-MMM": "KC-MPLA-MMM",
"MPLA-MM": "KC-MPLA-MM",
"MPLA-SS": "KC-MPLA-SS",
"MPLA-CC": "KC-MPLA-CC",
"MPLA-SSMM": "KC-MPLA-SSMM",
"MPLA-SSCM": "KC-MPLA-SSCM",
"MPLA-SCMSCM": "KC-MPLA-SCMSCM",
"MMAR-SC": "KC-MMAR-SC",
"MMAR-SM": "KC-MMAR-SM",
"MMAR-M": "2407203185",
"MMAR-SCM": "KC-MMAR-SCM",
"MMAR-SCMPER": "KC-MMAR-SCMPER",
"MMAR-SCMPRO": "KC-MMAR-SCMPRO",
"MMAR-SCPER": "KC-MMAR-SCPER",
"MMAR-SCPRO": "KC-MMAR-SCPRO",
"MMAR-MMM": "KC-MMAR-MMM",
"MMAR-MMMPER": "KC-MMAR-MMMPER",
"MMAR-SPER-RED": "2407202801",
"MABA-SCM": "KC-MABA-SCM",
"MABA-SCMA": "KC-MABA-SCMA",
"MABA-SCMAO": "KC-MABA-SCMAO",
"MABA-SCA": "KC-MABA-SCA",
"MABA-SM": "KC-MABA-SM",
"MABA-SA": "KC-MABA-SM",
"MABA-A": "2407203175",
"18999382415": "KC-MABA-SCMAO",
"23994331551-shampoo+condicionador": "KC-JAB-SC",
"23994331551-shampoo+mascara": "KC-JAB-SM",
"23994331551-condicionador+mascara": "KC-JAB-CM",
"23994331551-kit completo": "KC-JAB-SCM",
"22398785362-kit completo": "KC-SEL-SCM",
"22398785362-shampoo + condicionador": "KC-SEL-SC",
"22398785362-shampoo + mascara": "KC-SEL-SM",
"22398785362-condicionador + mascara": "KC-SEL-CM",
"18299631776-Kit Shampoo+Condicionador+Masc": "KC-LAMA-S1C1M1",
"18299631776-Kit 2 Mascara": "KC-LAMA-M2",
"18299631776-Kit 2 Condicionador": "KC-LAMA-C2",
"18299631776-Kit Condicionador + Mascara": "KC-LAMA-C1M1",
"18299631776-Kit Shampoo+Condicionador": "KC-LAMA-S1C1",
"18299631776-Kit Shampoo + Mascara": "KC-LAMA-S1M1",
"18299631776-Kit 2 de cada=6Produtos": "KC-LAMA-S2C2M2",
"18299631776-Kit 2 Shampoo": "KC-LAMA-S2",
"22694079788": "KC-MAND-S2C2M2",
"5987474141": "KC-COCO-SCM",
"papel3x120": "KC-PAPEL-3X120",
"papel3x180": "KC-PAPEL-3X180",
"19799239226": "KC-PAPEL-3X180",
"papel180+120": "KC-PAPEL-180+200",
"papel1000+200": "KC-PAPEL-1KG+200",
"papel3x30": "KC-PAPEL-3X30",
"papel200+30": "KC-PAPEL-200+30",
"BIO-SKININFANTIL": "2407202881",
"18898266992": "2407203006",
"58201887901-3 ITENS": "2407202881",
"RSEB-12": "KC-SEBO-12",
"RSEB-1": "2407203291",
"RSEB1": "2407203291",
"RSEB-3": "KC-SEBO-3",
"23397165880": "KC-SEBOF-3",
"22593479132": "KIT2-2407203264",
"RPIM-3": "KIT3-2407203013",
"RPIMBUM3": "KIT3-2407203013",
"RPIM1": "2407203013",
"23593105890": "KIT3-2407203290",
"23593270380": "KIT3-2407203285",
"23193673715": "2407202871",
"SFPER-MAS": "2407202935",
"22392958260": "2407203146",
"23798006132": "2407202674"
}
}'; k jsonb; a record; r text; n_ok int := 0; n_al int := 0;
begin
  for k in select * from jsonb_array_elements(d->'kits') loop
    r := app.registrar_kit_marketplace(k->>'codigo', k->>'nome', k->'componentes');
    if r = 'ok' then n_ok := n_ok + 1; else raise notice 'Kit %: %', k->>'codigo', r; end if;
  end loop;
  for a in select key, value #>> '{}' v from jsonb_each(d->'aliases') loop
    r := app.ligar_codigo_marketplace(a.key, a.v);
    if r = 'ok' then n_al := n_al + 1; else raise notice 'Código % → %: %', a.key, a.v, r; end if;
  end loop;
  raise notice 'Kits de marketplace: % ok; códigos ligados: %', n_ok, n_al;
end $$;
