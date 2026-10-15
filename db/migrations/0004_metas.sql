-- =====================================================================
-- Migração 0004: metas de compra por cliente, com premiação
--
-- Fluxo:
--   vendedora propõe -> gerente/dono aprova ou recusa -> sistema acompanha
--   -> fim do prazo: atingida / não atingida
--   -> prêmio liberado só com as compras do período pagas e conferidas
--   -> gerente registra a entrega do prêmio
-- Exemplo: Gabriel compra Gs 20.000.000 em 30 dias e ganha Gs 1.000.000 em mercadoria.
-- =====================================================================

create type app.status_meta as enum
  ('proposta','aprovada','recusada','cancelada','atingida','nao_atingida','premio_entregue');
create type app.tipo_premio as enum ('mercadoria','desconto','outro');

create table app.metas_cliente (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references app.clientes(id),
  vendedora_id     uuid not null references app.vendedoras(id),
  inicio           date not null,
  fim              date not null,
  moeda            app.moeda not null,
  valor_meta       numeric(14,2) not null check (valor_meta > 0),
  tipo_premio      app.tipo_premio not null default 'mercadoria',
  valor_premio     numeric(14,2) not null check (valor_premio > 0),
  descricao_premio text,
  status           app.status_meta not null default 'proposta',
  proposta_por     uuid references app.usuarios(id),
  proposta_em      timestamptz not null default now(),
  decidida_por     uuid references app.usuarios(id),
  decidida_em      timestamptz,
  motivo_recusa    text,
  avaliada_em      timestamptz,
  valor_atingido   numeric(14,2),               -- congelado na avaliação
  premio_entregue_por uuid references app.usuarios(id),
  premio_entregue_em  timestamptz,
  premio_pedido_id uuid references app.pedidos(id),  -- pedido/bonificação com a mercadoria
  premio_observacao text,
  constraint periodo_valido check (fim >= inicio and fim - inicio <= 366),
  constraint premio_menor_que_meta check (valor_premio < valor_meta)
);
create index on app.metas_cliente (cliente_id, inicio);
create index on app.metas_cliente (vendedora_id, status);

-- Um cliente não pode ter duas metas ativas em períodos sobrepostos
create extension if not exists btree_gist;
alter table app.metas_cliente add constraint uma_meta_por_periodo
  exclude using gist (cliente_id with =, daterange(inicio, fim, '[]') with &&)
  where (status in ('proposta','aprovada','atingida','premio_entregue'));

-- Valores da proposta vêm do cadastro: moeda do cliente e vendedora dona do cliente
create or replace function app.preparar_meta() returns trigger language plpgsql as $$
declare c app.clientes;
begin
  if current_user in ('vc_app','vc_sync') then
    if tg_op = 'INSERT' then
      if new.status <> 'proposta' then
        raise exception 'Meta nova entra como proposta, aguardando o gerente.' using errcode = 'insufficient_privilege';
      end if;
      select * into c from app.clientes where id = new.cliente_id;
      new.vendedora_id := c.vendedora_id;
      new.moeda := c.moeda;
      new.proposta_por := app.uid();
      new.decidida_por := null; new.decidida_em := null;
    else
      if old.status <> 'proposta' then
        raise exception 'Meta já decidida não pode ser alterada. Cancele e proponha outra.' using errcode = 'insufficient_privilege';
      end if;
      if new.status is distinct from old.status and new.status <> 'cancelada' then
        raise exception 'Aprovação e recusa são feitas pelo gerente.' using errcode = 'insufficient_privilege';
      end if;
      if new.cliente_id is distinct from old.cliente_id or new.vendedora_id is distinct from old.vendedora_id
         or new.moeda is distinct from old.moeda or new.proposta_por is distinct from old.proposta_por
         or new.decidida_por is distinct from old.decidida_por then
        raise exception 'Campo protegido da meta.' using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger preparar before insert or update on app.metas_cliente
  for each row execute function app.preparar_meta();

-- Decisão do gerente
create or replace function app.decidir_meta(p_meta uuid, p_aprovar boolean, p_motivo text default null)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono aprova metas.' using errcode = 'insufficient_privilege';
  end if;
  if not p_aprovar and coalesce(trim(p_motivo),'') = '' then
    raise exception 'Informe o motivo da recusa.';
  end if;
  update app.metas_cliente
     set status = case when p_aprovar then 'aprovada'::app.status_meta else 'recusada'::app.status_meta end,
         decidida_por = app.uid(), decidida_em = now(),
         motivo_recusa = case when p_aprovar then null else p_motivo end
   where id = p_meta and status = 'proposta';
  if not found then raise exception 'Meta não encontrada ou já decidida.'; end if;
end $$;

-- Avaliação ao fim do prazo (rodada todo dia pela rotina do sistema e
-- também pode ser chamada pelo gerente). Congela o valor atingido.
create or replace function app.avaliar_metas(p_hoje date default current_date)
returns int language plpgsql security definer set search_path = app, pg_temp as $$
declare n int;
begin
  with apuracao as (
    select m.id,
           coalesce(sum(p.valor_total) filter (where p.status_comercial <> 'cancelado'), 0) as vendido
      from app.metas_cliente m
      left join app.pedidos p on p.cliente_id = m.cliente_id and p.moeda = m.moeda
                              and p.data_pedido between m.inicio and m.fim
     where m.status = 'aprovada' and m.fim < p_hoje
     group by m.id)
  update app.metas_cliente m
     set status = case when a.vendido >= m.valor_meta then 'atingida'::app.status_meta else 'nao_atingida'::app.status_meta end,
         valor_atingido = a.vendido, avaliada_em = now()
    from apuracao a where a.id = m.id;
  get diagnostics n = row_count;
  return n;
end $$;

-- Entrega do prêmio: só com meta atingida e compras do período quitadas
create or replace function app.entregar_premio(p_meta uuid, p_pedido_premio uuid default null, p_obs text default null)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare m app.metas_cliente; v_pendente numeric;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono registra a entrega do prêmio.' using errcode = 'insufficient_privilege';
  end if;
  select * into m from app.metas_cliente where id = p_meta for update;
  if not found then raise exception 'Meta não encontrada.'; end if;
  if m.status <> 'atingida' then raise exception 'O prêmio só pode ser entregue para meta atingida.'; end if;
  select coalesce(sum(v.saldo), 0) into v_pendente
    from app.v_pedidos v
   where v.cliente_id = m.cliente_id and v.moeda = m.moeda
     and v.data_pedido between m.inicio and m.fim and v.status_comercial <> 'cancelado';
  if v_pendente > 0 then
    raise exception 'Prêmio bloqueado: ainda há % a receber dos pedidos do período.', v_pendente;
  end if;
  update app.metas_cliente
     set status = 'premio_entregue', premio_entregue_por = app.uid(), premio_entregue_em = now(),
         premio_pedido_id = p_pedido_premio, premio_observacao = p_obs
   where id = p_meta;
end $$;

-- Acompanhamento em tempo real
create or replace view app.v_metas with (security_invoker = true) as
select m.*,
       c.nome as cliente_nome,
       v.nome as vendedora_nome,
       coalesce(x.vendido, 0)  as vendido,
       coalesce(x.recebido, 0) as recebido,
       coalesce(x.saldo, 0)    as saldo_em_aberto,
       greatest(m.valor_meta - coalesce(x.vendido, 0), 0) as falta,
       least(round(coalesce(x.vendido, 0) / m.valor_meta * 100, 1), 100) as percentual,
       greatest(m.fim - current_date, 0) as dias_restantes,
       (coalesce(x.vendido, 0) >= m.valor_meta) as meta_batida,
       (m.status = 'atingida' and coalesce(x.saldo, 0) = 0) as premio_liberado
  from app.metas_cliente m
  join app.clientes c on c.id = m.cliente_id
  join app.vendedoras v on v.id = m.vendedora_id
  left join lateral (
    select sum(p.valor_total) as vendido, sum(p.recebido) as recebido, sum(p.saldo) as saldo
      from app.v_pedidos p
     where p.cliente_id = m.cliente_id and p.moeda = m.moeda
       and p.data_pedido between m.inicio and m.fim and p.status_comercial <> 'cancelado'
  ) x on true;

-- Auditoria e permissões
create trigger auditar after insert or update or delete on app.metas_cliente
  for each row execute function app.auditar('id');

alter table app.metas_cliente enable row level security;
create policy ler on app.metas_cliente for select using (app.ve_pedido(vendedora_id));
create policy propor on app.metas_cliente for insert with check (
  app.pode_escrever() and exists (select 1 from app.clientes c where c.id = cliente_id));
create policy alterar on app.metas_cliente for update using (
  app.pode_gerir() or (app.perfil_atual() = 'vendedora' and vendedora_id = app.minha_vendedora()));

grant select, insert, update on app.metas_cliente to vc_app;
grant execute on function app.decidir_meta(uuid, boolean, text), app.entregar_premio(uuid, uuid, text),
  app.avaliar_metas(date) to vc_app;
grant execute on function app.avaliar_metas(date) to vc_sync;
grant execute on function app.preparar_meta() to vc_app, vc_sync;
grant select on app.v_metas to vc_app;
