-- =====================================================================
-- Preço por marca para clientes locais (como o Mateus explicou):
-- marca marcada "VIP só para locais" → no Paraguai o cliente LOCAL paga o preço VIP e o NÃO local paga o Normal,
-- seja ele VIP ou não. Marca "Mesmo preço para todos" → vale a categoria do cliente (Normal/VIP), como sempre.
-- O desconto de retirada (7.000 Gs/caixa ao retirar em Foz) passa a valer só nas marcas de mesmo preço,
-- para não somar dois descontos. Marca sem escolha = mesmo preço para todos.
-- =====================================================================
create or replace function app.retirada_foz_marca(p_marca text) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce((select aplica from app.retirada_foz_marcas where marca = p_marca), false)
$$;

create or replace function app.retirada_foz_marcas_fora() returns text[]
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce(array_agg(marca order by marca), '{}') from app.retirada_foz_marcas where aplica
$$;

-- Tabela que vale para este cliente neste produto
create or replace function app.tabela_efetiva(p_cliente uuid, p_produto uuid, p_tabela text) returns text
language sql stable security definer set search_path = app, pg_temp as $$
  select case
    when p_tabela like 'py\_%' and exists (select 1 from app.produtos p where p.id = p_produto and app.retirada_foz_marca(coalesce(nullif(trim(p.marca), ''), 'Sem marca')))
      then case when (select cliente_local from app.clientes where id = p_cliente) then 'py_vip' else 'py_normal' end
    else p_tabela end
$$;
grant execute on function app.tabela_efetiva(uuid, uuid, text) to vc_app;

create or replace function app.preco_para_cliente(p_cliente uuid, p_produto uuid, p_data date default current_date)
returns table (valor numeric, moeda app.moeda, tabela text)
language sql stable as $$
  select pr.valor, t.moeda, t.codigo
    from app.clientes c
    join app.tabelas_preco t on t.codigo = app.tabela_efetiva(c.id, p_produto, c.tabela_preco)
    join app.precos pr on pr.tabela = t.codigo and pr.produto_id = p_produto and pr.vigente_desde <= p_data
   where c.id = p_cliente
   order by pr.vigente_desde desc
   limit 1
$$;

create or replace function app.preco_final_moeda(p_cliente uuid, p_produto uuid, p_moeda app.moeda, p_data date default current_date)
returns table (preco numeric, preco_tabela numeric, tabela text, promocao_id uuid, desconto_pct numeric, limite_qtd numeric)
language sql stable security definer set search_path = app, pg_temp as $$
  with base as (
    select pr.valor, pr.tabela from app.precos pr
     where pr.produto_id = p_produto and pr.tabela = app.tabela_efetiva(p_cliente, p_produto, app.tabela_para(p_cliente, p_moeda)) and pr.vigente_desde <= p_data
     order by pr.vigente_desde desc limit 1),
  promo as (
    select pr.id, pr.desconto_pct, pr.limite_qtd from app.promocoes pr
     where pr.produto_id = p_produto and pr.status = 'aprovada' and p_data between pr.inicio and pr.fim
       and pr.pais = case when p_moeda = 'GS' then 'PY'::app.pais else 'BR'::app.pais end
       and not (p_moeda = 'GS' and app.produto_no_motor(p_produto))
     order by pr.desconto_pct desc limit 1)
  select case when promo.id is null then b.valor else app.arredondar_preco(b.valor * (1 - promo.desconto_pct / 100), p_moeda) end,
         b.valor, b.tabela, promo.id, promo.desconto_pct, promo.limite_qtd
    from base b left join promo on true
$$;

create or replace function app.portal_aplicar_retirada_foz(p_sessao_hash text, p_pedido uuid) returns numeric
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; v_desc numeric := app.portal_retirada_foz(p_sessao_hash); v_teto numeric := coalesce(app.param('retirada_foz_teto_mes'), 0);
        v_total_desc numeric; v_usado numeric; v_total numeric;
begin
  if v_desc is null then return 0; end if;
  select * into v_ped from app.pedidos where id = p_pedido and cliente_id = app.portal_cliente_id(p_sessao_hash) and origem = 'portal'
     and criado_em > now() - interval '10 minutes' and total_confirmado_em is null and not retirada_foz for update;
  if v_ped.id is null or v_ped.moeda <> 'GS' then return 0; end if;
  select round(sum(i.quantidade / pr.unidades_caixa * v_desc)) into v_total_desc
    from app.pedido_itens i join app.produtos pr on pr.id = i.produto_id
   where i.pedido_id = p_pedido and pr.unidades_caixa > 0 and not app.retirada_foz_marca(pr.marca);
  v_total_desc := coalesce(v_total_desc, 0);
  if v_teto > 0 then
    select coalesce(sum(retirada_foz_desconto), 0) into v_usado from app.pedidos
     where retirada_foz and date_trunc('month', data_pedido) = date_trunc('month', current_date) and id <> p_pedido;
    if v_usado + v_total_desc > v_teto then v_total_desc := 0; end if;
  end if;
  if v_total_desc > 0 then
    update app.pedido_itens i set preco_unitario = greatest(round(i.preco_unitario - v_desc / pr.unidades_caixa), 0),
           descricao = left(i.descricao || ' (retire em Foz)', 300)
      from app.produtos pr
     where i.pedido_id = p_pedido and pr.id = i.produto_id and pr.unidades_caixa > 0 and not app.retirada_foz_marca(pr.marca);
    select round(sum(quantidade * preco_unitario), 2) into v_total from app.pedido_itens where pedido_id = p_pedido;
    v_total_desc := v_ped.valor_total - coalesce(v_total, 0);
  end if;
  update app.pedidos set retirada_foz = true, retirada_foz_desconto = v_total_desc, local_retirada = 'CD Foz do Iguaçu',
         valor_total = coalesce(v_total, valor_total),
         observacoes = trim(both ' ' from coalesce(observacoes, '') || ' [RETIRA EM FOZ]')
   where id = p_pedido;
  return v_total_desc;
end $$;

create or replace function app.simular_retirada_foz(p_inicio date, p_fim date)
returns table (mes text, clientes int, pedidos int, vendido numeric, caixas numeric, itens_sem_caixa int,
               desconto numeric, desconto_pct numeric, itens_abaixo_minimo int)
language plpgsql stable security definer set search_path = app, pg_temp as $$
#variable_conflict use_column
declare v_desc numeric := coalesce(app.param('retirada_foz_desconto_caixa'), 0);
        v_teto numeric := coalesce(app.param('retirada_foz_teto_mes'), 0);
        v_pct numeric; v_min numeric := coalesce(app.param('margem_minima_contribuicao'), 0);
        v_cambio numeric := app.param('cambio_custo_gs');
begin
  if not coalesce(app.e_gestao(), false) then raise exception 'Só gestão vê a simulação.'; end if;
  select coalesce(sum(c.percentual), 0) into v_pct from app.custos_variaveis_vigentes('PY') c where c.base = 'venda';
  return query
  with itens as (
    select to_char(date_trunc('month', p.data_pedido), 'YYYY-MM') as m, p.id as pedido_id, p.cliente_id,
           i.quantidade, i.total, pr.unidades_caixa,
           i.preco_unitario, app.custo_produto(i.produto_id) + app.frete_produto(i.produto_id) as custo_brl
      from app.pedidos p
      join app.clientes c on c.id = p.cliente_id and c.cliente_local
      join app.pedido_itens i on i.pedido_id = p.id
      left join app.produtos pr on pr.id = i.produto_id
     where p.moeda = 'GS' and not app.retirada_foz_marca(pr.marca) and app.conta_como_venda(p.status_comercial)
       and p.data_pedido between p_inicio and p_fim
  ), por_mes as (
    select it.m, count(distinct it.cliente_id)::int as cli, count(distinct it.pedido_id)::int as ped, sum(it.total) as vend,
           sum(it.quantidade / it.unidades_caixa) as cx, count(*) filter (where it.unidades_caixa is null)::int as sem_cx,
           count(*) filter (where it.unidades_caixa > 0 and it.custo_brl is not null
                             and it.preco_unitario - v_desc / it.unidades_caixa
                                 < (it.custo_brl * v_cambio) / nullif(1 - v_pct / 100 - v_min / 100, 0))::int as abaixo
      from itens it group by it.m
  )
  select pm.m, pm.cli, pm.ped, pm.vend, round(pm.cx, 1), pm.sem_cx,
         case when v_teto > 0 then least(round(pm.cx * v_desc), v_teto) else round(pm.cx * v_desc) end,
         round((case when v_teto > 0 then least(pm.cx * v_desc, v_teto) else pm.cx * v_desc end) / nullif(pm.vend, 0), 4),
         pm.abaixo
    from por_mes pm order by pm.m desc;
end $$;
