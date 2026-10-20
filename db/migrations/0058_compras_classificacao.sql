-- =====================================================================
-- Motor de inteligência comercial
-- Fase 1b: fornecedores (prazo de reposição) e compras (valor, frete e câmbio por compra).
-- Fase 2: classificação automática dos produtos do Paraguai em atração, rentabilidade,
--         diferenciação e estoque parado, com recomendação e foto diária para comparar.
-- Nada aqui altera preço nem estoque.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Fornecedores
-- ---------------------------------------------------------------------
create table app.fornecedores (
  id                   uuid primary key default gen_random_uuid(),
  nome                 text not null unique check (length(trim(nome)) between 1 and 120),
  prazo_reposicao_dias int check (prazo_reposicao_dias between 0 and 365),
  pedido_minimo_brl    numeric(14,2) check (pedido_minimo_brl >= 0),
  observacao           text check (length(observacao) <= 300),
  ativo                boolean not null default true,
  criado_em            timestamptz not null default now()
);

-- Os nomes de fornecedor já usados no cadastro de produtos
insert into app.fornecedores (nome)
select distinct trim(fornecedor) from app.produtos where coalesce(trim(fornecedor), '') <> ''
on conflict (nome) do nothing;

create or replace function app.definir_fornecedor(p_id uuid, p_nome text, p_prazo int, p_pedido_minimo numeric, p_observacao text, p_ativo boolean default true)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id uuid;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono altera fornecedores.'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome do fornecedor.'; end if;
  if p_id is null then
    insert into app.fornecedores (nome, prazo_reposicao_dias, pedido_minimo_brl, observacao, ativo)
    values (trim(p_nome), p_prazo, p_pedido_minimo, nullif(trim(coalesce(p_observacao, '')), ''), coalesce(p_ativo, true))
    returning id into v_id;
  else
    update app.fornecedores set nome = trim(p_nome), prazo_reposicao_dias = p_prazo, pedido_minimo_brl = p_pedido_minimo,
           observacao = nullif(trim(coalesce(p_observacao, '')), ''), ativo = coalesce(p_ativo, true)
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Fornecedor não encontrado.'; end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2) Compras: uma linha por compra (nota ou pedido ao fornecedor)
-- ---------------------------------------------------------------------
create table app.compras (
  id             uuid primary key default gen_random_uuid(),
  fornecedor_id  uuid not null references app.fornecedores(id),
  data           date not null,
  valor_produtos numeric(14,2) not null check (valor_produtos > 0),
  frete          numeric(14,2) not null default 0 check (frete >= 0),
  total          numeric(14,2) generated always as (valor_produtos + frete) stored,
  cambio         numeric(10,2) check (cambio between 100 and 100000),
  observacao     text check (length(observacao) <= 300),
  criado_por     uuid references app.usuarios(id),
  criado_em      timestamptz not null default now()
);
comment on table app.compras is 'Compras em R$ (produtos + frete) e o câmbio em Gs por R$ usado para pagar. Não movimenta estoque.';
create index on app.compras (data);

create or replace function app.registrar_compra(p_fornecedor uuid, p_data date, p_valor numeric, p_frete numeric, p_cambio numeric, p_observacao text)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id uuid;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono registra compras.'; end if;
  if p_data is null or p_data > current_date + 1 then raise exception 'Data da compra inválida.'; end if;
  insert into app.compras (fornecedor_id, data, valor_produtos, frete, cambio, observacao, criado_por)
  values (p_fornecedor, p_data, p_valor, coalesce(p_frete, 0), p_cambio, nullif(trim(coalesce(p_observacao, '')), ''), app.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.excluir_compra(p_compra uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono exclui compras.'; end if;
  delete from app.compras where id = p_compra;
  if not found then raise exception 'Compra não encontrada.'; end if;
end $$;

create or replace view app.v_compras_mensal with (security_invoker = true) as
select to_char(date_trunc('month', c.data), 'YYYY-MM') as mes, count(*)::int as compras,
       sum(c.valor_produtos) as produtos_brl, sum(c.frete) as frete_brl, sum(c.total) as total_brl,
       sum(c.total * c.cambio) as total_gs, count(*) filter (where c.cambio is null)::int as sem_cambio,
       round(sum(c.frete) / nullif(sum(c.valor_produtos), 0), 4) as frete_pct
  from app.compras c
 group by 1;

-- ---------------------------------------------------------------------
-- 3) Parâmetros da classificação
-- ---------------------------------------------------------------------
insert into app.parametros (chave, valor, descricao) values
  ('classif_atracao_pct', 20, 'Atração: os N% de produtos que mais vendem (em unidades, 90 dias)'),
  ('classif_margem_baixa', 15, 'Margem de contribuição VIP abaixo de N% = margem baixa')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- 4) Classificação (ao vivo) e foto diária
--    Ordem: parado > diferenciação > atração > rentabilidade > acompanhar; sem dados = incompleto
-- ---------------------------------------------------------------------
create or replace function app.classificacao_py()
returns table (produto_id uuid, codigo text, nome text, marca text, categoria text, margem_baixa boolean,
               contribuicao_vip numeric, preco_vip numeric, preco_minimo numeric, vendido_90 numeric, saldo numeric,
               situacao_giro text, recomendacao text)
language plpgsql stable security definer set search_path = app, pg_temp as $$
#variable_conflict use_column
declare v_top numeric := coalesce(app.param('classif_atracao_pct'), 20) / 100;
        v_baixa numeric := coalesce(app.param('classif_margem_baixa'), 15) / 100;
begin
  if not coalesce(app.e_gestao(), false) then raise exception 'Só gestão vê a classificação.'; end if;
  return query
  with r as (
    select x.*, p.grupo from app.rentabilidade_py() x join app.produtos p on p.id = x.produto_id
  ), vendas as (
    select r.produto_id, percent_rank() over (order by r.vendido_90 desc) as pr
      from r where r.vendido_90 > 0
  ), med as (
    select percentile_cont(0.5) within group (order by r.contribuicao_vip) as m from r where r.completo
  ), cls as (
    select r.*,
           case
             when not r.completo then 'incompleto'
             when r.situacao_giro = 'parado' or (r.vendido_90 = 0 and coalesce(r.saldo, 0) > 0) then 'parado'
             when r.tipo = 'kit' or r.grupo is not null then 'diferenciacao'
             when v.pr is not null and v.pr <= v_top then 'atracao'
             when r.contribuicao_vip >= (select m from med) then 'rentabilidade'
             else 'acompanhar'
           end as cat,
           r.completo and r.contribuicao_vip < v_baixa as baixa
      from r left join vendas v on v.produto_id = r.produto_id
  )
  select c.produto_id, c.codigo, c.nome, c.marca, c.cat, c.baixa, c.contribuicao_vip, c.preco_vip, c.preco_minimo,
         c.vendido_90, c.saldo, c.situacao_giro,
         case c.cat
           when 'incompleto' then 'Completar custo, frete, caixa e preços antes de decidir.'
           when 'parado' then case when c.preco_vip > c.preco_minimo
                                   then 'Recuperar capital: transferir para a loja CDE, combo com produto de atração ou promoção até o preço mínimo.'
                                   else 'Parado e sem espaço para desconto: transferir para a loja CDE ou combo; não baixar o preço.' end
           when 'diferenciacao' then 'Vender pelo valor (kit, fragrâncias, conveniência): destacar na loja e não competir por preço.'
           when 'atracao' then case when c.baixa
                                    then 'Atração com margem baixa: manter o preço, revisar custo e frete e vender junto com complementares de margem alta.'
                                    else 'Manter preço competitivo e em destaque; usar para trazer o cliente, sem desconto abaixo do mínimo.' end
           when 'rentabilidade' then 'Proteger o preço e sugerir no carrinho e em combos com produtos de atração.'
           else case when c.baixa then 'Margem baixa e venda média: revisar preço ou custo; evitar desconto.'
                     else 'Acompanhar: sem ação no momento.' end
         end
    from cls c;
end $$;

create table app.produto_classificacao (
  data             date not null,
  produto_id       uuid not null references app.produtos(id),
  categoria        text not null,
  margem_baixa     boolean,
  contribuicao_vip numeric(8,4),
  vendido_90       numeric(14,2),
  saldo            numeric(14,2),
  primary key (data, produto_id)
);

-- Grava a foto do dia uma vez (chamada ao abrir a tela); permite comparar antes e depois das ações
create or replace function app.registrar_classificacao_py() returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare n int;
begin
  if not coalesce(app.e_gestao(), false) then raise exception 'Só gestão vê a classificação.'; end if;
  if exists (select 1 from app.produto_classificacao where data = current_date) then return 0; end if;
  insert into app.produto_classificacao (data, produto_id, categoria, margem_baixa, contribuicao_vip, vendido_90, saldo)
  select current_date, c.produto_id, c.categoria, c.margem_baixa, c.contribuicao_vip, c.vendido_90, c.saldo from app.classificacao_py() c;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 5) Segurança e auditoria
-- ---------------------------------------------------------------------
create trigger auditar after insert or update or delete on app.fornecedores for each row execute function app.auditar('id');
create trigger auditar after insert or update or delete on app.compras      for each row execute function app.auditar('id');

alter table app.fornecedores enable row level security;
alter table app.compras enable row level security;
alter table app.produto_classificacao enable row level security;
create policy ler on app.fornecedores for select using (app.e_gestao());
create policy ler on app.compras for select using (app.e_gestao());
create policy ler on app.produto_classificacao for select using (app.e_gestao());

grant select on app.fornecedores, app.compras, app.produto_classificacao, app.v_compras_mensal to vc_app;
revoke execute on function app.definir_fornecedor(uuid, text, int, numeric, text, boolean), app.registrar_compra(uuid, date, numeric, numeric, numeric, text),
  app.excluir_compra(uuid), app.classificacao_py(), app.registrar_classificacao_py() from public;
grant execute on function app.definir_fornecedor(uuid, text, int, numeric, text, boolean), app.registrar_compra(uuid, date, numeric, numeric, numeric, text),
  app.excluir_compra(uuid), app.classificacao_py(), app.registrar_classificacao_py() to vc_app;
