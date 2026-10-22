-- =====================================================================
-- Caixa e contas por unidade:
--  1. Contas bancárias da empresa (para onde o cliente transferiu). Recebimento por transferência/pix/depósito
--     no caixa registra a conta de destino e fica "a confirmar" até o gerente confirmar (ou recusar) no extrato.
--  2. Despesa paga no caixa vira conta paga no Contas a pagar da unidade.
--  3. Sangria com destino: cofre, banco ou outro.
--  4. Despesas e contas fixas com unidade (CD Foz, Loja CDE): resultado por unidade.
-- =====================================================================

-- 1. Contas bancárias -----------------------------------------------------
create table app.contas_bancarias (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(trim(nome)) between 1 and 80),   -- como aparece para a vendedora (ex.: "Itaú Py Gs - Cristina")
  banco       text check (length(banco) <= 60),
  titular     text check (length(titular) <= 80),
  moeda       app.moeda not null,
  deposito_id uuid references app.depositos(id),                          -- unidade que usa (vazio = todas)
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
alter table app.contas_bancarias enable row level security;
create policy ler on app.contas_bancarias for select using (app.uid() is not null);
create policy gerir on app.contas_bancarias for all using (app.pode_gerir()) with check (app.pode_gerir());
grant select, insert, update on app.contas_bancarias to vc_app;
create trigger auditar after insert or update or delete on app.contas_bancarias for each row execute function app.auditar('id');

alter table app.pagamentos add column conta_bancaria_id uuid references app.contas_bancarias(id);
-- conferido: pelo nº do Bling (como antes) ou pela conta bancária de destino (recebimento de caixa confirmado no extrato)
alter table app.pagamentos drop constraint conferido_tem_bling;
alter table app.pagamentos add constraint conferido_tem_bling
  check (status_conferencia <> 'conferido' or conferencia_bling_numero is not null or conta_bancaria_id is not null);

alter table app.caixa_movimentos
  add column conta_bancaria_id uuid references app.contas_bancarias(id),
  add column referencia text check (length(referencia) <= 80),
  add column confirmacao text check (confirmacao in ('pendente', 'confirmado', 'recusado')),
  add column confirmado_por uuid references app.usuarios(id),
  add column confirmado_em timestamptz,
  add column motivo_recusa text check (length(motivo_recusa) <= 300),
  add column destino text check (destino in ('cofre', 'banco', 'outro')),
  add column despesa_id uuid;
create index on app.caixa_movimentos (confirmacao) where confirmacao = 'pendente';

-- 4. Unidade nas despesas -------------------------------------------------
alter table app.despesas add column deposito_id uuid references app.depositos(id);
alter table app.despesas_recorrentes add column deposito_id uuid references app.depositos(id);
create index on app.despesas (deposito_id);
alter table app.caixa_movimentos add constraint caixa_movimentos_despesa_fk foreign key (despesa_id) references app.despesas(id) on delete set null;

create or replace function app.gerar_despesas_recorrentes(p_mes date) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_mes date := date_trunc('month', coalesce(p_mes, current_date))::date; n int;
begin
  if not coalesce(app.pode_gerir(), false) then return 0; end if;
  insert into app.despesas (categoria, descricao, fornecedor, moeda, valor, competencia, vencimento, recorrente_id, deposito_id)
  select r.categoria, r.descricao, r.fornecedor, r.moeda, r.valor, v_mes,
         make_date(extract(year from v_mes)::int, extract(month from v_mes)::int, r.dia_vencimento), r.id, r.deposito_id
    from app.despesas_recorrentes r
   where r.ativo and date_trunc('month', r.inicio) <= v_mes and (r.fim is null or r.fim >= v_mes)
  on conflict (recorrente_id, competencia) where recorrente_id is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Recebimento no caixa: [{"modalidade":"transferencia","valor":50000,"conta_bancaria_id":"...","referencia":"comprovante 123"}]
create or replace function app._receber(c app.caixas, p_pedido app.pedidos, p_pagamentos jsonb, p_tipo text) returns numeric
language plpgsql security definer set search_path = app, pg_temp as $$
declare pg jsonb; v numeric; v_mod app.modalidade_pagamento; v_pag uuid; total numeric := 0; v_conta app.contas_bancarias; v_ref text;
begin
  for pg in select * from jsonb_array_elements(coalesce(p_pagamentos, '[]')) loop
    v := round((pg->>'valor')::numeric, 2);
    continue when v is null or v <= 0;
    v_mod := coalesce(nullif(pg->>'modalidade', ''), 'efetivo')::app.modalidade_pagamento;
    v_conta := null;
    if nullif(pg->>'conta_bancaria_id', '') is not null then
      select * into v_conta from app.contas_bancarias where id = (pg->>'conta_bancaria_id')::uuid and ativo;
    end if;
    if v_mod in ('transferencia', 'pix', 'deposito') and v_conta.id is null
       and exists (select 1 from app.contas_bancarias where ativo and (deposito_id is null or deposito_id = c.deposito_id)) then
      raise exception 'Escolha em qual conta o cliente transferiu (banco de destino).';
    end if;
    v_ref := nullif(left(trim(coalesce(pg->>'referencia', '')), 80), '');
    insert into app.pagamentos (pedido_id, valor, data, modalidade, banco, observacao, registrado_por, conta_bancaria_id)
    values (p_pedido.id, v, current_date, v_mod, v_conta.nome,
            concat_ws(' · ', 'Recebido no caixa de ' || (select nome from app.depositos where id = c.deposito_id), v_ref), app.uid(), v_conta.id)
    returning id into v_pag;
    insert into app.caixa_movimentos (caixa_id, tipo, moeda, modalidade, valor, pedido_id, pagamento_id, usuario_id, conta_bancaria_id, referencia, confirmacao)
    values (c.id, p_tipo, p_pedido.moeda, v_mod, v, p_pedido.id, v_pag, app.uid(), v_conta.id, v_ref,
            case when v_mod in ('transferencia', 'pix', 'deposito') then 'pendente' end);
    total := total + v;
  end loop;
  return total;
end $$;

-- Confirmar (ou recusar) no extrato um recebimento por transferência do caixa
create or replace function app.confirmar_recebimento_caixa(p_movimento bigint, p_ok boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare m app.caixa_movimentos;
begin
  if app.perfil_atual() not in ('gerente', 'dono') then
    raise exception 'Só gerente ou dono confirma recebimentos no extrato.' using errcode = 'insufficient_privilege';
  end if;
  select * into m from app.caixa_movimentos where id = p_movimento for update;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if m.confirmacao is distinct from 'pendente' then raise exception 'Este recebimento já foi confirmado ou recusado.'; end if;
  if not p_ok and coalesce(trim(p_motivo), '') = '' then raise exception 'Diga o motivo da recusa (ex.: não caiu no extrato).'; end if;
  update app.caixa_movimentos set confirmacao = case when p_ok then 'confirmado' else 'recusado' end,
         confirmado_por = app.uid(), confirmado_em = now(), motivo_recusa = case when p_ok then null else left(trim(p_motivo), 300) end
   where id = p_movimento;
  if m.pagamento_id is not null then
    update app.pagamentos set status_conferencia = case when p_ok then 'conferido'::app.status_conferencia else 'recusado'::app.status_conferencia end,
           conferido_por = app.uid(), conferido_em = now(),
           conta_bancaria_id = coalesce(conta_bancaria_id, m.conta_bancaria_id),
           motivo_recusa = case when p_ok then null else left(trim(p_motivo), 300) end
     where id = m.pagamento_id and status_conferencia = 'pendente';
  end if;
end $$;

-- Reforço, sangria (cofre/banco) e despesa (vira conta paga da unidade)
drop function app.movimento_caixa(uuid, text, app.moeda, numeric, text);
create function app.movimento_caixa(p_caixa uuid, p_tipo text, p_moeda app.moeda, p_valor numeric, p_descricao text,
  p_destino text default null, p_categoria text default null, p_conta uuid default null)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare c app.caixas; v_desp uuid; v_mov bigint; v_dep text;
begin
  c := app._caixa_aberto(p_caixa);
  if p_tipo not in ('reforco','sangria','despesa') then raise exception 'Tipo de movimento inválido.'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor.'; end if;
  if p_tipo = 'despesa' and coalesce(trim(p_descricao), '') = '' then raise exception 'Diga o motivo da despesa (ex.: limpeza, frete do passeiro).'; end if;
  if p_tipo = 'sangria' then p_destino := coalesce(nullif(p_destino, ''), 'cofre'); end if;
  if p_tipo = 'sangria' and p_destino not in ('cofre', 'banco', 'outro') then raise exception 'Diga para onde foi o dinheiro: cofre, banco ou outro.'; end if;
  if p_tipo = 'sangria' and p_destino = 'outro' and coalesce(trim(p_descricao), '') = '' then raise exception 'Diga para onde foi o dinheiro.'; end if;
  select nome into v_dep from app.depositos where id = c.deposito_id;
  if p_tipo = 'despesa' then
    -- a despesa paga com o dinheiro do caixa entra no Contas a pagar da unidade, já paga
    insert into app.despesas (categoria, descricao, moeda, valor, competencia, vencimento, pago_em, forma, deposito_id, observacao)
    values (coalesce((select codigo from app.despesa_categorias where codigo = p_categoria and ativo), 'outros'),
            left(trim(p_descricao), 200), p_moeda, round(p_valor, 2), current_date, current_date, current_date,
            left('Caixa ' || v_dep, 60), c.deposito_id, 'Paga no caixa do dia')
    returning id into v_desp;
  end if;
  insert into app.caixa_movimentos (caixa_id, tipo, moeda, modalidade, valor, descricao, usuario_id, destino, despesa_id, conta_bancaria_id)
  values (c.id, p_tipo, p_moeda, 'efetivo', round(p_valor, 2),
          nullif(trim(coalesce(p_descricao, '')), ''), app.uid(), case when p_tipo = 'sangria' then p_destino end, v_desp,
          case when p_tipo = 'sangria' and p_destino = 'banco' then p_conta end)
  returning id into v_mov;
end $$;

revoke execute on function app.confirmar_recebimento_caixa(bigint, boolean, text), app.movimento_caixa(uuid, text, app.moeda, numeric, text, text, text, uuid) from public;
grant execute on function app.confirmar_recebimento_caixa(bigint, boolean, text), app.movimento_caixa(uuid, text, app.moeda, numeric, text, text, text, uuid) to vc_app;

-- Quem é responsável pela unidade (ex.: vendedora de CDE) vê e lança as contas da própria unidade
create policy unidade_ler on app.despesas for select using (deposito_id is not null and app.pode_operar_deposito(deposito_id));
create policy unidade_incluir on app.despesas for insert with check (deposito_id is not null and app.pode_operar_deposito(deposito_id) and app.perfil_atual() is not null);
create policy unidade_alterar on app.despesas for update using (deposito_id is not null and app.pode_operar_deposito(deposito_id))
  with check (deposito_id is not null and app.pode_operar_deposito(deposito_id));
create policy unidade_apagar on app.despesas for delete using (deposito_id is not null and app.pode_operar_deposito(deposito_id) and pago_em is null);
create policy unidade_ler on app.despesas_recorrentes for select using (deposito_id is not null and app.pode_operar_deposito(deposito_id));

-- A visão das despesas foi criada com d.* (colunas fixas na criação): recriada para ver unidade, nota e conta fixa
drop view app.v_despesas;
create view app.v_despesas with (security_invoker = true) as
select d.*, c.nome as categoria_nome, c.operacional, c.tipo as categoria_tipo,
       case when d.pago_em is not null then 'paga'
            when d.vencimento is null then 'sem_vencimento'
            when d.vencimento < current_date then 'vencida'
            when d.vencimento = current_date then 'vence_hoje'
            when d.vencimento <= current_date + 7 then 'vence_7_dias'
            else 'a_vencer' end as situacao
  from app.despesas d join app.despesa_categorias c on c.codigo = d.categoria;
grant select on app.v_despesas to vc_app;
