-- =====================================================================
-- Retire em Foz no fechamento do pedido (loja): o cliente local escolhe Entrega ou Retirar em Foz.
-- Retirando, ganha o desconto por caixa (economia do pasero), aplicado nos itens do pedido.
-- Só para clientes do Paraguai marcados como cliente local (aprovados pela gestão).
-- O Mateus pediu para liberar no site: parâmetro retirada_foz_ativa passa para 1.
-- =====================================================================
alter table app.pedidos
  add column retirada_foz boolean not null default false,
  add column retirada_foz_desconto numeric(14,2) check (retirada_foz_desconto >= 0);
comment on column app.pedidos.retirada_foz is 'Cliente escolheu retirar no CD Foz (sem pasero), com desconto por caixa.';

update app.parametros set valor = 1, descricao = 'Retire em Foz: 1 = o cliente local escolhe Entrega ou Retirar em Foz ao fechar o pedido; 0 = desligado'
 where chave = 'retirada_foz_ativa';

-- Marcas em que o desconto vale. Quem não está na lista: vale (ex.: Soul com desconto, Rhenuks sem).
create table app.retirada_foz_marcas (
  marca text primary key check (length(trim(marca)) between 1 and 80),
  aplica boolean not null default true,
  definido_por uuid references app.usuarios(id),
  definido_em timestamptz not null default now()
);
alter table app.retirada_foz_marcas enable row level security;
create policy ler on app.retirada_foz_marcas for select using (true);
grant select on app.retirada_foz_marcas to vc_app;

create or replace function app.retirada_foz_marca(p_marca text) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce((select aplica from app.retirada_foz_marcas where marca = p_marca), true)
$$;

create or replace function app.definir_retirada_foz_marca(p_marca text, p_aplica boolean) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono escolhe as marcas do Retire em Foz.'; end if;
  if nullif(trim(p_marca), '') is null then raise exception 'Informe a marca.'; end if;
  insert into app.retirada_foz_marcas (marca, aplica, definido_por) values (trim(p_marca), coalesce(p_aplica, true), app.uid())
  on conflict (marca) do update set aplica = excluded.aplica, definido_por = excluded.definido_por, definido_em = now();
end $$;

-- Para o carrinho: marcas sem o desconto
create or replace function app.retirada_foz_marcas_fora() returns text[]
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce(array_agg(marca order by marca), '{}') from app.retirada_foz_marcas where not aplica
$$;

-- Para o carrinho: desconto por caixa que este cliente ganha retirando em Foz (null = opção não aparece)
create or replace function app.portal_retirada_foz(p_sessao_hash text) returns numeric
language sql stable security definer set search_path = app, pg_temp as $$
  select app.param('retirada_foz_desconto_caixa')
    from app.clientes c
   where c.id = app.portal_cliente_id(p_sessao_hash) and c.cliente_local and c.pais = 'PY'
     and coalesce(app.param('retirada_foz_ativa'), 0) = 1 and coalesce(app.param('retirada_foz_desconto_caixa'), 0) > 0
$$;

-- Pedido do site recém-criado com "Retirar em Foz": desconto por caixa em cada item vendido em caixa.
-- Respeita o teto do mês (se houver). Devolve o desconto total aplicado (Gs).
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
   where i.pedido_id = p_pedido and pr.unidades_caixa > 0 and app.retirada_foz_marca(pr.marca);
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
     where i.pedido_id = p_pedido and pr.id = i.produto_id and pr.unidades_caixa > 0 and app.retirada_foz_marca(pr.marca);
    select round(sum(quantidade * preco_unitario), 2) into v_total from app.pedido_itens where pedido_id = p_pedido;
    v_total_desc := v_ped.valor_total - coalesce(v_total, 0);
  end if;
  update app.pedidos set retirada_foz = true, retirada_foz_desconto = v_total_desc, local_retirada = 'CD Foz do Iguaçu',
         valor_total = coalesce(v_total, valor_total),
         observacoes = trim(both ' ' from coalesce(observacoes, '') || ' [RETIRA EM FOZ]')
   where id = p_pedido;
  return v_total_desc;
end $$;

-- Simulação passa a considerar só as marcas com desconto
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
     where p.moeda = 'GS' and app.retirada_foz_marca(pr.marca) and app.conta_como_venda(p.status_comercial)
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


revoke execute on function app.definir_retirada_foz_marca(text, boolean), app.retirada_foz_marcas_fora() from public;
grant execute on function app.retirada_foz_marca(text), app.definir_retirada_foz_marca(text, boolean), app.retirada_foz_marcas_fora() to vc_app;
revoke execute on function app.portal_retirada_foz(text), app.portal_aplicar_retirada_foz(text, uuid) from public;
grant execute on function app.portal_retirada_foz(text), app.portal_aplicar_retirada_foz(text, uuid) to vc_app;
