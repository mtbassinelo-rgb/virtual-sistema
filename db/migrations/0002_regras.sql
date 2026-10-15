-- =====================================================================
-- Migração 0002: regras de negócio, auditoria e permissões
--
-- Papéis do banco:
--   vc_app   -> a aplicação web. Sujeita a todas as regras (RLS).
--   vc_sync  -> a rotina de sincronização (Bling, planilhas). Só escreve na
--               cópia do Bling por meio de funções controladas.
-- Quem está usando a aplicação é informado por transação:
--   set local app.usuario_id = '<uuid>';
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'vc_app')  then create role vc_app  nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'vc_sync') then create role vc_sync nologin; end if;
end $$;

-- ---------------------------------------------------------------------
-- Contexto do usuário
-- ---------------------------------------------------------------------
create or replace function app.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('app.usuario_id', true), '')::uuid
$$;

create or replace function app.perfil_atual() returns app.perfil
language sql stable security definer set search_path = app, pg_temp as $$
  select perfil from app.usuarios where id = app.uid() and ativo
$$;

create or replace function app.minha_vendedora() returns uuid
language sql stable security definer set search_path = app, pg_temp as $$
  select vendedora_id from app.usuarios where id = app.uid() and ativo
$$;

create or replace function app.e_gestao() returns boolean
language sql stable as $$ select app.perfil_atual() in ('dono','gerente','consulta') $$;

create or replace function app.pode_gerir() returns boolean
language sql stable as $$ select app.perfil_atual() in ('dono','gerente') $$;

create or replace function app.pode_escrever() returns boolean
language sql stable as $$ select app.perfil_atual() in ('dono','gerente','vendedora') $$;

-- Pedido visível para o usuário atual
create or replace function app.ve_pedido(p_vendedora uuid) returns boolean
language sql stable as $$
  select app.e_gestao() or (app.perfil_atual() = 'vendedora' and p_vendedora = app.minha_vendedora())
$$;

-- ---------------------------------------------------------------------
-- Auditoria (somente inclusão)
-- ---------------------------------------------------------------------
create table app.auditoria (
  id           bigserial primary key,
  em           timestamptz not null default clock_timestamp(),
  usuario_id   uuid,
  executor     text not null,                 -- papel do banco (vc_app, vc_sync...)
  tabela       text not null,
  registro_id  text,
  acao         text not null,                 -- INSERT / UPDATE / DELETE
  antes        jsonb,
  depois       jsonb,
  motivo       text
);
create index on app.auditoria (tabela, registro_id, em);
create index on app.auditoria (usuario_id, em);

create or replace function app.auditar() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_antes jsonb; v_depois jsonb; v_id text; k text;
begin
  if tg_op = 'INSERT' then
    v_depois := to_jsonb(new); v_id := v_depois->>(tg_argv[0]);
  elsif tg_op = 'DELETE' then
    v_antes := to_jsonb(old); v_id := v_antes->>(tg_argv[0]);
  else
    v_antes := '{}'; v_depois := '{}';
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if (to_jsonb(new)->k) is distinct from (to_jsonb(old)->k) and k not in ('atualizado_em') then
        v_antes := v_antes || jsonb_build_object(k, to_jsonb(old)->k);
        v_depois := v_depois || jsonb_build_object(k, to_jsonb(new)->k);
      end if;
    end loop;
    if v_depois = '{}' then return new; end if;   -- nada mudou de fato
    v_id := to_jsonb(new)->>(tg_argv[0]);
  end if;
  insert into app.auditoria (usuario_id, executor, tabela, registro_id, acao, antes, depois, motivo)
  values (app.uid(), coalesce(nullif(current_setting('role', true), 'none'), session_user), tg_table_name, v_id, tg_op, v_antes, v_depois,
          nullif(current_setting('app.motivo', true), ''));
  return coalesce(new, old);
end $$;

create or replace function app.auditoria_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'A auditoria não pode ser alterada nem apagada.' using errcode = 'insufficient_privilege';
end $$;
create trigger auditoria_sem_update before update or delete on app.auditoria
  for each row execute function app.auditoria_imutavel();
create trigger auditoria_sem_truncate before truncate on app.auditoria
  for each statement execute function app.auditoria_imutavel();

do $$
declare t text; pk text;
begin
  for t, pk in values
    ('vendedoras','id'),('usuarios','id'),('canais','codigo'),('clientes','id'),
    ('cliente_nomes_planilha','cliente_id'),('pedidos','id'),('pagamentos','id'),
    ('comprovantes','id'),('atendimentos','id'),('tarefas','id'),
    ('escritas_externas','id'),('integracoes','codigo'),('bling_pedidos','bling_id')
  loop
    execute format('create trigger auditar after insert or update or delete on app.%I
                    for each row execute function app.auditar(%L)', t, pk);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Proteções de integridade
-- ---------------------------------------------------------------------
create or replace function app.tocar_atualizado() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
create trigger tocar before update on app.pedidos  for each row execute function app.tocar_atualizado();
create trigger tocar before update on app.clientes for each row execute function app.tocar_atualizado();

-- Campos que vêm do Bling não podem ser alterados pela aplicação.
-- Só as funções controladas (que rodam como dono do esquema) podem.
create or replace function app.proteger_pedido() returns trigger language plpgsql as $$
begin
  if current_user in ('vc_app','vc_sync') then
    if new.origem is distinct from old.origem
       or new.bling_id is distinct from old.bling_id
       or new.bling_numero is distinct from old.bling_numero then
      raise exception 'Origem e vínculo com o Bling só mudam pela sincronização ou pela conferência.'
        using errcode = 'insufficient_privilege';
    end if;
    if old.origem = 'bling' and (
         new.valor_total is distinct from old.valor_total
      or new.data_pedido is distinct from old.data_pedido
      or new.moeda is distinct from old.moeda
      or new.canal is distinct from old.canal
      or new.numero_externo is distinct from old.numero_externo) then
      raise exception 'Este pedido vem do Bling: valor, data, moeda e canal só mudam no Bling.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;
create trigger proteger before update on app.pedidos for each row execute function app.proteger_pedido();

create or replace function app.proteger_pedido_insert() returns trigger language plpgsql as $$
begin
  if current_user in ('vc_app','vc_sync') and (new.origem = 'bling' or new.bling_id is not null or new.bling_numero is not null) then
    raise exception 'Pedidos do Bling só são criados pela sincronização.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger proteger_insert before insert on app.pedidos for each row execute function app.proteger_pedido_insert();

-- Pagamento: a aplicação só registra e edita enquanto está pendente.
-- Conferir e recusar acontecem pelas funções conferir_pagamento / recusar_pagamento.
create or replace function app.proteger_pagamento() returns trigger language plpgsql as $$
begin
  if current_user in ('vc_app','vc_sync') then
    if tg_op = 'INSERT' then
      if new.status_conferencia <> 'pendente' or new.conferido_por is not null or new.conferencia_bling_numero is not null then
        raise exception 'Pagamento novo entra como pendente de conferência.' using errcode = 'insufficient_privilege';
      end if;
      new.registrado_por := app.uid();
    else
      if old.status_conferencia <> 'pendente' then
        raise exception 'Pagamento já conferido ou recusado não pode ser alterado.' using errcode = 'insufficient_privilege';
      end if;
      if new.status_conferencia is distinct from old.status_conferencia
         or new.conferido_por is distinct from old.conferido_por
         or new.conferido_em is distinct from old.conferido_em
         or new.conferencia_bling_numero is distinct from old.conferencia_bling_numero
         or new.pedido_id is distinct from old.pedido_id
         or new.registrado_por is distinct from old.registrado_por then
        raise exception 'A conferência é feita pelo gerente, com o número do pedido no Bling.' using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger proteger before insert or update on app.pagamentos for each row execute function app.proteger_pagamento();

-- ---------------------------------------------------------------------
-- Conferência de pagamentos
-- ---------------------------------------------------------------------
create or replace function app.conferir_pagamento(p_pagamento uuid, p_bling_numero bigint)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare v_pag app.pagamentos; v_ped app.pedidos;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono confere pagamentos.' using errcode = 'insufficient_privilege';
  end if;
  if p_bling_numero is null then
    raise exception 'Informe o número do pedido no Bling para conferir.';
  end if;
  select * into v_pag from app.pagamentos where id = p_pagamento for update;
  if not found then raise exception 'Pagamento não encontrado.'; end if;
  if v_pag.status_conferencia <> 'pendente' then raise exception 'Este pagamento já foi conferido ou recusado.'; end if;
  select * into v_ped from app.pedidos where id = v_pag.pedido_id for update;
  if v_ped.status_comercial = 'cancelado' then raise exception 'Pedido cancelado: não é possível conferir pagamento.'; end if;
  if v_ped.bling_numero is null then
    if exists (select 1 from app.pedidos where bling_numero = p_bling_numero) then
      raise exception 'O pedido % do Bling já está ligado a outro pedido do sistema.', p_bling_numero;
    end if;
    update app.pedidos set bling_numero = p_bling_numero,
           bling_id = coalesce(bling_id, (select bling_id from app.bling_pedidos where numero = p_bling_numero))
     where id = v_ped.id;
  elsif v_ped.bling_numero <> p_bling_numero then
    raise exception 'Número do Bling não confere: este pedido é o % no Bling.', v_ped.bling_numero;
  end if;
  update app.pagamentos
     set status_conferencia = 'conferido', conferido_por = app.uid(), conferido_em = now(),
         conferencia_bling_numero = p_bling_numero
   where id = p_pagamento;
end $$;

create or replace function app.recusar_pagamento(p_pagamento uuid, p_motivo text)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono recusa pagamentos.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_motivo),'') = '' then raise exception 'Informe o motivo da recusa.'; end if;
  update app.pagamentos
     set status_conferencia = 'recusado', conferido_por = app.uid(), conferido_em = now(), motivo_recusa = p_motivo
   where id = p_pagamento and status_conferencia = 'pendente';
  if not found then raise exception 'Pagamento não encontrado ou já conferido.'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Sincronização com o Bling (somente leitura do Bling -> cópia local)
-- Formato esperado: pedido de venda da API v3 do Bling.
-- O mapeamento fica concentrado aqui para ser ajustado com dados reais.
-- ---------------------------------------------------------------------
create or replace function app.bling_upsert_pedido(p jsonb)
returns text language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_id bigint := (p->>'id')::bigint;
  v_hash text := md5(p::text);
  v_old app.bling_pedidos;
  v_vend app.vendedoras;
  v_ped uuid;
  v_canal text;
  v_res text;
begin
  if v_id is null then raise exception 'Pedido do Bling sem id.'; end if;
  select * into v_old from app.bling_pedidos where bling_id = v_id;
  if found and v_old.conteudo_hash = v_hash then
    update app.bling_pedidos set sincronizado_em = now() where bling_id = v_id;
    return 'sem_mudanca';
  end if;

  insert into app.bling_pedidos as b (bling_id, numero, numero_loja, loja_id, data, data_prevista,
      contato_bling_id, contato_nome, vendedor_bling_id, situacao_id, situacao_nome, total, total_produtos,
      itens, payload, conteudo_hash, sincronizado_em, mudou_em)
  values (v_id, (p->>'numero')::bigint, nullif(p->>'numeroLoja',''), (p->'loja'->>'id')::bigint,
      (p->>'data')::date, nullif(p->>'dataPrevista','')::date,
      (p->'contato'->>'id')::bigint, p->'contato'->>'nome', nullif((p->'vendedor'->>'id')::bigint, 0),
      (p->'situacao'->>'id')::bigint, coalesce(p->'situacao'->>'nome', p->'situacao'->>'valor'),
      (p->>'total')::numeric, (p->>'totalProdutos')::numeric,
      coalesce(p->'itens','[]'), p, v_hash, now(), now())
  on conflict (bling_id) do update set
      numero = excluded.numero, numero_loja = excluded.numero_loja, loja_id = excluded.loja_id,
      data = excluded.data, data_prevista = excluded.data_prevista,
      contato_bling_id = excluded.contato_bling_id, contato_nome = excluded.contato_nome,
      vendedor_bling_id = excluded.vendedor_bling_id, situacao_id = excluded.situacao_id,
      situacao_nome = excluded.situacao_nome, total = excluded.total, total_produtos = excluded.total_produtos,
      itens = excluded.itens, payload = excluded.payload, conteudo_hash = excluded.conteudo_hash,
      sincronizado_em = now(), mudou_em = now();
  v_res := case when v_old.bling_id is null then 'criado' else 'atualizado' end;

  -- Já existe pedido do sistema para este Bling?
  select id into v_ped from app.pedidos where bling_id = v_id;
  if v_ped is null then
    -- Pedido da planilha ou conferido com este número: só liga, sem trocar a origem
    select id into v_ped from app.pedidos where bling_numero = (p->>'numero')::bigint and bling_id is null;
    if v_ped is not null then
      update app.pedidos set bling_id = v_id where id = v_ped;
      return v_res || '_vinculado';
    end if;
    select * into v_vend from app.vendedoras where bling_vendedor_id = (p->'vendedor'->>'id')::bigint;
    if v_vend.id is null then
      return v_res || '_sem_vendedora';         -- fica só na cópia até a vendedora ser vinculada
    end if;
    select codigo into v_canal from app.canais where bling_loja_id = (p->'loja'->>'id')::bigint;
    insert into app.pedidos (origem, bling_id, bling_numero, canal, numero_externo, cliente_id, vendedora_id,
        data_pedido, moeda, valor_total, previsao_envio)
    values ('bling', v_id, (p->>'numero')::bigint, coalesce(v_canal,'direto'), nullif(p->>'numeroLoja',''),
        (select id from app.clientes where bling_contato_id = (p->'contato'->>'id')::bigint),
        v_vend.id, (p->>'data')::date, v_vend.moeda, coalesce((p->>'total')::numeric, 0),
        nullif(p->>'dataPrevista','')::date)
    on conflict do nothing;
    return v_res;
  else
    -- Pedido de origem Bling acompanha os valores oficiais
    update app.pedidos set valor_total = coalesce((p->>'total')::numeric, valor_total),
                           data_pedido = coalesce((p->>'data')::date, data_pedido)
     where id = v_ped and origem = 'bling';
    return v_res;
  end if;
end $$;

-- Marca que alguém revisou a versão atual do pedido no Bling
create or replace function app.reconhecer_mudanca_bling(p_pedido uuid)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.pode_escrever() then raise exception 'Sem permissão.' using errcode = 'insufficient_privilege'; end if;
  update app.pedidos p set bling_hash_conferido = b.conteudo_hash
    from app.bling_pedidos b
   where p.id = p_pedido and b.bling_id = p.bling_id and app.ve_pedido(p.vendedora_id);
  if not found then raise exception 'Pedido sem vínculo com o Bling ou sem acesso.'; end if;
end $$;

-- Escritas externas: só o dono aprova; a execução fica para a fase de escrita
create or replace function app.decidir_escrita(p_id uuid, p_aprovar boolean)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if app.perfil_atual() <> 'dono' then
    raise exception 'Só o dono aprova escritas em sistemas externos.' using errcode = 'insufficient_privilege';
  end if;
  update app.escritas_externas
     set status = case when p_aprovar then 'aprovada' else 'recusada' end,
         aprovado_por = app.uid(), aprovado_em = now()
   where id = p_id and status = 'proposta';
  if not found then raise exception 'Proposta não encontrada ou já decidida.'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Visão financeira e operacional do pedido
-- ---------------------------------------------------------------------
create or replace view app.v_pedidos with (security_invoker = true) as
with pg as (
  select pedido_id,
         coalesce(sum(valor) filter (where status_conferencia = 'conferido'), 0) as recebido,
         coalesce(sum(valor) filter (where status_conferencia = 'pendente'), 0)  as a_conferir,
         count(*) filter (where status_conferencia = 'pendente')                 as qtd_a_conferir
    from app.pagamentos group by pedido_id
)
select p.*,
       coalesce(pg.recebido, 0)   as recebido,
       coalesce(pg.a_conferir, 0) as a_conferir,
       coalesce(pg.qtd_a_conferir, 0) as qtd_a_conferir,
       case when p.status_comercial = 'cancelado' then 0
            else greatest(p.valor_total - coalesce(pg.recebido, 0), 0) end as saldo,
       case
         when p.status_comercial = 'cancelado'                                   then 'cancelado'
         when p.valor_total - coalesce(pg.recebido, 0) <= 0                       then 'pago'
         when p.vencimento is not null and p.vencimento < current_date            then 'atrasado'
         when coalesce(pg.recebido, 0) > 0                                         then 'parcial'
         when p.credito_concedido                                                   then 'a_credito'
         else 'aguardando'
       end as status_pagamento,
       (p.status_comercial = 'em_separacao' and p.previsao_envio < current_date) as envio_atrasado,
       (b.bling_id is not null and p.bling_hash_conferido is distinct from b.conteudo_hash) as bling_mudou,
       b.total as bling_total,
       b.situacao_nome as bling_situacao,
       (b.total is not null and b.total <> p.valor_total) as divergencia_valor,
       c.nome as cliente_nome,
       v.nome as vendedora_nome,
       v.whatsapp as vendedora_whatsapp
  from app.pedidos p
  left join pg on pg.pedido_id = p.id
  left join app.bling_pedidos b on b.bling_id = p.bling_id
  left join app.clientes c on c.id = p.cliente_id
  left join app.vendedoras v on v.id = p.vendedora_id;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table app.vendedoras enable row level security;
alter table app.usuarios enable row level security;
alter table app.canais enable row level security;
alter table app.integracoes enable row level security;
alter table app.clientes enable row level security;
alter table app.cliente_nomes_planilha enable row level security;
alter table app.bling_pedidos enable row level security;
alter table app.pedidos enable row level security;
alter table app.planilha_vendas enable row level security;
alter table app.pagamentos enable row level security;
alter table app.comprovantes enable row level security;
alter table app.atendimentos enable row level security;
alter table app.tarefas enable row level security;
alter table app.sincronizacoes enable row level security;
alter table app.escritas_externas enable row level security;
alter table app.auditoria enable row level security;

-- Cadastros de apoio: todos leem, só o dono altera
create policy ler on app.vendedoras  for select using (app.uid() is not null);
create policy dono on app.vendedoras for all using (app.perfil_atual() = 'dono') with check (app.perfil_atual() = 'dono');
create policy ler on app.canais      for select using (app.uid() is not null);
create policy dono on app.canais     for all using (app.perfil_atual() = 'dono') with check (app.perfil_atual() = 'dono');
create policy ler on app.integracoes for select using (app.uid() is not null);
create policy dono on app.integracoes for all using (app.perfil_atual() = 'dono') with check (app.perfil_atual() = 'dono');

-- Usuários: cada um vê a si mesmo; gestão vê todos; só o dono cria e altera
create policy ler on app.usuarios for select using (id = app.uid() or app.pode_gerir());
create policy dono on app.usuarios for all using (app.perfil_atual() = 'dono') with check (app.perfil_atual() = 'dono');

-- Clientes: vendedora vê e edita só os seus
create policy ler on app.clientes for select using (app.ve_pedido(vendedora_id));
create policy incluir on app.clientes for insert with check (app.pode_gerir() or (app.perfil_atual()='vendedora' and vendedora_id = app.minha_vendedora()));
create policy alterar on app.clientes for update using (app.pode_gerir() or (app.perfil_atual()='vendedora' and vendedora_id = app.minha_vendedora()))
  with check (app.pode_gerir() or vendedora_id = app.minha_vendedora());

create policy ler on app.cliente_nomes_planilha for select using (app.ve_pedido(vendedora_id));
create policy gerir on app.cliente_nomes_planilha for all using (app.pode_gerir()) with check (app.pode_gerir());

-- Cópia do Bling: leitura conforme o pedido; escrita só pela função de sincronização
create policy ler on app.bling_pedidos for select using (
  app.e_gestao() or exists (select 1 from app.pedidos p where p.bling_id = bling_pedidos.bling_id and p.vendedora_id = app.minha_vendedora()));

-- Pedidos
create policy ler on app.pedidos for select using (app.ve_pedido(vendedora_id));
create policy incluir on app.pedidos for insert with check (
  app.pode_gerir() or (app.perfil_atual()='vendedora' and vendedora_id = app.minha_vendedora()));
create policy alterar on app.pedidos for update using (
  app.pode_gerir() or (app.perfil_atual()='vendedora' and vendedora_id = app.minha_vendedora()))
  with check (app.pode_gerir() or vendedora_id = app.minha_vendedora());

create policy ler on app.planilha_vendas for select using (app.ve_pedido(vendedora_id));
create policy gerir on app.planilha_vendas for all using (app.pode_gerir()) with check (app.pode_gerir());

-- Pagamentos: segue a visibilidade do pedido
create policy ler on app.pagamentos for select using (
  exists (select 1 from app.pedidos p where p.id = pedido_id));
create policy incluir on app.pagamentos for insert with check (
  app.pode_escrever() and exists (select 1 from app.pedidos p where p.id = pedido_id));
create policy alterar on app.pagamentos for update using (
  app.pode_escrever() and exists (select 1 from app.pedidos p where p.id = pedido_id)
  and (app.pode_gerir() or registrado_por = app.uid()));

create policy ler on app.comprovantes for select using (
  exists (select 1 from app.pagamentos g where g.id = pagamento_id));
create policy incluir on app.comprovantes for insert with check (
  app.pode_escrever() and enviado_por = app.uid() and exists (select 1 from app.pagamentos g where g.id = pagamento_id));

-- Atendimentos e tarefas
create policy ler on app.atendimentos for select using (
  exists (select 1 from app.clientes c where c.id = cliente_id));
create policy incluir on app.atendimentos for insert with check (
  app.pode_escrever() and usuario_id = app.uid() and exists (select 1 from app.clientes c where c.id = cliente_id));

create policy ler on app.tarefas for select using (
  responsavel = app.uid()
  or exists (select 1 from app.clientes c where c.id = cliente_id)
  or exists (select 1 from app.pedidos p where p.id = pedido_id));
create policy escrever on app.tarefas for all using (
  app.pode_escrever() and (responsavel = app.uid() or app.pode_gerir()
    or exists (select 1 from app.clientes c where c.id = cliente_id)
    or exists (select 1 from app.pedidos p where p.id = pedido_id)))
  with check (app.pode_escrever());

-- Integrações
create policy ler on app.sincronizacoes for select using (app.pode_gerir());
create policy sync on app.sincronizacoes for all to vc_sync using (true) with check (true);
create policy ler on app.escritas_externas for select using (app.pode_gerir());
create policy propor on app.escritas_externas for insert with check (
  app.pode_gerir() and status = 'proposta' and solicitado_por = app.uid());

-- Auditoria: só gestão lê; ninguém escreve diretamente
create policy ler on app.auditoria for select using (app.pode_gerir());

-- ---------------------------------------------------------------------
-- Permissões dos papéis do banco
-- ---------------------------------------------------------------------
revoke all on schema app from public;
grant usage on schema app to vc_app, vc_sync;

grant select on all tables in schema app to vc_app;
grant insert, update on app.clientes, app.cliente_nomes_planilha, app.pedidos, app.pagamentos,
  app.atendimentos, app.tarefas, app.vendedoras, app.usuarios, app.canais, app.integracoes,
  app.planilha_vendas to vc_app;
grant insert on app.comprovantes, app.escritas_externas to vc_app;
grant delete on app.tarefas to vc_app;
revoke insert, update, delete, truncate on app.auditoria, app.bling_pedidos from vc_app, vc_sync;

grant select on app.bling_pedidos, app.pedidos, app.vendedoras, app.canais, app.clientes to vc_sync;
grant select, insert, update on app.sincronizacoes, app.planilha_vendas to vc_sync;
grant usage on all sequences in schema app to vc_app, vc_sync;

revoke execute on all functions in schema app from public;
grant execute on function app.uid(), app.perfil_atual(), app.minha_vendedora(), app.e_gestao(),
  app.pode_gerir(), app.pode_escrever(), app.ve_pedido(uuid),
  app.conferir_pagamento(uuid, bigint), app.recusar_pagamento(uuid, text),
  app.reconhecer_mudanca_bling(uuid), app.decidir_escrita(uuid, boolean) to vc_app;
grant execute on function app.uid(), app.perfil_atual(), app.minha_vendedora(), app.e_gestao(),
  app.pode_gerir(), app.pode_escrever(), app.ve_pedido(uuid) to vc_sync;
grant execute on function app.bling_upsert_pedido(jsonb) to vc_sync;
-- funções de gatilho rodam pelo próprio banco
grant execute on function app.auditar(), app.auditoria_imutavel(), app.tocar_atualizado(),
  app.proteger_pedido(), app.proteger_pedido_insert(), app.proteger_pagamento() to vc_app, vc_sync;
