-- =====================================================================
-- Motor de inteligência comercial · Fase 1 (Paraguai)
-- Custo real (produto + frete de compra), custos variáveis por país, rentabilidade por SKU
-- nas tabelas do Paraguai e saúde dos dados. Só leitura de preços: nada aqui altera preço.
--
-- Fórmulas (por unidade, em Gs):
--   custo real        = (custo do produto + frete de compra por unidade) × câmbio de custo
--   entrega/unidade   = custo de entrega por caixa ÷ unidades da caixa
--   margem bruta      = (preço − custo real) ÷ preço
--   margem contrib.   = (preço − custo real − preço × % variáveis − entrega/unidade) ÷ preço
--   preço mínimo      = (custo real + entrega/unidade) ÷ (1 − % variáveis − margem mínima),
--                       arredondado para cima no múltiplo de arredondamento_gs
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Frete de compra por unidade (R$): padrão por marca, com exceção por produto.
--    Kit sem exceção = soma do frete dos componentes.
-- ---------------------------------------------------------------------
create table app.frete_marca (
  marca             text primary key,
  frete_unidade_brl numeric(10,4) not null check (frete_unidade_brl >= 0),
  observacao        text check (length(observacao) <= 300),
  atualizado_em     timestamptz not null default now()
);

alter table app.produtos add column frete_unidade_brl numeric(10,4) check (frete_unidade_brl >= 0);
comment on column app.produtos.frete_unidade_brl is 'Frete de compra por unidade em R$ (exceção). Vazio = padrão da marca; kit = soma dos componentes.';

-- Valores da planilha de preços (Distribuidora – Controle Mensal, aba Preços), só para marcas que existem no cadastro
insert into app.frete_marca (marca, frete_unidade_brl, observacao)
select distinct on (pr.marca) pr.marca, v.frete, 'Planilha de preços, 20/10/2026'
  from app.produtos pr
  join (values ('%RHENUKS%', 0.35), ('%SOUL%', 0.35), ('%MAYCRENE%', 0.80), ('%NAXOS%', 0.35),
               ('%BIO INSTINTO%', 0.35), ('%FASHION%', 0.35), ('%FARMAX%', 0.00), ('%PHALLE%', 0.35), ('%PHALE%', 0.35),
               ('%LUA E NEVE%', 0.10), ('%SUPER PODERES%', 0.20), ('%NIVEA%', 0.10), ('%NÍVEA%', 0.10),
               ('%SEXY FANTASY%', 0.00), ('%NELO%', 0.75), ('%MAGIC COLOR%', 0.75), ('%ZAP%', 2.00),
               ('%BONEQUINHA%', 1.00), ('%MARIA ESCANDALOSA%', 1.00), ('%MAKIAJ%', 0.00), ('%SHINE%', 0.00),
               ('%CAP LIFE%', 0.90), ('%REAL LOVE%', 0.10), ('%FONTE DA BELEZA%', 0.25)) v(padrao, frete)
    on pr.marca ilike v.padrao
 where pr.marca is not null
 order by pr.marca
on conflict (marca) do nothing;

create or replace function app.frete_produto(p_produto uuid) returns numeric
language plpgsql stable security definer set search_path = app, pg_temp as $$
declare v numeric; v_tipo text; v_marca text; n int;
begin
  select frete_unidade_brl, tipo, marca into v, v_tipo, v_marca from app.produtos where id = p_produto;
  if v is not null then return v; end if;
  if v_tipo = 'kit' then
    select count(*) into n from app.kit_componentes where kit_id = p_produto;
    if n > 0 then
      select case when count(*) = count(f) then sum(q * f) end into v
        from (select k.quantidade q, app.frete_produto(k.componente_id) f from app.kit_componentes k where k.kit_id = p_produto) s;
      return v;
    end if;
  end if;
  select frete_unidade_brl into v from app.frete_marca where marca = v_marca;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 2) Custos variáveis por país, com vigência (histórico mantido)
--    base 'venda' = percentual sobre o preço; 'caixa' e 'pedido' = valor fixo na moeda informada
-- ---------------------------------------------------------------------
create table app.custos_variaveis (
  id            uuid primary key default gen_random_uuid(),
  pais          text not null check (pais in ('PY','BR')),
  tipo          text not null check (tipo in ('imposto','comissao','taxa_pagamento','taxa_canal','entrega')),
  base          text not null check (base in ('venda','caixa','pedido')),
  percentual    numeric(6,3) check (percentual between 0 and 100),
  valor         numeric(14,2) check (valor >= 0),
  moeda         app.moeda,
  vigente_desde date not null default current_date,
  observacao    text check (length(observacao) <= 300),
  definido_por  uuid references app.usuarios(id),
  criado_em     timestamptz not null default now(),
  constraint custo_variavel_forma check (
    (base = 'venda' and percentual is not null and valor is null and moeda is null) or
    (base <> 'venda' and valor is not null and moeda is not null and percentual is null)),
  unique (pais, tipo, base, vigente_desde)
);

insert into app.custos_variaveis (pais, tipo, base, percentual, valor, moeda, vigente_desde, observacao) values
  ('PY', 'imposto', 'venda', 4, null, null, '2026-01-01', 'Imposto sobre as vendas ao Paraguai, informado por Mateus em 20/10/2026'),
  ('PY', 'entrega', 'caixa', null, 7000, 'GS', '2026-01-01', 'Pasero: média de 7.000 Gs por caixa de produto, informado por Mateus em 20/10/2026');

-- Vigentes numa data: a última vigência de cada (país, tipo, base)
create or replace function app.custos_variaveis_vigentes(p_pais text, p_data date default current_date)
returns table (tipo text, base text, percentual numeric, valor numeric, moeda app.moeda, vigente_desde date, observacao text)
language sql stable security definer set search_path = app, pg_temp as $$
  select distinct on (c.tipo, c.base) c.tipo, c.base, c.percentual, c.valor, c.moeda, c.vigente_desde, c.observacao
    from app.custos_variaveis c
   where c.pais = p_pais and c.vigente_desde <= p_data
   order by c.tipo, c.base, c.vigente_desde desc
$$;

create or replace function app.definir_custo_variavel(p_pais text, p_tipo text, p_base text, p_percentual numeric,
  p_valor numeric, p_moeda app.moeda, p_vigente_desde date, p_observacao text) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id uuid;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono altera custos.'; end if;
  insert into app.custos_variaveis (pais, tipo, base, percentual, valor, moeda, vigente_desde, observacao, definido_por)
  values (p_pais, p_tipo, p_base, case when p_base = 'venda' then p_percentual end,
          case when p_base <> 'venda' then p_valor end, case when p_base <> 'venda' then p_moeda end,
          coalesce(p_vigente_desde, current_date), nullif(trim(coalesce(p_observacao, '')), ''), app.uid())
  on conflict (pais, tipo, base, vigente_desde) do update
     set percentual = excluded.percentual, valor = excluded.valor, moeda = excluded.moeda,
         observacao = excluded.observacao, definido_por = excluded.definido_por
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.definir_frete_marca(p_marca text, p_frete numeric, p_observacao text default null) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono altera o frete.'; end if;
  if p_frete is null then delete from app.frete_marca where marca = p_marca; return; end if;
  if p_frete < 0 then raise exception 'Frete não pode ser negativo.'; end if;
  insert into app.frete_marca (marca, frete_unidade_brl, observacao) values (p_marca, p_frete, nullif(trim(coalesce(p_observacao, '')), ''))
  on conflict (marca) do update set frete_unidade_brl = excluded.frete_unidade_brl,
     observacao = coalesce(excluded.observacao, app.frete_marca.observacao), atualizado_em = now();
end $$;

create or replace function app.definir_frete_produto(p_produto uuid, p_frete numeric) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono altera o frete.'; end if;
  if p_frete < 0 then raise exception 'Frete não pode ser negativo.'; end if;
  update app.produtos set frete_unidade_brl = p_frete where id = p_produto;
  if not found then raise exception 'Produto não encontrado.'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 3) Parâmetros novos
-- ---------------------------------------------------------------------
insert into app.parametros (chave, valor, descricao) values
  ('cambio_compra_gs', 1120, 'Câmbio real de compra hoje (Gs por R$): mede a folga sobre o câmbio de custo'),
  ('margem_minima_contribuicao', 0, 'Margem mínima de contribuição (%) usada no preço mínimo (0 = empatar)')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- 4) Rentabilidade por SKU nas tabelas do Paraguai (só gestão)
-- ---------------------------------------------------------------------
create or replace function app.rentabilidade_py()
returns table (produto_id uuid, codigo text, nome text, marca text, tipo text, ativo boolean, mostrar_no_site boolean,
               unidades_caixa int, custo_brl numeric, frete_brl numeric, custo_real_brl numeric, cambio numeric,
               custo_real_gs numeric, impostos_pct numeric, entrega_caixa_gs numeric, entrega_unidade_gs numeric,
               preco_normal numeric, preco_vip numeric,
               margem_bruta_normal numeric, margem_bruta_vip numeric,
               contribuicao_normal numeric, contribuicao_vip numeric,
               preco_minimo numeric, cambio_real numeric, margem_bruta_vip_cambio_real numeric,
               vendido_90 numeric, saldo numeric, situacao_giro text, alertas text[], completo boolean)
language plpgsql stable security definer set search_path = app, pg_temp as $$
#variable_conflict use_column
declare v_cambio numeric := app.param('cambio_custo_gs'); v_real numeric := app.param('cambio_compra_gs');
        v_min numeric := coalesce(app.param('margem_minima_contribuicao'), 0); v_arred numeric := coalesce(app.param('arredondamento_gs'), 1);
        v_pct numeric; v_caixa numeric;
begin
  if not coalesce(app.e_gestao(), false) then raise exception 'Só gestão vê a rentabilidade.'; end if;
  select coalesce(sum(c.percentual), 0) into v_pct from app.custos_variaveis_vigentes('PY') c where c.base = 'venda';
  select sum(c.valor) into v_caixa from app.custos_variaveis_vigentes('PY') c where c.base = 'caixa' and c.moeda = 'GS';
  return query
  with base as (
    select p.id, p.codigo, p.nome, p.marca, p.tipo, p.ativo, p.mostrar_no_site, p.unidades_caixa,
           app.custo_produto(p.id) as custo, app.frete_produto(p.id) as frete,
           (select pr.valor from app.precos pr where pr.produto_id = p.id and pr.tabela = 'py_normal' and pr.vigente_desde <= current_date
             order by pr.vigente_desde desc limit 1) as p_normal,
           (select pr.valor from app.precos pr where pr.produto_id = p.id and pr.tabela = 'py_vip' and pr.vigente_desde <= current_date
             order by pr.vigente_desde desc limit 1) as p_vip
      from app.produtos p
     where p.ativo
  ), giro as (
    select g.produto_id, sum(g.vendido_janela) as vendido, sum(g.saldo) as saldo,
           case when bool_or(g.situacao = 'baixo') then 'baixo' when bool_and(g.situacao = 'esgotado') then 'esgotado'
                when bool_and(g.situacao in ('parado','esgotado')) then 'parado' else 'normal' end as situacao
      from app.v_giro g group by 1
  ), calc as (
    select b.*, g.vendido, g.saldo, g.situacao,
           b.custo + b.frete as real_brl,
           (b.custo + b.frete) * v_cambio as real_gs,
           case when b.unidades_caixa > 0 then v_caixa / b.unidades_caixa end as ent_un
      from base b left join giro g on g.produto_id = b.id
  )
  select c.id, c.codigo, c.nome, c.marca, c.tipo, c.ativo, c.mostrar_no_site, c.unidades_caixa,
         c.custo, c.frete, c.real_brl, v_cambio, round(c.real_gs), v_pct, v_caixa, round(c.ent_un),
         c.p_normal, c.p_vip,
         round((c.p_normal - c.real_gs) / nullif(c.p_normal, 0), 4),
         round((c.p_vip - c.real_gs) / nullif(c.p_vip, 0), 4),
         round((c.p_normal * (1 - v_pct / 100) - c.real_gs - c.ent_un) / nullif(c.p_normal, 0), 4),
         round((c.p_vip * (1 - v_pct / 100) - c.real_gs - c.ent_un) / nullif(c.p_vip, 0), 4),
         case when 1 - v_pct / 100 - v_min / 100 > 0 then
           ceil(((c.real_gs + c.ent_un) / (1 - v_pct / 100 - v_min / 100)) / v_arred) * v_arred end,
         v_real,
         round((c.p_vip - (c.real_brl * v_real)) / nullif(c.p_vip, 0), 4),
         coalesce(c.vendido, 0), c.saldo, c.situacao,
         array_remove(array[
           case when c.custo is null then 'sem_custo' end,
           case when c.frete is null then 'sem_frete' end,
           case when c.unidades_caixa is null then 'sem_caixa' end,
           case when c.p_normal is null then 'sem_preco_normal' end,
           case when c.p_vip is null then 'sem_preco_vip' end,
           case when (c.p_vip * (1 - v_pct / 100) - c.real_gs - c.ent_un) < 0 then 'contribuicao_negativa' end,
           case when c.p_vip < ceil(((c.real_gs + c.ent_un) / nullif(1 - v_pct / 100 - v_min / 100, 0)) / v_arred) * v_arred then 'abaixo_minimo' end
         ], null),
         (c.custo is not null and c.frete is not null and c.unidades_caixa is not null and c.p_normal is not null and c.p_vip is not null)
    from calc c;
end $$;

-- ---------------------------------------------------------------------
-- 5) Segurança e auditoria
-- ---------------------------------------------------------------------
create trigger auditar after insert or update or delete on app.frete_marca      for each row execute function app.auditar('marca');
create trigger auditar after insert or update or delete on app.custos_variaveis for each row execute function app.auditar('id');

alter table app.frete_marca enable row level security;
alter table app.custos_variaveis enable row level security;
create policy ler on app.frete_marca for select using (app.e_gestao());
create policy ler on app.custos_variaveis for select using (app.e_gestao());

grant select on app.frete_marca, app.custos_variaveis to vc_app;
revoke execute on function app.frete_produto(uuid), app.custos_variaveis_vigentes(text, date), app.rentabilidade_py(),
  app.definir_custo_variavel(text, text, text, numeric, numeric, app.moeda, date, text),
  app.definir_frete_marca(text, numeric, text), app.definir_frete_produto(uuid, numeric) from public;
grant execute on function app.frete_produto(uuid), app.custos_variaveis_vigentes(text, date), app.rentabilidade_py(),
  app.definir_custo_variavel(text, text, text, numeric, numeric, app.moeda, date, text),
  app.definir_frete_marca(text, numeric, text), app.definir_frete_produto(uuid, numeric) to vc_app;
