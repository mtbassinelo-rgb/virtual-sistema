-- =====================================================================
-- Motor de inteligência comercial · Fase 3 (começo): Retire em Foz
-- Só para clientes do Paraguai marcados como "cliente local" (da região, podem retirar no CD Foz).
-- A vendedora sugere; o gerente ou o dono aprova. Desconto = economia do pasero por caixa retirada.
-- Começa em SIMULAÇÃO: nada aparece para o cliente até ativar (parâmetro retirada_foz_ativa = 1).
-- =====================================================================

alter table app.clientes
  add column cliente_local boolean not null default false,
  add column cliente_local_sugerido_por uuid references app.usuarios(id),
  add column cliente_local_sugerido_em timestamptz;
comment on column app.clientes.cliente_local is 'Cliente do Paraguai da região, que pode retirar no CD Foz (aprovado pela gestão).';

-- Só a gestão muda a marcação (a vendedora pode alterar outros campos dos clientes dela)
create or replace function app.proteger_cliente_local() returns trigger
language plpgsql set search_path = app, pg_temp as $$
begin
  if new.cliente_local is distinct from old.cliente_local and not coalesce(app.pode_gerir(), false) then
    raise exception 'Só gerente ou dono marca cliente local.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger proteger_cliente_local before update of cliente_local on app.clientes
  for each row execute function app.proteger_cliente_local();

insert into app.parametros (chave, valor, descricao) values
  ('retirada_foz_desconto_caixa', 7000, 'Retire em Foz: desconto em Gs por caixa retirada (até o custo do pasero)'),
  ('retirada_foz_teto_mes', 0, 'Retire em Foz: desconto máximo por mês em Gs (0 = sem teto)'),
  ('retirada_foz_ativa', 0, 'Retire em Foz: 1 = liberar para o cliente na loja (a opção no pedido entra na próxima etapa), 0 = só simulação')
on conflict (chave) do nothing;

-- Vendedora sugere (só clientes dela); gestão marca direto
create or replace function app.sugerir_cliente_local(p_cliente uuid) returns text
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_vend uuid; v_pais text; v_local boolean;
begin
  select vendedora_id, pais, cliente_local into v_vend, v_pais, v_local from app.clientes where id = p_cliente and mesclado_em is null;
  if v_vend is null or not coalesce(app.pode_escrever(), false) or not coalesce(app.ve_pedido(v_vend), false) then
    raise exception 'Sem permissão para este cliente.' using errcode = 'insufficient_privilege';
  end if;
  if v_pais is distinct from 'PY' then raise exception 'Retire em Foz é só para clientes do Paraguai.'; end if;
  if v_local then return 'ja_local'; end if;
  if coalesce(app.pode_gerir(), false) then
    update app.clientes set cliente_local = true, cliente_local_sugerido_por = null, cliente_local_sugerido_em = null where id = p_cliente;
    return 'marcado';
  end if;
  update app.clientes set cliente_local_sugerido_por = app.uid(), cliente_local_sugerido_em = now() where id = p_cliente;
  return 'sugerido';
end $$;

-- Gestão aprova ou recusa a sugestão, ou desmarca um cliente local
create or replace function app.decidir_cliente_local(p_cliente uuid, p_local boolean) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_pais text;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono aprova cliente local.'; end if;
  select pais into v_pais from app.clientes where id = p_cliente and mesclado_em is null;
  if not found then raise exception 'Cliente não encontrado.'; end if;
  if p_local and v_pais is distinct from 'PY' then raise exception 'Retire em Foz é só para clientes do Paraguai.'; end if;
  update app.clientes set cliente_local = coalesce(p_local, false), cliente_local_sugerido_por = null, cliente_local_sugerido_em = null
   where id = p_cliente;
end $$;

-- Simulação por mês: quanto o desconto teria custado nos pedidos dos clientes locais (pedidos em Gs que contam como venda).
-- Como o cliente retira, a empresa não paga o pasero: o desconto troca um custo por outro.
-- itens_abaixo_minimo = itens cujo preço, menos o desconto por unidade, fica abaixo do preço mínimo sem entrega.
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
     where p.moeda = 'GS' and app.conta_como_venda(p.status_comercial)
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

revoke execute on function app.sugerir_cliente_local(uuid), app.decidir_cliente_local(uuid, boolean), app.simular_retirada_foz(date, date) from public;
grant execute on function app.sugerir_cliente_local(uuid), app.decidir_cliente_local(uuid, boolean), app.simular_retirada_foz(date, date) to vc_app;
