-- =====================================================================
-- Marcas-gatilho do motor de inteligência (PY).
-- O gerente escolhe quais marcas o motor trabalha e o papel de cada uma
-- (atração, rentabilidade, diferenciação, acompanhar), com margem-alvo opcional.
-- Para os produtos dessas marcas o motor gera SUGESTÕES de preço normal e VIP.
-- Nada aqui altera preço de venda: a sugestão só é aceita ou recusada (registro da decisão).
-- =====================================================================

insert into app.parametros (chave, valor, descricao) values
  ('margem_alvo_normal', 35, 'Inteligência: margem de contribuição alvo do preço normal PY (%)'),
  ('margem_alvo_vip', 25, 'Inteligência: margem de contribuição alvo do preço VIP PY (%)'),
  ('sugestao_tolerancia_pct', 3, 'Inteligência: só sugere quando o preço atual difere do sugerido mais que N%')
on conflict (chave) do nothing;

create table app.marcas_inteligencia (
  marca text primary key check (length(trim(marca)) between 1 and 80),
  gatilho boolean not null default true,
  papel text not null default 'acompanhar' check (papel in ('atracao','rentabilidade','diferenciacao','acompanhar')),
  margem_alvo_normal numeric(5,2) check (margem_alvo_normal between 0 and 90),
  margem_alvo_vip numeric(5,2) check (margem_alvo_vip between 0 and 90),
  observacao text check (length(observacao) <= 300),
  definido_por uuid references app.usuarios(id),
  definido_em timestamptz not null default now()
);
comment on table app.marcas_inteligencia is 'Marcas que o motor de inteligência usa como gatilho (sugestões de preço e alertas). Só gestão altera.';

create or replace function app.definir_marca_inteligencia(p_marca text, p_gatilho boolean, p_papel text,
  p_margem_normal numeric default null, p_margem_vip numeric default null, p_obs text default null)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono define as marcas do motor.'; end if;
  if nullif(trim(p_marca), '') is null then raise exception 'Informe a marca.'; end if;
  if p_margem_normal is not null and p_margem_vip is not null and p_margem_vip > p_margem_normal then
    raise exception 'A margem VIP não pode ser maior que a normal.';
  end if;
  insert into app.marcas_inteligencia (marca, gatilho, papel, margem_alvo_normal, margem_alvo_vip, observacao, definido_por, definido_em)
  values (trim(p_marca), coalesce(p_gatilho, true), coalesce(p_papel, 'acompanhar'), p_margem_normal, p_margem_vip, nullif(trim(p_obs), ''), app.uid(), now())
  on conflict (marca) do update set gatilho = excluded.gatilho, papel = excluded.papel,
    margem_alvo_normal = excluded.margem_alvo_normal, margem_alvo_vip = excluded.margem_alvo_vip,
    observacao = excluded.observacao, definido_por = excluded.definido_por, definido_em = now();
end $$;

-- Marcas existentes com resumo para a tela de escolha (gestão)
create or replace function app.marcas_resumo_py()
returns table (marca text, produtos int, completos int, vendido_90 numeric, contribuicao_media_vip numeric,
               gatilho boolean, papel text, margem_alvo_normal numeric, margem_alvo_vip numeric, observacao text)
language plpgsql stable security definer set search_path = app, pg_temp as $$
#variable_conflict use_column
begin
  if not coalesce(app.e_gestao(), false) then raise exception 'Só gestão.'; end if;
  return query
  select coalesce(nullif(trim(r.marca), ''), 'Sem marca') as m, count(*)::int, count(*) filter (where r.completo)::int,
         coalesce(sum(r.vendido_90), 0), round(avg(r.contribuicao_vip) filter (where r.completo), 4),
         coalesce(mi.gatilho, false), coalesce(mi.papel, 'acompanhar'), mi.margem_alvo_normal, mi.margem_alvo_vip, mi.observacao
    from app.rentabilidade_py() r
    left join app.marcas_inteligencia mi on mi.marca = coalesce(nullif(trim(r.marca), ''), 'Sem marca')
   group by 1, mi.gatilho, mi.papel, mi.margem_alvo_normal, mi.margem_alvo_vip, mi.observacao
   order by coalesce(mi.gatilho, false) desc, 4 desc, 1;
end $$;

-- Sugestões de preço (simulação). Preço = (custo real + entrega por unidade) ÷ (1 − impostos − margem-alvo), arredondado.
-- Atração: aceita margem-alvo menor (o próprio alvo da marca manda). Nunca abaixo do preço mínimo.
create or replace function app.sugestoes_preco_py()
returns table (produto_id uuid, codigo text, nome text, marca text, papel text, vendido_90 numeric,
               custo_real_gs numeric, entrega_unidade_gs numeric, preco_minimo numeric,
               preco_normal numeric, normal_sugerido numeric, dif_normal_pct numeric, margem_normal_atual numeric, alvo_normal numeric,
               preco_vip numeric, vip_sugerido numeric, dif_vip_pct numeric, margem_vip_atual numeric, alvo_vip numeric,
               motivo text)
language plpgsql stable security definer set search_path = app, pg_temp as $$
#variable_conflict use_column
declare v_an numeric := coalesce(app.param('margem_alvo_normal'), 35);
        v_av numeric := coalesce(app.param('margem_alvo_vip'), 25);
        v_tol numeric := coalesce(app.param('sugestao_tolerancia_pct'), 3) / 100;
        v_arred numeric := greatest(coalesce(app.param('arredondamento_gs'), 500), 1);
begin
  if not coalesce(app.e_gestao(), false) then raise exception 'Só gestão vê as sugestões.'; end if;
  return query
  with r as (
    select r.*, mi.papel as pap,
           coalesce(mi.margem_alvo_normal, v_an) as an, coalesce(mi.margem_alvo_vip, v_av) as av
      from app.rentabilidade_py() r
      join app.marcas_inteligencia mi on mi.marca = coalesce(nullif(trim(r.marca), ''), 'Sem marca') and mi.gatilho
     where r.custo_brl is not null and r.frete_brl is not null and r.unidades_caixa is not null
  ), s as (
    select r.*,
           greatest(coalesce(r.preco_minimo, 0), case when 1 - r.impostos_pct / 100 - r.an / 100 > 0 then
             ceil(((r.custo_real_gs + r.entrega_unidade_gs) / (1 - r.impostos_pct / 100 - r.an / 100)) / v_arred) * v_arred end) as sn,
           greatest(coalesce(r.preco_minimo, 0), case when 1 - r.impostos_pct / 100 - r.av / 100 > 0 then
             ceil(((r.custo_real_gs + r.entrega_unidade_gs) / (1 - r.impostos_pct / 100 - r.av / 100)) / v_arred) * v_arred end) as sv
      from r
  ), d as (
    select s.*, (s.preco_normal - s.sn) / nullif(s.sn, 0) as dn, (s.preco_vip - s.sv) / nullif(s.sv, 0) as dv from s
  )
  select d.produto_id, d.codigo, d.nome, d.marca, d.pap, d.vendido_90, d.custo_real_gs, d.entrega_unidade_gs, d.preco_minimo,
         d.preco_normal, d.sn, round(d.dn, 4), d.contribuicao_normal, d.an / 100,
         d.preco_vip, d.sv, round(d.dv, 4), d.contribuicao_vip, d.av / 100,
         case
           when d.preco_normal is null or d.preco_vip is null then 'sem_preco'
           when d.preco_vip < d.preco_minimo or d.preco_normal < d.preco_minimo then 'abaixo_minimo'
           when d.dv < -v_tol or d.dn < -v_tol then 'margem_abaixo_alvo'
           when d.dv > v_tol or d.dn > v_tol then 'margem_acima_alvo'
           else 'no_alvo'
         end
    from d
   order by case when d.preco_vip < d.preco_minimo then 0 when d.preco_normal is null or d.preco_vip is null then 1 else 2 end,
            d.vendido_90 desc nulls last, d.nome;
end $$;

-- Registro das sugestões geradas e da decisão do gestor (não mexe no preço)
create table app.sugestoes_preco (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references app.produtos(id),
  gerada_em timestamptz not null default now(),
  preco_normal_atual numeric(14,2), normal_sugerido numeric(14,2),
  preco_vip_atual numeric(14,2), vip_sugerido numeric(14,2),
  custo_real_gs numeric(14,2), motivo text not null,
  status text not null default 'pendente' check (status in ('pendente','aceita','recusada')),
  decidido_por uuid references app.usuarios(id), decidido_em timestamptz,
  observacao text check (length(observacao) <= 300)
);
create unique index sugestoes_preco_pendente on app.sugestoes_preco (produto_id) where status = 'pendente';

-- Gera (ou renova) as sugestões pendentes das marcas-gatilho. Devolve quantas ficaram pendentes.
create or replace function app.gerar_sugestoes_preco_py() returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare n int;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono gera sugestões.'; end if;
  delete from app.sugestoes_preco where status = 'pendente';
  insert into app.sugestoes_preco (produto_id, preco_normal_atual, normal_sugerido, preco_vip_atual, vip_sugerido, custo_real_gs, motivo)
  select s.produto_id, s.preco_normal, s.normal_sugerido, s.preco_vip, s.vip_sugerido, s.custo_real_gs, s.motivo
    from app.sugestoes_preco_py() s where s.motivo <> 'no_alvo';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function app.decidir_sugestao_preco(p_id uuid, p_status text, p_obs text default null) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono decide sugestões.'; end if;
  if p_status not in ('aceita','recusada') then raise exception 'Decisão inválida.'; end if;
  update app.sugestoes_preco set status = p_status, decidido_por = app.uid(), decidido_em = now(), observacao = nullif(trim(p_obs), '')
   where id = p_id and status = 'pendente';
  if not found then raise exception 'Sugestão não encontrada ou já decidida.'; end if;
end $$;

create trigger auditar after insert or update or delete on app.marcas_inteligencia for each row execute function app.auditar('marca');
create trigger auditar after update on app.sugestoes_preco for each row execute function app.auditar('id');

alter table app.marcas_inteligencia enable row level security;
alter table app.sugestoes_preco enable row level security;
create policy ler on app.marcas_inteligencia for select using (app.e_gestao());
create policy ler on app.sugestoes_preco for select using (app.e_gestao());
grant select on app.marcas_inteligencia, app.sugestoes_preco to vc_app;

revoke execute on function app.definir_marca_inteligencia(text, boolean, text, numeric, numeric, text), app.marcas_resumo_py(),
  app.sugestoes_preco_py(), app.gerar_sugestoes_preco_py(), app.decidir_sugestao_preco(uuid, text, text) from public;
grant execute on function app.definir_marca_inteligencia(text, boolean, text, numeric, numeric, text), app.marcas_resumo_py(),
  app.sugestoes_preco_py(), app.gerar_sugestoes_preco_py(), app.decidir_sugestao_preco(uuid, text, text) to vc_app;
