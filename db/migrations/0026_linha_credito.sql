-- Linha de crédito do cliente: a vendedora libera no cadastro (limite e prazo em dias).
-- Pedido de cliente com crédito fica a prazo ao confirmar o total. O cliente acompanha na Minha área
-- quanto deve, quanto pagou e os vencimentos. Pagamento só vale depois de aprovado pelo gerente/dono (conferir_pagamento).
alter table app.clientes
  add column credito_habilitado boolean not null default false,
  add column limite_credito numeric(14,2) check (limite_credito >= 0),
  add column prazo_credito_dias int not null default 30 check (prazo_credito_dias between 1 and 180),
  add column credito_alterado_por uuid references app.usuarios(id),
  add column credito_alterado_em timestamptz;

create or replace function app.definir_credito_cliente(p_cliente uuid, p_habilitado boolean, p_limite numeric, p_prazo int) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_vend uuid;
begin
  select vendedora_id into v_vend from app.clientes where id = p_cliente and mesclado_em is null;
  if v_vend is null or not app.pode_escrever() or not app.ve_pedido(v_vend) then
    raise exception 'Sem permissão para alterar o crédito deste cliente.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_habilitado, false) and (p_limite is null or p_limite <= 0) then raise exception 'Informe o limite de crédito.'; end if;
  if p_prazo is not null and (p_prazo < 1 or p_prazo > 180) then raise exception 'O prazo deve ficar entre 1 e 180 dias.'; end if;
  perform set_config('app.motivo', 'Linha de crédito do cliente', true);
  update app.clientes set credito_habilitado = coalesce(p_habilitado, false), limite_credito = p_limite,
         prazo_credito_dias = coalesce(p_prazo, prazo_credito_dias), credito_alterado_por = app.uid(), credito_alterado_em = now()
   where id = p_cliente;
end $$;

create or replace function app.confirmar_total(p_pedido uuid, p_conta text)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos;
begin
  select * into v_ped from app.pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if not app.pode_escrever() or not app.ve_pedido(v_ped.vendedora_id) then
    raise exception 'Sem permissão.' using errcode = 'insufficient_privilege';
  end if;
  if v_ped.separacao_conferida_em is null and v_ped.origem <> 'bling' then
    raise exception 'Aguarde a expedição conferir a separação antes de confirmar o total.';
  end if;
  if coalesce(trim(p_conta),'') = '' then raise exception 'Informe a conta para pagamento.'; end if;
  update app.pedidos set conta_pagamento = trim(p_conta), total_confirmado_em = now(), total_confirmado_por = app.uid()
   where id = p_pedido;
  -- cliente com linha de crédito: o pedido fica a prazo, com vencimento pelo prazo combinado
  update app.pedidos p set credito_concedido = true,
         vencimento = coalesce(p.vencimento, current_date + c.prazo_credito_dias)
    from app.clientes c
   where p.id = p_pedido and c.id = p.cliente_id and c.credito_habilitado;
end $$;

-- Resumo do crédito para o cliente
create or replace function app.portal_credito(p_sessao_hash text)
returns table (habilitado boolean, limite numeric, prazo_dias int, moeda app.moeda, em_aberto numeric, vencido numeric,
               em_conferencia numeric, disponivel numeric, proximo_vencimento date)
language sql stable security definer set search_path = app, pg_temp as $$
  with c as (select * from app.clientes where id = app.portal_cliente_id(p_sessao_hash)),
       p as (select v.* from app.v_pedidos v join app.pedidos x on x.id = v.id, c
              where v.cliente_id = c.id and v.status_comercial <> 'cancelado' and x.total_confirmado_em is not null)
  select c.credito_habilitado, c.limite_credito, c.prazo_credito_dias, c.moeda,
         coalesce((select sum(saldo) from p where saldo > 0), 0),
         coalesce((select sum(saldo) from p where saldo > 0 and vencimento < current_date), 0),
         coalesce((select sum(a_conferir) from p), 0),
         greatest(coalesce(c.limite_credito, 0) - coalesce((select sum(saldo) from p where saldo > 0), 0), 0),
         (select min(vencimento) from p where saldo > 0 and vencimento >= current_date)
    from c
$$;

-- Extrato do cliente: compras (pedidos com total confirmado) e pagamentos (com a situação da aprovação)
create or replace function app.portal_extrato(p_sessao_hash text)
returns table (data date, tipo text, descricao text, valor numeric, situacao text, vencimento date, saldo numeric)
language sql stable security definer set search_path = app, pg_temp as $$
  with cli as (select app.portal_cliente_id(p_sessao_hash) as id)
  select v.data_pedido, 'compra', 'Pedido' || coalesce(' nº ' || v.bling_numero, '') || ' de ' || to_char(v.data_pedido, 'DD/MM/YYYY'),
         v.valor_total, case when v.saldo <= 0 then 'pago' when v.vencimento < current_date then 'vencido' else 'em_aberto' end,
         v.vencimento, v.saldo
    from app.v_pedidos v join app.pedidos x on x.id = v.id, cli
   where v.cliente_id = cli.id and v.status_comercial <> 'cancelado' and x.total_confirmado_em is not null
  union all
  select g.data, 'pagamento', 'Pagamento' || coalesce(' do pedido nº ' || x.bling_numero, '') || ' (' || g.modalidade::text || ')',
         g.valor, case g.status_conferencia when 'conferido' then 'aprovado' when 'recusado' then 'recusado' else 'em_conferencia' end,
         null, null
    from app.pagamentos g join app.pedidos x on x.id = g.pedido_id, cli
   where x.cliente_id = cli.id and x.status_comercial <> 'cancelado'
  order by 1 desc, 2
  limit 200
$$;

grant execute on function app.definir_credito_cliente(uuid, boolean, numeric, int), app.portal_credito(text), app.portal_extrato(text) to vc_app;
