-- =====================================================================
-- Migração 0008: área de atacado do cliente, giro de estoque e promoções
--
-- * O cliente entra por um link enviado pela vendedora (sem senha).
--   Convites e sessões guardam só o hash do token.
-- * Catálogo com o preço da tabela do cliente (país + Normal/VIP), na moeda dele.
-- * Giro de estoque por produto: parado, normal, baixo, esgotado.
-- * Promoções: o sistema sugere (estoque parado), gerente ou dono aprova.
--   Nenhum desconto aparece para o cliente sem aprovação.
-- * Pedido do cliente entra como "aguardando aprovação" da vendedora.
-- Toda a área do cliente passa por funções: o cliente nunca acessa tabelas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Kits: vendidos como um produto, mas o estoque é dos componentes.
-- Ex.: Kit Platinum = 1 shampoo + 1 condicionador + 1 máscara.
-- O kit não tem estoque próprio: a disponibilidade é a do componente que acabar primeiro.
-- ---------------------------------------------------------------------
alter table app.produtos add column tipo text not null default 'simples' check (tipo in ('simples','kit'));
create table app.kit_componentes (
  kit_id         uuid not null references app.produtos(id),
  componente_id  uuid not null references app.produtos(id),
  quantidade     numeric(12,3) not null default 1 check (quantidade > 0),
  primary key (kit_id, componente_id),
  constraint kit_nao_contem_a_si check (kit_id <> componente_id)
);
create or replace function app.validar_componente() returns trigger language plpgsql as $$
begin
  if (select tipo from app.produtos where id = new.kit_id) <> 'kit' then
    raise exception 'Só produtos do tipo kit têm componentes.';
  end if;
  if (select tipo from app.produtos where id = new.componente_id) = 'kit' then
    raise exception 'Um kit não pode ser componente de outro kit.';
  end if;
  return new;
end $$;
create trigger validar before insert or update on app.kit_componentes for each row execute function app.validar_componente();

-- Explode um produto nos itens de estoque: kit vira componentes; produto simples fica como está
create or replace function app.componentes(p_produto uuid, p_qtd numeric)
returns table (produto_id uuid, quantidade numeric)
language sql stable security definer set search_path = app, pg_temp as $$
  select k.componente_id, k.quantidade * p_qtd from app.kit_componentes k where k.kit_id = p_produto
  union all
  select p_produto, p_qtd where not exists (select 1 from app.kit_componentes where kit_id = p_produto)
$$;

-- Quantidade disponível de um produto (ou kit) num depósito
create or replace function app.saldo_disponivel(p_deposito uuid, p_produto uuid) returns numeric
language sql stable security definer set search_path = app, pg_temp as $$
  select case
    when exists (select 1 from app.kit_componentes where kit_id = p_produto) then
      coalesce((select min(floor(coalesce(s.quantidade, 0) / k.quantidade))
                  from app.kit_componentes k
                  left join app.estoque_saldos s on s.produto_id = k.componente_id and s.deposito_id = p_deposito
                 where k.kit_id = p_produto), 0)
    else coalesce((select quantidade from app.estoque_saldos where deposito_id = p_deposito and produto_id = p_produto), 0)
  end
$$;

-- Kit não recebe lançamento de estoque: compra, transferência e ajuste são dos componentes
create or replace function app.estoque_sem_kit() returns trigger language plpgsql as $$
begin
  if (select tipo from app.produtos where id = new.produto_id) = 'kit' then
    raise exception 'Kit não tem estoque próprio: lance os componentes.';
  end if;
  return new;
end $$;
create trigger sem_kit before insert on app.estoque_movimentos for each row execute function app.estoque_sem_kit();
create or replace function app.transferencia_sem_kit() returns trigger language plpgsql as $$
begin
  if (select tipo from app.produtos where id = new.produto_id) = 'kit' then
    raise exception 'Kit não é transferido: transfira os componentes.';
  end if;
  return new;
end $$;
create trigger sem_kit before insert on app.transferencia_itens for each row execute function app.transferencia_sem_kit();

-- Saída de estoque do pedido (redefinida): kits saem pelos componentes
create or replace function app.estoque_do_pedido() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare it record;
begin
  if new.deposito_id is null or new.origem = 'bling' then return new; end if;
  if new.status_comercial = 'enviado' and old.status_comercial in ('em_separacao','aguardando_aprovacao') then
    for it in select c.produto_id, sum(c.quantidade) q
                from app.pedido_itens i cross join lateral app.componentes(i.produto_id, i.quantidade) c
               where i.pedido_id = new.id and i.produto_id is not null group by 1 loop
      perform app._lancar(new.deposito_id, it.produto_id, 'saida_venda', it.q, 'pedido', new.id::text, null);
    end loop;
  elsif new.status_comercial = 'cancelado' and old.status_comercial in ('enviado','entregue') then
    for it in select c.produto_id, sum(c.quantidade) q
                from app.pedido_itens i cross join lateral app.componentes(i.produto_id, i.quantidade) c
               where i.pedido_id = new.id and i.produto_id is not null group by 1 loop
      perform app._lancar(new.deposito_id, it.produto_id, 'devolucao_cliente', it.q, 'pedido', new.id::text, 'Pedido cancelado após envio');
    end loop;
  end if;
  return new;
end $$;

create trigger auditar after insert or update or delete on app.kit_componentes for each row execute function app.auditar('kit_id');
alter table app.kit_componentes enable row level security;
create policy ler on app.kit_componentes for select using (app.uid() is not null);
create policy gerir on app.kit_componentes for all using (app.pode_gerir()) with check (app.pode_gerir());
grant select, insert, update, delete on app.kit_componentes to vc_app;
grant update (tipo) on app.produtos to vc_app;

-- ---------------------------------------------------------------------
-- Abastecimento entre depósitos, depósito do cliente e separação
-- ---------------------------------------------------------------------
-- A loja de CDE tem estoque próprio e é abastecida pelo CD de Foz.
alter table app.depositos add column abastecido_por uuid references app.depositos(id);
alter table app.depositos add column prazo_abastecimento text;
update app.depositos set abastecido_por = (select id from app.depositos where codigo = 'cd-foz'),
       prazo_abastecimento = '1 a 3 dias'
 where codigo = 'loja-cde';

-- Depósito de cada cliente (se vazio: o depósito padrão da vendedora dele)
alter table app.clientes add column deposito_id uuid references app.depositos(id);

-- Itens: quantidade pedida x separada, e de qual depósito vem a mercadoria
alter table app.pedido_itens add column quantidade_pedida numeric(12,3);
alter table app.pedido_itens add column deposito_origem_id uuid references app.depositos(id);
create or replace function app.item_quantidade_pedida() returns trigger language plpgsql as $$
begin new.quantidade_pedida := coalesce(new.quantidade_pedida, new.quantidade); return new; end $$;
create trigger quantidade_pedida before insert on app.pedido_itens for each row execute function app.item_quantidade_pedida();

-- Pagamento manual: expedição confere, vendedora confirma total e conta, cliente paga
alter table app.pedidos add column separacao_conferida_em timestamptz;
alter table app.pedidos add column separacao_conferida_por uuid references app.usuarios(id);
alter table app.pedidos add column total_confirmado_em timestamptz;
alter table app.pedidos add column total_confirmado_por uuid references app.usuarios(id);
alter table app.pedidos add column conta_pagamento text;
alter table app.transferencias add column pedido_id uuid references app.pedidos(id);

-- Depois do total confirmado, os itens não mudam mais
create or replace function app.travar_itens() returns trigger language plpgsql as $$
begin
  if current_user in ('vc_app','vc_sync') and exists (
       select 1 from app.pedidos where id = coalesce(new.pedido_id, old.pedido_id) and total_confirmado_em is not null) then
    raise exception 'O total deste pedido já foi confirmado ao cliente: os itens não mudam mais.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end $$;
create trigger travar before insert or update or delete on app.pedido_itens for each row execute function app.travar_itens();

-- ---------------------------------------------------------------------
-- Parâmetros ajustáveis
-- ---------------------------------------------------------------------
create table app.parametros (
  chave     text primary key,
  valor     numeric not null,
  descricao text not null
);
insert into app.parametros values
  ('giro_janela_dias',        90,  'Dias de vendas usados para medir o giro'),
  ('giro_parado_cobertura',   120, 'Estoque para mais de N dias de venda = parado'),
  ('giro_baixo_cobertura',    15,  'Estoque para menos de N dias de venda = baixo'),
  ('giro_ultimas_unidades',   12,  'Abaixo de N unidades o cliente vê "últimas unidades"'),
  ('promo_desconto_maximo',   40,  'Desconto máximo de uma promoção (%)'),
  ('promo_sugerida_desconto', 10,  'Desconto sugerido para produto parado (%)'),
  ('arredondamento_gs',       500, 'Preços em Gs arredondados para múltiplos de N'),
  ('convite_validade_dias',   7,   'Validade do link de acesso enviado ao cliente'),
  ('sessao_cliente_dias',     90,  'Quanto tempo o cliente fica conectado');
create or replace function app.param(p text) returns numeric
language sql stable security definer set search_path = app, pg_temp as $$ select valor from app.parametros where chave = p $$;

-- ---------------------------------------------------------------------
-- Giro de estoque
-- Vendas = itens de pedidos enviados ou entregues (pedidos do Bling entram
-- quando a leitura do Bling trouxer os itens).
-- ---------------------------------------------------------------------
create or replace view app.v_giro with (security_invoker = true) as
with vendas as (
  select p.deposito_id, c.produto_id,
         sum(c.quantidade) filter (where p.data_pedido > current_date - app.param('giro_janela_dias')::int) as vendido_janela,
         sum(c.quantidade) filter (where p.data_pedido > current_date - 30) as vendido_30,
         max(p.data_pedido) as ultima_venda
    from app.pedido_itens i join app.pedidos p on p.id = i.pedido_id
    cross join lateral app.componentes(i.produto_id, i.quantidade) c
   where p.status_comercial in ('enviado','entregue') and p.deposito_id is not null and i.produto_id is not null
   group by 1, 2
), base as (
  select s.deposito_id, s.produto_id, s.quantidade as saldo,
         coalesce(v.vendido_janela, 0) as vendido_janela, coalesce(v.vendido_30, 0) as vendido_30, v.ultima_venda,
         coalesce(v.vendido_janela, 0) / app.param('giro_janela_dias') as media_dia
    from app.estoque_saldos s
    left join vendas v on v.deposito_id = s.deposito_id and v.produto_id = s.produto_id
)
select b.*, d.nome as deposito, p.codigo, p.nome as produto, p.fornecedor,
       case when b.media_dia > 0 then round(b.saldo / b.media_dia) end as cobertura_dias,
       case
         when b.saldo <= 0 then 'esgotado'
         when b.media_dia = 0 then 'parado'
         when b.saldo / b.media_dia > app.param('giro_parado_cobertura') then 'parado'
         when b.saldo / b.media_dia < app.param('giro_baixo_cobertura') then 'baixo'
         else 'normal'
       end as situacao
  from base b
  join app.depositos d on d.id = b.deposito_id
  join app.produtos p on p.id = b.produto_id
 where p.ativo and d.ativo;

-- ---------------------------------------------------------------------
-- Promoções
-- ---------------------------------------------------------------------
create table app.promocoes (
  id            uuid primary key default gen_random_uuid(),
  produto_id    uuid not null references app.produtos(id),
  pais          app.pais not null,
  desconto_pct  numeric(5,2) not null check (desconto_pct > 0 and desconto_pct <= 90),
  inicio        date not null,
  fim           date not null,
  limite_qtd    numeric(12,3) check (limite_qtd > 0),      -- máximo por pedido (opcional)
  motivo        text,
  origem        text not null default 'manual' check (origem in ('manual','sugestao_giro')),
  status        text not null default 'proposta' check (status in ('proposta','aprovada','recusada','encerrada')),
  criada_por    uuid references app.usuarios(id),
  criada_em     timestamptz not null default now(),
  decidida_por  uuid references app.usuarios(id),
  decidida_em   timestamptz,
  motivo_recusa text,
  constraint periodo check (fim >= inicio)
);
create index on app.promocoes (produto_id, pais, status);

create or replace function app.validar_promocao() returns trigger language plpgsql as $$
begin
  if new.desconto_pct > app.param('promo_desconto_maximo') then
    raise exception 'Desconto acima do máximo permitido (% por cento).', app.param('promo_desconto_maximo');
  end if;
  if current_user in ('vc_app','vc_sync') then
    if tg_op = 'INSERT' then
      if new.status <> 'proposta' then
        raise exception 'Promoção nova entra como proposta, aguardando aprovação.' using errcode = 'insufficient_privilege';
      end if;
      new.criada_por := app.uid();
    elsif old.status <> 'proposta' and new.status is distinct from 'encerrada' then
      raise exception 'Promoção já decidida só pode ser encerrada.' using errcode = 'insufficient_privilege';
    elsif new.status is distinct from old.status and new.status not in ('encerrada') then
      raise exception 'Aprovação de promoção é feita pelo gerente.' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;
create trigger validar before insert or update on app.promocoes for each row execute function app.validar_promocao();

create or replace function app.decidir_promocao(p_id uuid, p_aprovar boolean, p_motivo text default null)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono aprova promoções.' using errcode = 'insufficient_privilege';
  end if;
  if not p_aprovar and coalesce(trim(p_motivo),'') = '' then raise exception 'Informe o motivo da recusa.'; end if;
  update app.promocoes set status = case when p_aprovar then 'aprovada' else 'recusada' end,
         decidida_por = app.uid(), decidida_em = now(), motivo_recusa = case when p_aprovar then null else p_motivo end
   where id = p_id and status = 'proposta';
  if not found then raise exception 'Promoção não encontrada ou já decidida.'; end if;
end $$;

-- Sugestões: produtos parados sem promoção ativa ou proposta
create or replace view app.v_sugestoes_promocao with (security_invoker = true) as
select g.produto_id, g.codigo, g.produto, g.deposito, g.saldo, g.vendido_janela, g.cobertura_dias, g.ultima_venda,
       app.param('promo_sugerida_desconto') as desconto_sugerido,
       case when g.media_dia = 0 then 'Sem vendas nos últimos ' || app.param('giro_janela_dias')::int || ' dias'
            else 'Estoque para ' || g.cobertura_dias || ' dias de venda' end as motivo
  from app.v_giro g
 where g.situacao = 'parado'
   and not exists (select 1 from app.promocoes p where p.produto_id = g.produto_id
                     and p.status in ('proposta','aprovada') and p.fim >= current_date);

-- Preço final para um cliente, com promoção aprovada e vigente
create or replace function app.arredondar_preco(v numeric, m app.moeda) returns numeric
language sql stable as $$
  select case when m = 'GS' then greatest(round(v / app.param('arredondamento_gs')) * app.param('arredondamento_gs'), app.param('arredondamento_gs'))
              else round(v, 2) end
$$;

create or replace function app.preco_final(p_cliente uuid, p_produto uuid, p_data date default current_date)
returns table (preco numeric, preco_tabela numeric, moeda app.moeda, tabela text, promocao_id uuid, desconto_pct numeric, limite_qtd numeric)
language sql stable security definer set search_path = app, pg_temp as $$
  with base as (select * from app.preco_para_cliente(p_cliente, p_produto, p_data)),
       promo as (
         select pr.id, pr.desconto_pct, pr.limite_qtd from app.promocoes pr
          where pr.produto_id = p_produto and pr.status = 'aprovada' and p_data between pr.inicio and pr.fim
            and pr.pais = (select pais from app.clientes where id = p_cliente)
          order by pr.desconto_pct desc limit 1)
  select case when promo.id is null then b.valor else app.arredondar_preco(b.valor * (1 - promo.desconto_pct / 100), b.moeda) end,
         b.valor, b.moeda, b.tabela, promo.id, promo.desconto_pct, promo.limite_qtd
    from base b left join promo on true
$$;

-- ---------------------------------------------------------------------
-- Acesso do cliente: convite por link e sessão
-- ---------------------------------------------------------------------
create table app.portal_convites (
  token_hash  text primary key,
  cliente_id  uuid not null references app.clientes(id),
  criado_por  uuid references app.usuarios(id),
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  usado_em    timestamptz
);
create table app.portal_sessoes (
  token_hash  text primary key,
  cliente_id  uuid not null references app.clientes(id),
  criada_em   timestamptz not null default now(),
  expira_em   timestamptz not null
);
alter table app.clientes add column portal_ativo boolean not null default true;
alter table app.pagamentos add column enviado_pelo_cliente boolean not null default false;

create or replace function app.gerar_convite_portal(p_cliente uuid, p_token_hash text)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare v_vend uuid;
begin
  select vendedora_id into v_vend from app.clientes where id = p_cliente;
  if v_vend is null or not app.pode_escrever() or not app.ve_pedido(v_vend) then
    raise exception 'Sem permissão para dar acesso a este cliente.' using errcode = 'insufficient_privilege';
  end if;
  update app.clientes set portal_ativo = true where id = p_cliente;
  insert into app.portal_convites (token_hash, cliente_id, criado_por, expira_em)
  values (p_token_hash, p_cliente, app.uid(), now() + make_interval(days => app.param('convite_validade_dias')::int));
end $$;

-- Troca o convite (uso único) por uma sessão
create or replace function app.portal_entrar(p_convite_hash text, p_sessao_hash text)
returns boolean language plpgsql security definer set search_path = app, pg_temp as $$
declare v_cli uuid;
begin
  update app.portal_convites set usado_em = now()
   where token_hash = p_convite_hash and usado_em is null and expira_em > now()
   returning cliente_id into v_cli;
  if v_cli is null or not (select portal_ativo from app.clientes where id = v_cli) then return false; end if;
  delete from app.portal_sessoes where expira_em < now();
  insert into app.portal_sessoes (token_hash, cliente_id, expira_em)
  values (p_sessao_hash, v_cli, now() + make_interval(days => app.param('sessao_cliente_dias')::int));
  return true;
end $$;

create or replace function app.portal_cliente_id(p_sessao_hash text) returns uuid
language sql stable security definer set search_path = app, pg_temp as $$
  select s.cliente_id from app.portal_sessoes s join app.clientes c on c.id = s.cliente_id
   where s.token_hash = p_sessao_hash and s.expira_em > now() and c.portal_ativo and c.mesclado_em is null
$$;

create or replace function app.portal_sair(p_sessao_hash text) returns void
language sql security definer set search_path = app, pg_temp as $$ delete from app.portal_sessoes where token_hash = p_sessao_hash $$;

-- Encerrar o acesso de um cliente (derruba sessões e convites)
create or replace function app.bloquear_portal(p_cliente uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.pode_escrever() or not app.ve_pedido((select vendedora_id from app.clientes where id = p_cliente)) then
    raise exception 'Sem permissão.' using errcode = 'insufficient_privilege';
  end if;
  update app.clientes set portal_ativo = false where id = p_cliente;
  delete from app.portal_sessoes where cliente_id = p_cliente;
  delete from app.portal_convites where cliente_id = p_cliente and usado_em is null;
end $$;

-- Dados que o cliente pode ver sobre si
create or replace function app.portal_perfil(p_sessao_hash text)
returns table (cliente_id uuid, nome text, moeda app.moeda, categoria app.categoria_preco, pais app.pais,
               vendedora text, vendedora_whatsapp text)
language sql stable security definer set search_path = app, pg_temp as $$
  select c.id, c.nome, c.moeda, c.categoria_preco, c.pais, v.nome, v.whatsapp
    from app.clientes c join app.vendedoras v on v.id = c.vendedora_id
   where c.id = app.portal_cliente_id(p_sessao_hash)
$$;

-- Depósito de onde sai o pedido do cliente: o padrão da vendedora dele
create or replace function app.deposito_do_cliente(p_cliente uuid) returns uuid
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce(c.deposito_id,
                  (select vd.deposito_id from app.vendedora_depositos vd where vd.vendedora_id = c.vendedora_id
                    order by vd.padrao desc limit 1))
    from app.clientes c where c.id = p_cliente
$$;

-- Catálogo do cliente, já ordenado pela "vitrine inteligente".
-- Disponibilidade: no depósito do cliente (imediato) e no depósito que o abastece (com prazo).
create or replace function app.portal_catalogo(p_sessao_hash text)
returns table (produto_id uuid, codigo text, nome text, fornecedor text, moeda app.moeda,
               preco numeric, preco_tabela numeric, desconto_pct numeric, limite_qtd numeric,
               disponibilidade text, disponivel_abastecedor boolean, prazo_abastecimento text,
               ja_comprou boolean, ultima_compra date, destaque text, ordem int)
language sql stable security definer set search_path = app, pg_temp as $$
  with cli as (select app.portal_cliente_id(p_sessao_hash) as id),
       dep as (select d.id, d.abastecido_por, d.prazo_abastecimento from app.depositos d
                where d.id = app.deposito_do_cliente((select id from cli))),
       hist as (
         select i.produto_id, max(p.data_pedido) as ultima
           from app.pedido_itens i join app.pedidos p on p.id = i.pedido_id
          where p.cliente_id = (select id from cli) and p.status_comercial <> 'cancelado'
          group by 1),
       base as (
         select pr.id as produto_id, pr.codigo, pr.nome, pr.fornecedor, f.moeda, f.preco, f.preco_tabela, f.desconto_pct, f.limite_qtd,
                app.saldo_disponivel((select id from dep), pr.id) as saldo,
                case when (select abastecido_por from dep) is null then 0
                     else app.saldo_disponivel((select abastecido_por from dep), pr.id) end as saldo_abast,
                g.situacao, h.ultima
           from app.produtos pr
           cross join lateral app.preco_final((select id from cli), pr.id) f
           left join app.v_giro g on g.produto_id = pr.id and g.deposito_id = (select id from dep)
           left join hist h on h.produto_id = pr.id
          where pr.ativo and (select id from cli) is not null and f.preco is not null)
  select produto_id, codigo, nome, fornecedor, moeda, preco, preco_tabela, desconto_pct, limite_qtd,
         case when saldo <= 0 then 'indisponivel'
              when saldo < app.param('giro_ultimas_unidades') then 'ultimas'
              else 'disponivel' end,
         saldo_abast > 0,
         (select prazo_abastecimento from dep),
         ultima is not null, ultima,
         case when desconto_pct is not null and saldo + saldo_abast > 0 then 'promocao'
              when ultima is not null and saldo + saldo_abast > 0 then 'recompra'
              when situacao = 'parado' and saldo > 0 then 'sugestao'
              else null end,
         case when saldo + saldo_abast <= 0 then 9
              when desconto_pct is not null then 1
              when ultima is not null then 2
              when situacao = 'parado' then 3
              when saldo <= 0 then 6
              else 5 end
    from base
   order by 16, nome
$$;

-- Pedido feito pelo cliente: entra para a vendedora aprovar. Não há pagamento neste momento.
-- Cada produto sai primeiro do depósito do cliente; o que faltar vem do depósito que o abastece.
create or replace function app.portal_criar_pedido(p_sessao_hash text, p_itens jsonb, p_obs text default null)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_cli app.clientes; v_dep app.depositos; v_ped uuid; it jsonb; v_qtd numeric; f record;
  v_local numeric; v_abast numeric; q_local numeric; q_abast numeric; v_prod app.produtos; v_total numeric := 0; n int := 0;
begin
  select * into v_cli from app.clientes where id = app.portal_cliente_id(p_sessao_hash);
  if v_cli.id is null then raise exception 'Sessão expirada. Peça um novo link para a sua vendedora.'; end if;
  select * into v_dep from app.depositos where id = app.deposito_do_cliente(v_cli.id);
  insert into app.pedidos (origem, canal, cliente_id, vendedora_id, data_pedido, moeda, valor_total, status_comercial, deposito_id, observacoes)
  values ('portal', 'portal', v_cli.id, v_cli.vendedora_id, current_date, v_cli.moeda, 0, 'aguardando_aprovacao', v_dep.id,
          nullif(trim(coalesce(p_obs,'')), ''))
  returning id into v_ped;
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    v_qtd := (it->>'quantidade')::numeric;
    continue when v_qtd is null or v_qtd <= 0;
    select * into v_prod from app.produtos where id = (it->>'produto_id')::uuid and ativo;
    if v_prod.id is null then raise exception 'Produto não encontrado.'; end if;
    select * into f from app.preco_final(v_cli.id, v_prod.id);
    if f.preco is null then raise exception 'Produto sem preço na sua tabela.'; end if;
    if f.limite_qtd is not null and v_qtd > f.limite_qtd then
      raise exception 'Promoção de % limitada a % unidades por pedido.', v_prod.nome, f.limite_qtd;
    end if;
    v_local := app.saldo_disponivel(v_dep.id, v_prod.id);
    v_abast := case when v_dep.abastecido_por is null then 0 else app.saldo_disponivel(v_dep.abastecido_por, v_prod.id) end;
    if v_local + v_abast < v_qtd then
      raise exception 'Quantidade maior que a disponível de % (disponível: %).', v_prod.nome, v_local + v_abast;
    end if;
    q_local := least(v_qtd, v_local);
    q_abast := v_qtd - q_local;
    if q_local > 0 then
      insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
      values (v_ped, v_prod.id, v_prod.codigo,
              v_prod.nome || case when f.promocao_id is not null then ' (promoção -' || f.desconto_pct::int || '%)' else '' end,
              q_local, f.preco, f.tabela, v_dep.id);
    end if;
    if q_abast > 0 then
      insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
      values (v_ped, v_prod.id, v_prod.codigo,
              v_prod.nome || case when f.promocao_id is not null then ' (promoção -' || f.desconto_pct::int || '%)' else '' end
                          || ' · vem de ' || (select nome from app.depositos where id = v_dep.abastecido_por)
                          || coalesce(' (' || v_dep.prazo_abastecimento || ')', ''),
              q_abast, f.preco, f.tabela, v_dep.abastecido_por);
    end if;
    v_total := v_total + v_qtd * f.preco; n := n + 1;
  end loop;
  if n = 0 then raise exception 'Escolha pelo menos um produto.'; end if;
  update app.pedidos set valor_total = round(v_total, 2) where id = v_ped;
  return v_ped;
end $$;

-- Vendedora (ou gestão) aprova ou recusa o pedido do cliente.
-- Se parte vem do depósito abastecedor, já deixa a transferência preparada (rascunho).
create or replace function app.decidir_pedido_portal(p_pedido uuid, p_aprovar boolean, p_motivo text default null)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; v_transf uuid; it record;
begin
  select * into v_ped from app.pedidos where id = p_pedido and status_comercial = 'aguardando_aprovacao' for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado ou já decidido.'; end if;
  if not app.pode_escrever() or not app.ve_pedido(v_ped.vendedora_id) then
    raise exception 'Sem permissão.' using errcode = 'insufficient_privilege';
  end if;
  if not p_aprovar and coalesce(trim(p_motivo),'') = '' then raise exception 'Informe o motivo para o cliente.'; end if;
  perform set_config('app.motivo', coalesce(p_motivo, 'Pedido da área do cliente aprovado'), true);
  if p_aprovar then
    for it in select i.deposito_origem_id, c.produto_id, sum(c.quantidade) q
                from app.pedido_itens i cross join lateral app.componentes(i.produto_id, i.quantidade) c
               where i.pedido_id = p_pedido and i.deposito_origem_id is distinct from v_ped.deposito_id and i.deposito_origem_id is not null
               group by 1, 2 loop
      if v_transf is null then
        insert into app.transferencias (origem_id, destino_id, observacao, criada_por, pedido_id)
        values (it.deposito_origem_id, v_ped.deposito_id,
                'Para o pedido de ' || (select nome from app.clientes where id = v_ped.cliente_id), app.uid(), p_pedido)
        returning id into v_transf;
      end if;
      insert into app.transferencia_itens (transferencia_id, produto_id, quantidade_enviada) values (v_transf, it.produto_id, it.q);
    end loop;
  end if;
  update app.pedidos
     set status_comercial = case when p_aprovar then 'em_separacao'::app.status_comercial else 'cancelado'::app.status_comercial end,
         observacoes = case when p_aprovar then observacoes else concat_ws(' | ', observacoes, 'Recusado: ' || p_motivo) end
   where id = p_pedido;
  return v_transf;
end $$;

-- Expedição confere o que foi separado (pode ser menos que o pedido) e o total é recalculado.
-- p_itens: [{"item_id": "...", "quantidade": 10}]; item omitido = separado completo; 0 = sem estoque.
create or replace function app.conferir_separacao(p_pedido uuid, p_itens jsonb default '[]')
returns numeric language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; it record; v_q numeric; v_total numeric;
begin
  select * into v_ped from app.pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if not (app.pode_gerir() or app.pode_operar_deposito(v_ped.deposito_id)) then
    raise exception 'Só a expedição do depósito ou a gerência confere a separação.' using errcode = 'insufficient_privilege';
  end if;
  if v_ped.status_comercial <> 'em_separacao' then raise exception 'O pedido precisa estar em separação.'; end if;
  if v_ped.total_confirmado_em is not null then raise exception 'O total já foi confirmado ao cliente.'; end if;
  if v_ped.origem = 'bling' then raise exception 'Pedidos do Bling são conferidos no Bling.'; end if;
  for it in select * from app.pedido_itens where pedido_id = p_pedido loop
    select (r->>'quantidade')::numeric into v_q from jsonb_array_elements(coalesce(p_itens, '[]')) r where (r->>'item_id')::uuid = it.id;
    v_q := coalesce(v_q, it.quantidade_pedida);
    if v_q < 0 or v_q > it.quantidade_pedida then
      raise exception 'Quantidade separada de % deve ficar entre 0 e %.', it.descricao, it.quantidade_pedida;
    end if;
    if v_q = 0 then delete from app.pedido_itens where id = it.id;
    elsif v_q <> it.quantidade then update app.pedido_itens set quantidade = v_q where id = it.id;
    end if;
  end loop;
  select coalesce(sum(total), 0) into v_total from app.pedido_itens where pedido_id = p_pedido;
  update app.pedidos set valor_total = v_total, separacao_conferida_em = now(), separacao_conferida_por = app.uid()
   where id = p_pedido;
  return v_total;
end $$;

-- Vendedora confirma o total e informa a conta: a partir daqui o cliente vê quanto e onde pagar.
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
end $$;

-- Pedidos do cliente, com a etapa em linguagem simples
create or replace function app.portal_pedidos(p_sessao_hash text)
returns table (id uuid, data_pedido date, bling_numero bigint, valor_total numeric, recebido numeric, a_conferir numeric,
               saldo numeric, moeda app.moeda, status_comercial app.status_comercial, status_pagamento text,
               etapa text, total_confirmado boolean, conta_pagamento text,
               previsao_envio date, vencimento date, observacoes text, itens jsonb)
language sql stable security definer set search_path = app, pg_temp as $$
  select v.id, v.data_pedido, v.bling_numero, v.valor_total, v.recebido, v.a_conferir, v.saldo, v.moeda, v.status_comercial,
         v.status_pagamento,
         case
           when v.status_comercial = 'cancelado' then 'cancelado'
           when v.status_comercial = 'aguardando_aprovacao' then 'aguardando_vendedora'
           when v.status_comercial in ('enviado','entregue') then v.status_comercial::text
           when p.total_confirmado_em is null then 'em_separacao'
           when v.saldo > 0 then 'aguardando_pagamento'
           else 'pago_preparando_envio'
         end,
         p.total_confirmado_em is not null,
         case when p.total_confirmado_em is not null then p.conta_pagamento end,
         v.previsao_envio, v.vencimento, v.observacoes,
         coalesce((select jsonb_agg(jsonb_build_object('descricao', i.descricao, 'quantidade', i.quantidade,
                                                       'pedida', i.quantidade_pedida, 'preco', i.preco_unitario, 'total', i.total)
                                    order by i.descricao)
                     from app.pedido_itens i where i.pedido_id = v.id), '[]')
    from app.v_pedidos v join app.pedidos p on p.id = v.id
   where v.cliente_id = app.portal_cliente_id(p_sessao_hash)
   order by v.data_pedido desc, v.criado_em desc
   limit 100
$$;

-- Cliente envia o comprovante: entra como pagamento a conferir
create or replace function app.portal_enviar_pagamento(p_sessao_hash text, p_pedido uuid, p_valor numeric, p_data date,
  p_modalidade app.modalidade_pagamento, p_arquivo text, p_nome text, p_mime text, p_tamanho bigint, p_sha text)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare v_pag uuid;
begin
  if not exists (select 1 from app.pedidos where id = p_pedido and cliente_id = app.portal_cliente_id(p_sessao_hash)
                   and status_comercial <> 'cancelado') then
    raise exception 'Pedido não encontrado.';
  end if;
  if (select total_confirmado_em from app.pedidos where id = p_pedido) is null then
    raise exception 'Aguarde a sua vendedora confirmar o total e a conta para pagamento.';
  end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor pago.'; end if;
  if p_arquivo is null then raise exception 'Anexe o comprovante.'; end if;
  insert into app.pagamentos (pedido_id, valor, data, modalidade, observacao, enviado_pelo_cliente)
  values (p_pedido, p_valor, coalesce(p_data, current_date), p_modalidade, 'Enviado pelo cliente na área de atacado', true)
  returning id into v_pag;
  insert into app.comprovantes (pagamento_id, arquivo, nome_original, mime, tamanho, sha256)
  values (v_pag, p_arquivo, p_nome, p_mime, p_tamanho, p_sha);
end $$;

-- Comprovante do próprio cliente (para ele abrir o arquivo que enviou)
create or replace function app.portal_comprovante(p_sessao_hash text, p_comprovante uuid)
returns table (arquivo text, mime text, nome_original text)
language sql stable security definer set search_path = app, pg_temp as $$
  select c.arquivo, c.mime, c.nome_original from app.comprovantes c
    join app.pagamentos g on g.id = c.pagamento_id join app.pedidos p on p.id = g.pedido_id
   where c.id = p_comprovante and p.cliente_id = app.portal_cliente_id(p_sessao_hash)
$$;

-- Meta do cliente
create or replace function app.portal_meta(p_sessao_hash text)
returns table (inicio date, fim date, moeda app.moeda, valor_meta numeric, valor_premio numeric, descricao_premio text,
               vendido numeric, falta numeric, percentual numeric, dias_restantes int, meta_batida boolean)
language sql stable security definer set search_path = app, pg_temp as $$
  select m.inicio, m.fim, m.moeda, m.valor_meta, m.valor_premio, m.descricao_premio, m.vendido, m.falta, m.percentual,
         m.dias_restantes, m.meta_batida
    from app.v_metas m
   where m.cliente_id = app.portal_cliente_id(p_sessao_hash) and m.status = 'aprovada'
   order by m.fim limit 1
$$;

-- ---------------------------------------------------------------------
-- Auditoria e permissões
-- ---------------------------------------------------------------------
create trigger auditar after insert or update or delete on app.promocoes  for each row execute function app.auditar('id');
create trigger auditar after insert or update or delete on app.parametros for each row execute function app.auditar('chave');

alter table app.parametros enable row level security;
alter table app.promocoes enable row level security;
alter table app.portal_convites enable row level security;
alter table app.portal_sessoes enable row level security;
create policy ler on app.parametros for select using (app.uid() is not null);
create policy dono on app.parametros for update using (app.perfil_atual() = 'dono') with check (app.perfil_atual() = 'dono');
create policy ler on app.promocoes for select using (app.uid() is not null);
create policy propor on app.promocoes for insert with check (app.pode_gerir());
create policy alterar on app.promocoes for update using (app.pode_gerir());

grant select on app.parametros, app.promocoes, app.v_giro, app.v_sugestoes_promocao to vc_app;
grant update (valor) on app.parametros to vc_app;
grant insert, update on app.promocoes to vc_app;
grant execute on function app.componentes(uuid, numeric), app.saldo_disponivel(uuid, uuid), app.param(text), app.arredondar_preco(numeric, app.moeda), app.preco_final(uuid, uuid, date),
  app.decidir_promocao(uuid, boolean, text), app.gerar_convite_portal(uuid, text), app.portal_entrar(text, text),
  app.portal_cliente_id(text), app.portal_sair(text), app.bloquear_portal(uuid), app.portal_perfil(text),
  app.deposito_do_cliente(uuid), app.portal_catalogo(text), app.portal_criar_pedido(text, jsonb, text),
  app.decidir_pedido_portal(uuid, boolean, text), app.conferir_separacao(uuid, jsonb), app.confirmar_total(uuid, text),
  app.portal_pedidos(text),
  app.portal_enviar_pagamento(text, uuid, numeric, date, app.modalidade_pagamento, text, text, text, bigint, text),
  app.portal_comprovante(text, uuid), app.portal_meta(text) to vc_app;
grant execute on function app.validar_componente(), app.estoque_sem_kit(), app.transferencia_sem_kit(), app.validar_promocao(), app.item_quantidade_pedida(), app.travar_itens() to vc_app, vc_sync;
grant update (deposito_id) on app.clientes to vc_app;
