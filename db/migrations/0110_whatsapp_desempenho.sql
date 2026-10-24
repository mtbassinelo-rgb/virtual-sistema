-- =====================================================================
-- Migração 0110: desempenho das vendedoras pelo WhatsApp
--
-- Um número pode ser atendido por mais de uma vendedora:
--   whatsapp_conexao_vendedoras = quem atende cada número.
-- De quem é cada conversa (nesta ordem):
--   1. quem assumiu a conversa (botão "Assumir" ou gerente escolheu);
--   2. a vendedora dona do cliente no cadastro (casado pelo número);
--   3. a única vendedora do número, se só uma atende.
--   Senão fica "sem vendedora" até alguém assumir ou o cliente ser cadastrado.
-- =====================================================================

create table app.whatsapp_conexao_vendedoras (
  conexao_id    uuid not null references app.whatsapp_conexoes(id),
  vendedora_id  uuid not null references app.vendedoras(id),
  primary key (conexao_id, vendedora_id)
);
insert into app.whatsapp_conexao_vendedoras
  select id, vendedora_id from app.whatsapp_conexoes where vendedora_id is not null on conflict do nothing;
create trigger auditar after insert or update or delete on app.whatsapp_conexao_vendedoras
  for each row execute function app.auditar('conexao_id');
alter table app.whatsapp_conexao_vendedoras enable row level security;
create policy ler on app.whatsapp_conexao_vendedoras for select using (app.uid() is not null);
create policy gerir on app.whatsapp_conexao_vendedoras for all using (app.pode_gerir()) with check (app.pode_gerir());
grant select, insert, delete on app.whatsapp_conexao_vendedoras to vc_app;

alter table app.whatsapp_contatos
  add column vendedora_id  uuid references app.vendedoras(id),
  add column atribuido_por uuid references app.usuarios(id),
  add column atribuido_em  timestamptz;

-- A vendedora vê os números em que atende (não só o "principal")
create or replace function app.ve_conexao_whatsapp(p_conexao uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select app.e_gestao() or (app.perfil_atual() = 'vendedora' and (
    exists (select 1 from app.whatsapp_conexoes w where w.id = p_conexao and w.vendedora_id = app.minha_vendedora())
    or exists (select 1 from app.whatsapp_conexao_vendedoras x where x.conexao_id = p_conexao and x.vendedora_id = app.minha_vendedora())))
$$;

-- Assumir uma conversa: gerente/dono escolhe qualquer vendedora (ou tira, com null);
-- a vendedora só assume para ela mesma, num número em que atende, e se ninguém assumiu antes.
create or replace function app.whatsapp_atribuir(p_conexao uuid, p_contato text, p_vendedora uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_atual uuid;
begin
  if app.perfil_atual() is null then raise exception 'Entre no sistema.' using errcode = 'insufficient_privilege'; end if;
  select vendedora_id into v_atual from app.whatsapp_contatos where conexao_id = p_conexao and contato = p_contato for update;
  if not found then raise exception 'Conversa não encontrada.'; end if;
  if not app.pode_gerir() then
    if app.perfil_atual() <> 'vendedora' or p_vendedora is distinct from app.minha_vendedora() or not app.ve_conexao_whatsapp(p_conexao) then
      raise exception 'Só gerente ou dono passa a conversa para outra pessoa.' using errcode = 'insufficient_privilege';
    end if;
    if v_atual is not null and v_atual <> p_vendedora then
      raise exception 'Esta conversa já é de outra vendedora. Peça ao gerente para trocar.' using errcode = 'insufficient_privilege';
    end if;
  end if;
  update app.whatsapp_contatos set vendedora_id = p_vendedora, atribuido_por = app.uid(), atribuido_em = now()
   where conexao_id = p_conexao and contato = p_contato;
  insert into app.auditoria (usuario_id, executor, tabela, registro_id, acao, antes, depois)
  values (app.uid(), session_user, 'whatsapp_contatos', p_conexao || '/' || p_contato, 'UPDATE',
          jsonb_build_object('vendedora_id', v_atual), jsonb_build_object('vendedora_id', p_vendedora));
end $$;
grant execute on function app.whatsapp_atribuir(uuid, text, uuid) to vc_app;

-- Horário comercial (fuso do Paraguai): o tempo de resposta só conta dentro dele.
-- Mensagem que chega de noite começa a contar quando a loja abre.
insert into app.parametros (chave, valor, descricao) values
  ('whatsapp_hora_abre',        8,  'WhatsApp: hora em que começa o horário comercial (tempo de resposta)'),
  ('whatsapp_hora_fecha',       18, 'WhatsApp: hora em que termina o horário comercial (segunda a sexta)'),
  ('whatsapp_hora_fecha_sabado', 12, 'WhatsApp: hora em que termina o horário comercial no sábado (0 = sábado fechado)')
on conflict (chave) do nothing;

create or replace function app.minutos_comerciais(p_ini timestamptz, p_fim timestamptz) returns numeric
language plpgsql stable set search_path = app, pg_temp as $$
declare
  abre numeric := coalesce((select valor from app.parametros where chave = 'whatsapp_hora_abre'), 8);
  fecha numeric := coalesce((select valor from app.parametros where chave = 'whatsapp_hora_fecha'), 18);
  fecha_sab numeric := coalesce((select valor from app.parametros where chave = 'whatsapp_hora_fecha_sabado'), 12);
  a timestamp := p_ini at time zone 'America/Asuncion';
  b timestamp := least(p_fim, p_ini + interval '21 days') at time zone 'America/Asuncion';
  d date; ja timestamp; jf timestamp; f numeric; total numeric := 0;
begin
  if p_fim is null or p_ini is null or p_fim <= p_ini then return 0; end if;
  d := a::date;
  while d <= b::date loop
    f := case extract(isodow from d) when 7 then 0 when 6 then fecha_sab else fecha end;
    if f > abre then
      ja := greatest(a, d + make_interval(mins => (abre * 60)::int));
      jf := least(b, d + make_interval(mins => (f * 60)::int));
      if jf > ja then total := total + extract(epoch from jf - ja) / 60; end if;
    end if;
    d := d + 1;
  end loop;
  return round(total, 1);
end $$;
grant execute on function app.minutos_comerciais(timestamptz, timestamptz) to vc_app;

-- De quem é a conversa (ver regra no topo)
create or replace function app.whatsapp_responsavel(p_conexao uuid, p_contato text, out vendedora_id uuid, out atribuicao text, out cliente_id uuid)
language sql stable set search_path = app, pg_temp as $$
  with k as (select k.vendedora_id from app.whatsapp_contatos k where k.conexao_id = p_conexao and k.contato = p_contato),
  cli as (select c.id, c.vendedora_id from app.clientes c
           where p_contato not like 'lid:%' and c.mesclado_em is null
             and (app.zap8(c.whatsapp) = app.zap8(p_contato) or app.zap8(c.telefone) = app.zap8(p_contato))
           order by c.ativo desc, c.criado_em limit 1),
  vs as (select cv.vendedora_id from app.whatsapp_conexao_vendedoras cv where cv.conexao_id = p_conexao
         union select w.vendedora_id from app.whatsapp_conexoes w where w.id = p_conexao and w.vendedora_id is not null),
  unica as (select min(vendedora_id::text)::uuid as vendedora_id from vs having count(*) = 1)
  select coalesce((select vendedora_id from k), (select vendedora_id from cli), (select vendedora_id from unica)),
         case when (select vendedora_id from k) is not null then 'assumida' when (select vendedora_id from cli) is not null then 'cliente'
              when (select vendedora_id from unica) is not null then 'numero' end,
         (select id from cli)
$$;
grant execute on function app.whatsapp_responsavel(uuid, text) to vc_app;

-- Uma linha por conversa com mensagens no período, já com a vendedora responsável e os números da conversa.
-- tempos = minutos (só em horário comercial) até a nossa resposta, para cada vez que o cliente chamou e esperou.
create or replace function app.whatsapp_conversas(p_de date, p_ate date)
returns table (conexao_id uuid, contato text, vendedora_id uuid, atribuicao text, cliente_id uuid, cliente_novo boolean,
               contato_novo boolean, enviadas int, recebidas int, chamadas_nossas int, chamadas_cliente int,
               quem_iniciou boolean, respondeu boolean, sem_resposta boolean, espera_atual_min numeric, tempos numeric[],
               pedidos int, valor numeric, moeda app.moeda, primeira_msg timestamptz, ultima_msg timestamptz)
language sql stable set search_path = app, pg_temp as $$
  with per as (
    select (p_de::timestamp at time zone 'America/Asuncion') as ini, ((p_ate + 1)::timestamp at time zone 'America/Asuncion') as fim),
  m as (
    select x.conexao_id, x.contato, x.enviada, x.em,
           lag(x.em) over w as ant_em, lag(x.enviada) over w as ant_env
      from app.whatsapp_mensagens x, per
     where x.em >= per.ini - interval '3 days' and x.em < per.fim
    window w as (partition by x.conexao_id, x.contato order by x.em)),
  mp as (select m.* from m, per where m.em >= per.ini),
  base as (
    select conexao_id, contato,
           count(*) filter (where enviada)::int as enviadas, count(*) filter (where not enviada)::int as recebidas,
           count(*) filter (where enviada and (ant_em is null or em - ant_em > interval '12 hours'))::int as chamadas_nossas,
           count(*) filter (where not enviada and (ant_em is null or em - ant_em > interval '12 hours'))::int as chamadas_cliente,
           (array_agg(enviada order by em) filter (where ant_em is null or em - ant_em > interval '12 hours'))[1] as quem_iniciou,
           min(em) as primeira_msg, max(em) as ultima_msg,
           (array_agg(enviada order by em desc))[1] as ultima_nossa
      from mp group by 1, 2),
  esp as (
    select i.conexao_id, i.contato,
           array_agg(app.minutos_comerciais(i.em, r.em) order by i.em) filter (where r.em is not null) as tempos
      from mp i
      left join lateral (select min(y.em) as em from app.whatsapp_mensagens y
                          where y.conexao_id = i.conexao_id and y.contato = i.contato and y.enviada and y.em > i.em) r on true
     where not i.enviada and i.ant_env is distinct from false
     group by 1, 2)
  select b.conexao_id, b.contato,
         rs.vendedora_id, rs.atribuicao,
         cli.id, coalesce(cli.criado_em >= per.ini, false), k.primeira_em >= per.ini,
         b.enviadas, b.recebidas, b.chamadas_nossas, b.chamadas_cliente, b.quem_iniciou,
         b.recebidas > 0, not b.ultima_nossa,
         case when not b.ultima_nossa then app.minutos_comerciais(b.ultima_msg, now()) end,
         coalesce(e.tempos, '{}'),
         coalesce(ped.n, 0), coalesce(ped.valor, 0), coalesce(cli.moeda, case when w.pais = 'PY' then 'GS' else 'BRL' end::app.moeda),
         b.primeira_msg, b.ultima_msg
    from base b
    cross join per
    join app.whatsapp_conexoes w on w.id = b.conexao_id
    join app.whatsapp_contatos k on k.conexao_id = b.conexao_id and k.contato = b.contato
    left join esp e on e.conexao_id = b.conexao_id and e.contato = b.contato
    cross join lateral app.whatsapp_responsavel(b.conexao_id, b.contato) rs
    left join app.clientes cli on cli.id = rs.cliente_id
    -- pedido conta se é do cliente, a partir do dia em que a conversa começou no período
    left join lateral (
      select count(*)::int as n, sum(p.valor_total) as valor from app.pedidos p
       where p.cliente_id = cli.id and p.status_comercial <> 'cancelado'
         and p.data_pedido between (b.primeira_msg at time zone 'America/Asuncion')::date and p_ate) ped on true
$$;
grant execute on function app.whatsapp_conversas(date, date) to vc_app;
