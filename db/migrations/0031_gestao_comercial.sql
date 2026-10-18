-- =====================================================================
-- Migração 0031: gestão comercial e administrativa
--
--   1. Parâmetros que o gerente configura (câmbio do lucro, venda só com estoque,
--      custo do passeiro por volume, validade do link de pedido).
--   2. Custo congelado em cada item vendido (base do lucro e da comissão).
--   3. A vendedora escolhe a moeda do pedido (Gs ou R$); a tabela usada é a da
--      moeda escolhida com a categoria do cliente (Normal/VIP).
--   4. Pedido da vendedora conferindo o estoque disponível.
--   5. Pedido montado no WhatsApp e enviado por link para o cliente confirmar as caixas.
--   6. Volumes (caixas de envio) por pedido e resumo semanal de envios ao Paraguai.
--   7. Lucro por item, comissão por vendedora (percentual e base definidos pelo gerente)
--      e resultado do mês.
--   8. Despesas e contas a pagar (compras de marcas, aluguel, administrativo,
--      transportadoras, passeiro...).
-- =====================================================================

-- ---------------------------------------------------------------------
-- O que conta como venda nos relatórios de lucro e comissão:
-- não entra pedido cancelado nem pedido ainda não confirmado (pelo cliente ou pela vendedora).
-- ---------------------------------------------------------------------
create or replace function app.conta_como_venda(s app.status_comercial) returns boolean
language sql immutable as $$
  select s::text not in ('cancelado', 'aguardando_cliente', 'aguardando_aprovacao')
$$;

-- ---------------------------------------------------------------------
-- 1. Parâmetros configuráveis pelo gerente
-- ---------------------------------------------------------------------
insert into app.parametros (chave, valor, descricao) values
  ('cambio_custo_gs',           1300, 'Câmbio (Gs por R$) usado para converter o custo dos produtos no lucro das vendas em Gs'),
  ('pedido_exige_estoque',      1,    'Pedido da vendedora só com estoque disponível no depósito (1 = sim, 0 = não)'),
  ('passeiro_custo_volume',     0,    'Custo estimado do passeiro por volume (caixa) enviado ao Paraguai, em Gs'),
  ('link_pedido_validade_dias', 7,    'Validade do link de pedido enviado ao cliente pelo WhatsApp (dias)')
on conflict (chave) do nothing;

-- Até aqui só o dono alterava parâmetros; agora o gerente também configura.
create policy gerente on app.parametros for update using (app.pode_gerir()) with check (app.pode_gerir());

-- ---------------------------------------------------------------------
-- 2. Custo congelado no item vendido (em R$, como no cadastro do produto)
-- Para pedidos em Gs também fica congelado o câmbio usado na conversão.
-- ---------------------------------------------------------------------
alter table app.pedido_itens
  add column custo_unitario_brl numeric(14,4) check (custo_unitario_brl >= 0),
  add column cambio_custo       numeric(14,4) check (cambio_custo > 0);

-- Custo de um produto: o do cadastro; kit sem custo próprio soma o custo dos componentes
-- (só quando todos os componentes têm custo).
create or replace function app.custo_produto(p_produto uuid) returns numeric
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce(
    (select custo from app.produtos where id = p_produto),
    (select case when count(*) > 0 and count(*) = count(pr.custo) then sum(k.quantidade * pr.custo) end
       from app.kit_componentes k join app.produtos pr on pr.id = k.componente_id
      where k.kit_id = p_produto))
$$;

-- O custo é sempre o do cadastro no momento da venda: a aplicação não informa nem altera.
create or replace function app.item_custo() returns trigger
language plpgsql set search_path = app, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.produto_id is distinct from old.produto_id then
    new.custo_unitario_brl := case when new.produto_id is null then null else app.custo_produto(new.produto_id) end;
    new.cambio_custo := case when (select moeda from app.pedidos where id = new.pedido_id) = 'GS'
                             then app.param('cambio_custo_gs') end;
  elsif current_user in ('vc_app', 'vc_sync') then
    new.custo_unitario_brl := old.custo_unitario_brl;
    new.cambio_custo := old.cambio_custo;
  end if;
  return new;
end $$;
create trigger custo before insert or update on app.pedido_itens for each row execute function app.item_custo();

-- Itens já vendidos: recebem o custo atual do cadastro (aproximação para o histórico)
update app.pedido_itens i
   set custo_unitario_brl = app.custo_produto(i.produto_id),
       cambio_custo = case when p.moeda = 'GS' then app.param('cambio_custo_gs') end
  from app.pedidos p
 where p.id = i.pedido_id and i.produto_id is not null and i.custo_unitario_brl is null;

-- ---------------------------------------------------------------------
-- 3. Moeda escolhida no pedido: tabela = moeda escolhida + categoria do cliente
-- ---------------------------------------------------------------------
create or replace function app.tabela_para(p_cliente uuid, p_moeda app.moeda) returns text
language sql stable security definer set search_path = app, pg_temp as $$
  select case when p_moeda = 'GS' then 'py_' else 'br_' end || c.categoria_preco::text
    from app.clientes c where c.id = p_cliente
$$;

create or replace function app.preco_final_moeda(p_cliente uuid, p_produto uuid, p_moeda app.moeda, p_data date default current_date)
returns table (preco numeric, preco_tabela numeric, tabela text, promocao_id uuid, desconto_pct numeric, limite_qtd numeric)
language sql stable security definer set search_path = app, pg_temp as $$
  with base as (
    select pr.valor, pr.tabela from app.precos pr
     where pr.produto_id = p_produto and pr.tabela = app.tabela_para(p_cliente, p_moeda) and pr.vigente_desde <= p_data
     order by pr.vigente_desde desc limit 1),
  promo as (
    select pr.id, pr.desconto_pct, pr.limite_qtd from app.promocoes pr
     where pr.produto_id = p_produto and pr.status = 'aprovada' and p_data between pr.inicio and pr.fim
       and pr.pais = case when p_moeda = 'GS' then 'PY'::app.pais else 'BR'::app.pais end
     order by pr.desconto_pct desc limit 1)
  select case when promo.id is null then b.valor else app.arredondar_preco(b.valor * (1 - promo.desconto_pct / 100), p_moeda) end,
         b.valor, b.tabela, promo.id, promo.desconto_pct, promo.limite_qtd
    from base b left join promo on true
$$;

-- ---------------------------------------------------------------------
-- 4. Pedido da vendedora, com a moeda escolhida e conferindo o estoque
-- p_itens: [{"produto_id": "...", "quantidade": 12}] ou [{"produto_id": "...", "caixas": 2}]
-- Roda com as permissões de quem chama (a vendedora só vende para os próprios clientes).
-- p_para_cliente: o pedido fica "aguardando o cliente" e é enviado por link para ele confirmar.
-- ---------------------------------------------------------------------
create or replace function app.criar_pedido_vendedora(p_cliente uuid, p_moeda app.moeda, p_deposito uuid, p_previsao date,
    p_obs text, p_itens jsonb, p_para_cliente boolean default false)
returns uuid language plpgsql set search_path = app, pg_temp as $$
declare
  v_cli app.clientes; v_ped uuid; v_dep app.depositos; it jsonb; v_qtd numeric; v_prod app.produtos; f record;
  v_disp numeric; v_total numeric := 0; n int := 0; v_moeda app.moeda;
  v_exige boolean := coalesce(app.param('pedido_exige_estoque'), 0) = 1;
begin
  if not app.pode_escrever() then raise exception 'Sem permissão.' using errcode = 'insufficient_privilege'; end if;
  select * into v_cli from app.clientes where id = p_cliente and mesclado_em is null;
  if v_cli.id is null then raise exception 'Cliente não encontrado.'; end if;
  v_moeda := coalesce(p_moeda, v_cli.moeda);
  insert into app.pedidos (origem, canal, cliente_id, vendedora_id, data_pedido, moeda, valor_total, status_comercial,
                           previsao_envio, deposito_id, observacoes, criado_por)
  values ('manual', 'direto', v_cli.id, v_cli.vendedora_id, current_date, v_moeda, 0,
          case when p_para_cliente then 'aguardando_cliente'::app.status_comercial else 'em_separacao'::app.status_comercial end,
          p_previsao, p_deposito, nullif(left(trim(coalesce(p_obs, '')), 1000), ''), app.uid())
  returning id into v_ped;
  select d.* into v_dep from app.depositos d join app.pedidos p on p.deposito_id = d.id where p.id = v_ped;
  if v_exige and v_dep.id is null then
    raise exception 'Escolha o depósito do pedido para conferir o estoque.';
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    select * into v_prod from app.produtos where id = nullif(it->>'produto_id', '')::uuid and ativo;
    continue when v_prod.id is null and coalesce(it->>'produto_id', '') = '';
    if v_prod.id is null then raise exception 'Produto não encontrado ou inativo.'; end if;
    v_qtd := coalesce(nullif(it->>'quantidade', '')::numeric,
                      nullif(it->>'caixas', '')::numeric * coalesce(v_prod.unidades_caixa, 1));
    continue when v_qtd is null or v_qtd <= 0;
    select * into f from app.preco_final_moeda(v_cli.id, v_prod.id, v_moeda);
    if f.preco is null then
      raise exception 'O produto % não tem preço em % na tabela deste cliente.', v_prod.codigo,
        case when v_moeda = 'GS' then 'Gs' else 'R$' end;
    end if;
    if f.limite_qtd is not null and v_qtd > f.limite_qtd then
      raise exception 'Promoção de % limitada a % unidades por pedido.', v_prod.nome, f.limite_qtd;
    end if;
    if v_exige then
      v_disp := app.saldo_disponivel(v_dep.id, v_prod.id)
              + case when v_dep.abastecido_por is null then 0 else app.saldo_disponivel(v_dep.abastecido_por, v_prod.id) end
              - coalesce((select sum(quantidade) from app.pedido_itens where pedido_id = v_ped and produto_id = v_prod.id), 0);
      if v_qtd > v_disp then
        raise exception 'Estoque insuficiente de % (%): disponível %.', v_prod.nome, v_dep.nome, greatest(v_disp, 0);
      end if;
    end if;
    insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco)
    values (v_ped, v_prod.id, v_prod.codigo,
            v_prod.nome || case when f.promocao_id is not null then ' (promoção -' || f.desconto_pct::int || '%)' else '' end,
            v_qtd, f.preco, f.tabela);
    v_total := v_total + round(v_qtd * f.preco, 2);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Inclua pelo menos um produto com quantidade.'; end if;
  update app.pedidos set valor_total = v_total where id = v_ped;
  return v_ped;
end $$;

-- ---------------------------------------------------------------------
-- 5. Link do pedido para o cliente confirmar (enviado pelo WhatsApp)
-- Só o hash do token fica no banco. Um link novo substitui o anterior.
-- ---------------------------------------------------------------------
create table app.pedido_links (
  token_hash    text primary key,
  pedido_id     uuid not null references app.pedidos(id),
  criado_por    uuid references app.usuarios(id),
  criado_em     timestamptz not null default now(),
  expira_em     timestamptz not null,
  confirmado_em timestamptz,
  cancelado_em  timestamptz
);
create index on app.pedido_links (pedido_id);
alter table app.pedido_links enable row level security;   -- sem políticas: acesso só pelas funções abaixo
create trigger auditar after insert or update or delete on app.pedido_links for each row execute function app.auditar('pedido_id');

create or replace function app.gerar_link_pedido(p_pedido uuid, p_token_hash text) returns timestamptz
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; v_exp timestamptz;
begin
  select * into v_ped from app.pedidos where id = p_pedido for update;
  if v_ped.id is null or not app.pode_escrever() or not app.ve_pedido(v_ped.vendedora_id) then
    raise exception 'Pedido não encontrado ou sem permissão.' using errcode = 'insufficient_privilege';
  end if;
  if v_ped.status_comercial <> 'aguardando_cliente' then
    raise exception 'O link só pode ser gerado enquanto o pedido espera a confirmação do cliente.';
  end if;
  if v_ped.cliente_id is null then raise exception 'Pedido sem cliente.'; end if;
  if length(coalesce(p_token_hash, '')) < 32 then raise exception 'Link inválido.'; end if;
  update app.pedido_links set cancelado_em = now()
   where pedido_id = p_pedido and confirmado_em is null and cancelado_em is null;
  v_exp := now() + make_interval(days => greatest(coalesce(app.param('link_pedido_validade_dias'), 7), 1)::int);
  insert into app.pedido_links (token_hash, pedido_id, criado_por, expira_em) values (p_token_hash, p_pedido, app.uid(), v_exp);
  return v_exp;
end $$;

-- O que o cliente vê pelo link (nada de custo, margem ou dados internos)
create or replace function app.link_pedido(p_token_hash text)
returns table (pedido_id uuid, situacao text, cliente text, vendedora text, vendedora_whatsapp text, moeda app.moeda,
               data_pedido date, valor_total numeric, expira_em timestamptz, itens jsonb)
language sql stable security definer set search_path = app, pg_temp as $$
  select p.id,
         case when l.cancelado_em is not null then 'substituido'
              when l.confirmado_em is not null then 'confirmado'
              when l.expira_em < now() then 'expirado'
              when p.status_comercial <> 'aguardando_cliente' then 'fechado'
              else 'aberto' end,
         c.nome, v.nome, v.whatsapp, p.moeda, p.data_pedido, p.valor_total, l.expira_em,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'item_id', i.id, 'codigo', i.codigo, 'descricao', i.descricao, 'quantidade', i.quantidade,
                     'preco', i.preco_unitario, 'total', i.total, 'unidades_caixa', pr.unidades_caixa) order by i.descricao)
                     from app.pedido_itens i left join app.produtos pr on pr.id = i.produto_id
                    where i.pedido_id = p.id), '[]')
    from app.pedido_links l
    join app.pedidos p on p.id = l.pedido_id
    join app.clientes c on c.id = p.cliente_id
    join app.vendedoras v on v.id = p.vendedora_id
   where l.token_hash = p_token_hash
$$;

-- O cliente confirma (pode mudar a quantidade de cada item; 0 tira o item).
-- p_itens: [{"item_id": "...", "quantidade": 24}]. Item omitido fica como está.
create or replace function app.confirmar_link_pedido(p_token_hash text, p_itens jsonb, p_obs text default null) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  l app.pedido_links; v_ped app.pedidos; v_dep app.depositos; it record; v_q numeric; v_disp numeric; n int;
  v_exige boolean := coalesce(app.param('pedido_exige_estoque'), 0) = 1;
begin
  select * into l from app.pedido_links where token_hash = p_token_hash for update;
  if l.token_hash is null or l.cancelado_em is not null then
    raise exception 'Link inválido. Peça um novo link para a sua vendedora.';
  end if;
  if l.confirmado_em is not null then raise exception 'Este pedido já foi confirmado.'; end if;
  if l.expira_em < now() then raise exception 'Este link expirou. Peça um novo link para a sua vendedora.'; end if;
  select * into v_ped from app.pedidos where id = l.pedido_id for update;
  if v_ped.status_comercial <> 'aguardando_cliente' then raise exception 'Este pedido não está mais aguardando confirmação.'; end if;
  select * into v_dep from app.depositos where id = v_ped.deposito_id;
  perform set_config('app.motivo', 'Cliente confirmou o pedido pelo link', true);

  for it in
    select i.id, i.produto_id, i.descricao, i.quantidade,
           (select nullif(x->>'quantidade', '')::numeric from jsonb_array_elements(coalesce(p_itens, '[]')) x
             where x->>'item_id' = i.id::text limit 1) as nova
      from app.pedido_itens i where i.pedido_id = v_ped.id
  loop
    v_q := coalesce(it.nova, it.quantidade);
    if v_q < 0 or v_q > 100000 then raise exception 'Quantidade inválida em %.', it.descricao; end if;
    if v_q = 0 then
      delete from app.pedido_itens where id = it.id;
      continue;
    end if;
    if v_exige and v_dep.id is not null and it.produto_id is not null and v_q > it.quantidade then
      v_disp := app.saldo_disponivel(v_dep.id, it.produto_id)
              + case when v_dep.abastecido_por is null then 0 else app.saldo_disponivel(v_dep.abastecido_por, it.produto_id) end;
      if v_q > v_disp then
        raise exception 'No momento temos % unidades de %.', greatest(v_disp, 0), it.descricao;
      end if;
    end if;
    if v_q <> it.quantidade then
      update app.pedido_itens set quantidade = v_q, quantidade_pedida = v_q where id = it.id;
    end if;
  end loop;

  select count(*) into n from app.pedido_itens where pedido_id = v_ped.id;
  if n = 0 then raise exception 'O pedido precisa ter pelo menos um produto. Se não quiser mais, fale com a sua vendedora.'; end if;
  update app.pedidos
     set valor_total = (select coalesce(sum(total), 0) from app.pedido_itens where pedido_id = v_ped.id),
         status_comercial = 'em_separacao',
         observacoes = concat_ws(' | ', observacoes, 'Confirmado pelo cliente pelo link',
                                 'Cliente: ' || nullif(left(trim(coalesce(p_obs, '')), 500), ''))
   where id = v_ped.id;
  update app.pedido_links set confirmado_em = now() where token_hash = p_token_hash;
  return v_ped.id;
end $$;

-- A área do cliente mostra o pedido que espera a confirmação dele
create or replace function app.portal_pedidos(p_sessao_hash text)
returns table (id uuid, data_pedido date, bling_numero bigint, valor_total numeric, recebido numeric, a_conferir numeric,
               saldo numeric, moeda app.moeda, status_comercial app.status_comercial, status_pagamento text,
               etapa text, total_confirmado boolean, conta_pagamento text,
               previsao_envio date, vencimento date, observacoes text, itens jsonb,
               separado_em timestamptz, enviado_em date, chegou_em timestamptz, entregue_em date, local_retirada text, indisponiveis jsonb)
language sql stable security definer set search_path = app, pg_temp as $$
  select v.id, v.data_pedido, v.bling_numero, v.valor_total, v.recebido, v.a_conferir, v.saldo, v.moeda, v.status_comercial,
         v.status_pagamento,
         case
           when v.status_comercial = 'cancelado' then 'cancelado'
           when v.status_comercial = 'aguardando_cliente' then 'aguardando_cliente'
           when v.status_comercial = 'aguardando_aprovacao' then 'aguardando_vendedora'
           when v.status_comercial::text in ('enviado','aguardando_retirada','entregue') then v.status_comercial::text
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
                     from app.pedido_itens i where i.pedido_id = v.id), '[]'),
         p.separacao_conferida_em, p.enviado_em, p.chegou_em, p.entregue_em, p.local_retirada,
         coalesce((select jsonb_agg(jsonb_build_object('descricao', x.descricao, 'pedida', x.quantidade_pedida, 'faltou', x.quantidade_faltou)
                                    order by x.descricao)
                     from app.pedido_itens_indisponiveis x where x.pedido_id = v.id), '[]')
    from app.v_pedidos v join app.pedidos p on p.id = v.id
   where v.cliente_id = app.portal_cliente_id(p_sessao_hash)
   order by v.data_pedido desc, v.criado_em desc
   limit 100
$$;

-- ---------------------------------------------------------------------
-- 6. Volumes enviados (caixas de envio) e resumo semanal do Paraguai
-- ---------------------------------------------------------------------
alter table app.pedidos add column volumes int check (volumes between 0 and 10000);

create or replace function app.definir_volumes(p_pedido uuid, p_volumes int) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos;
begin
  select * into v_ped from app.pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if not ((app.pode_escrever() and app.ve_pedido(v_ped.vendedora_id)) or app.pode_operar_deposito(v_ped.deposito_id)) then
    raise exception 'Sem permissão para informar os volumes deste pedido.' using errcode = 'insufficient_privilege';
  end if;
  if p_volumes is not null and (p_volumes < 0 or p_volumes > 10000) then raise exception 'Número de volumes inválido.'; end if;
  perform set_config('app.motivo', 'Volumes do envio', true);
  update app.pedidos set volumes = p_volumes where id = p_pedido;
end $$;

-- ---------------------------------------------------------------------
-- 7a. Lucro por item vendido (na moeda do pedido)
-- ---------------------------------------------------------------------
create or replace view app.v_itens_lucro with (security_invoker = true) as
select x.*, x.receita - x.custo as lucro
  from (
    select i.id as item_id, i.pedido_id, p.data_pedido, p.vendedora_id, v.nome as vendedora_nome, p.cliente_id,
           p.moeda, p.canal, i.produto_id, coalesce(pr.nome, i.descricao) as produto, coalesce(pr.codigo, i.codigo) as codigo,
           pr.marca, i.quantidade, i.total as receita,
           case when i.custo_unitario_brl is not null then
             round(i.quantidade * i.custo_unitario_brl
                   * case when p.moeda = 'GS' then coalesce(i.cambio_custo, app.param('cambio_custo_gs')) else 1 end, 2)
           end as custo
      from app.pedido_itens i
      join app.pedidos p on p.id = i.pedido_id
      join app.vendedoras v on v.id = p.vendedora_id
      left join app.produtos pr on pr.id = i.produto_id
     where app.conta_como_venda(p.status_comercial)
  ) x;

-- ---------------------------------------------------------------------
-- 7b. Comissão: percentual e base por vendedora, com data de vigência
--   vendido  = total dos pedidos do mês
--   recebido = pagamentos conferidos com data no mês
--   lucro    = venda − custo dos itens do mês (só itens com custo cadastrado)
-- ---------------------------------------------------------------------
create table app.comissao_regras (
  vendedora_id  uuid not null references app.vendedoras(id),
  vigente_desde date not null,
  percentual    numeric(6,3) not null check (percentual >= 0 and percentual <= 100),
  base          text not null check (base in ('vendido', 'recebido', 'lucro')),
  observacao    text check (length(observacao) <= 300),
  definido_por  uuid references app.usuarios(id),
  definido_em   timestamptz not null default now(),
  primary key (vendedora_id, vigente_desde)
);
create or replace function app.preparar_comissao() returns trigger language plpgsql as $$
begin
  new.vigente_desde := date_trunc('month', new.vigente_desde)::date;   -- vale a partir do mês inteiro
  new.definido_por := app.uid();
  new.definido_em := now();
  return new;
end $$;
create trigger preparar before insert or update on app.comissao_regras for each row execute function app.preparar_comissao();
create trigger auditar after insert or update or delete on app.comissao_regras for each row execute function app.auditar('vendedora_id');
alter table app.comissao_regras enable row level security;
create policy ler on app.comissao_regras for select using (app.e_gestao() or vendedora_id = app.minha_vendedora());
create policy gerir on app.comissao_regras for all using (app.pode_gerir()) with check (app.pode_gerir());

create or replace function app.comissoes(p_mes date)
returns table (vendedora_id uuid, vendedora text, moeda app.moeda, base text, percentual numeric,
               vendido numeric, recebido numeric, lucro numeric, itens_sem_custo int, valor_base numeric, comissao numeric)
language sql stable set search_path = app, pg_temp as $$
  with per as (
    select date_trunc('month', p_mes)::date as ini, (date_trunc('month', p_mes) + interval '1 month - 1 day')::date as fim),
  reg as (
    select distinct on (r.vendedora_id) r.vendedora_id, r.base, r.percentual
      from app.comissao_regras r, per where r.vigente_desde <= per.fim
     order by r.vendedora_id, r.vigente_desde desc),
  vend as (
    select p.vendedora_id, p.moeda, sum(p.valor_total) as vendido
      from app.pedidos p, per
     where app.conta_como_venda(p.status_comercial) and p.data_pedido between per.ini and per.fim
     group by 1, 2),
  rec as (
    select p.vendedora_id, p.moeda, sum(g.valor) as recebido
      from app.pagamentos g join app.pedidos p on p.id = g.pedido_id, per
     where g.status_conferencia = 'conferido' and g.data between per.ini and per.fim and p.status_comercial <> 'cancelado'
     group by 1, 2),
  luc as (
    select l.vendedora_id, l.moeda, coalesce(sum(l.lucro), 0) as lucro, count(*) filter (where l.custo is null)::int as sem_custo
      from app.v_itens_lucro l, per where l.data_pedido between per.ini and per.fim
     group by 1, 2),
  chaves as (
    select vendedora_id, moeda from vend union select vendedora_id, moeda from rec union select vendedora_id, moeda from luc),
  calc as (
    select k.vendedora_id, v.nome, k.moeda, r.base, r.percentual,
           coalesce(vend.vendido, 0) as vendido, coalesce(rec.recebido, 0) as recebido, coalesce(luc.lucro, 0) as lucro,
           coalesce(luc.sem_custo, 0) as sem_custo,
           case r.base when 'vendido' then coalesce(vend.vendido, 0)
                       when 'recebido' then coalesce(rec.recebido, 0)
                       when 'lucro' then greatest(coalesce(luc.lucro, 0), 0) end as valor_base
      from chaves k
      join app.vendedoras v on v.id = k.vendedora_id
      left join reg r on r.vendedora_id = k.vendedora_id
      left join vend on vend.vendedora_id = k.vendedora_id and vend.moeda = k.moeda
      left join rec on rec.vendedora_id = k.vendedora_id and rec.moeda = k.moeda
      left join luc on luc.vendedora_id = k.vendedora_id and luc.moeda = k.moeda)
  select vendedora_id, nome, moeda, base, percentual, vendido, recebido, lucro, sem_custo, valor_base,
         round(valor_base * percentual / 100, case when moeda = 'GS' then 0 else 2 end)
    from calc
   order by moeda desc, nome
$$;

-- ---------------------------------------------------------------------
-- 8. Despesas e contas a pagar
-- ---------------------------------------------------------------------
create table app.despesa_categorias (
  codigo      text primary key check (codigo ~ '^[a-z_]{2,30}$'),
  nome        text not null,
  operacional boolean not null default true,   -- entra no resultado do mês (compra de mercadoria vira custo quando vende)
  ordem       int not null default 100,
  ativo       boolean not null default true
);
insert into app.despesa_categorias (codigo, nome, operacional, ordem) values
  ('mercadoria',     'Compras de mercadoria (marcas)', false, 1),
  ('aluguel',        'Aluguel',                         true, 2),
  ('salarios',       'Salários',                        true, 3),
  ('comissoes',      'Comissões',                       true, 4),
  ('administrativo', 'Administrativo',                  true, 5),
  ('transportadora', 'Transportadoras e fretes',        true, 6),
  ('passeiro',       'Passeiro (envios ao Paraguai)',   true, 7),
  ('impostos',       'Impostos e taxas',                true, 8),
  ('marketing',      'Marketing',                       true, 9),
  ('outros',         'Outros',                          true, 99);

create table app.despesas (
  id           uuid primary key default gen_random_uuid(),
  categoria    text not null references app.despesa_categorias(codigo),
  descricao    text not null check (length(trim(descricao)) between 1 and 200),
  fornecedor   text check (length(fornecedor) <= 120),        -- marca, locador, transportadora, passeiro...
  moeda        app.moeda not null,
  valor        numeric(14,2) not null check (valor > 0),
  competencia  date not null,                                 -- mês a que a despesa se refere (dia 1)
  vencimento   date,
  pago_em      date,
  valor_pago   numeric(14,2) check (valor_pago > 0),
  forma        text check (length(forma) <= 60),
  cambio       numeric(14,4) check (cambio > 0),               -- Gs por R$ efetivamente pago, quando houver troca
  documento    text check (length(documento) <= 80),           -- nº da nota, boleto, recibo
  observacao   text check (length(observacao) <= 500),
  criado_por   uuid references app.usuarios(id),
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint pago_completo check ((pago_em is null) = (valor_pago is null))
);
create index on app.despesas (competencia);
create index on app.despesas (vencimento) where pago_em is null;

create or replace function app.preparar_despesa() returns trigger language plpgsql as $$
begin
  new.competencia := date_trunc('month', coalesce(new.competencia, new.vencimento, new.pago_em, current_date))::date;
  if new.pago_em is null then new.valor_pago := null;
  elsif new.valor_pago is null then new.valor_pago := new.valor;
  end if;
  if tg_op = 'INSERT' then new.criado_por := app.uid(); new.criado_em := now();
  else new.criado_por := old.criado_por; new.criado_em := old.criado_em;
  end if;
  return new;
end $$;
create trigger preparar before insert or update on app.despesas for each row execute function app.preparar_despesa();
create trigger tocar before update on app.despesas for each row execute function app.tocar_atualizado();
create trigger auditar after insert or update or delete on app.despesas for each row execute function app.auditar('id');
create trigger auditar after insert or update or delete on app.despesa_categorias for each row execute function app.auditar('codigo');

alter table app.despesa_categorias enable row level security;
alter table app.despesas enable row level security;
create policy ler on app.despesa_categorias for select using (app.uid() is not null);
create policy gerir on app.despesa_categorias for all using (app.pode_gerir()) with check (app.pode_gerir());
create policy ler on app.despesas for select using (app.e_gestao());
create policy incluir on app.despesas for insert with check (app.pode_gerir());
create policy alterar on app.despesas for update using (app.pode_gerir()) with check (app.pode_gerir());
create policy apagar on app.despesas for delete using (app.pode_gerir() and pago_em is null);

create or replace view app.v_despesas with (security_invoker = true) as
select d.*, c.nome as categoria_nome, c.operacional,
       case when d.pago_em is not null then 'paga'
            when d.vencimento is null then 'sem_vencimento'
            when d.vencimento < current_date then 'vencida'
            when d.vencimento = current_date then 'vence_hoje'
            when d.vencimento <= current_date + 7 then 'vence_7_dias'
            else 'a_vencer' end as situacao
  from app.despesas d join app.despesa_categorias c on c.codigo = d.categoria;

-- ---------------------------------------------------------------------
-- 7c. Resultado do mês por moeda: lucro bruto (venda − custo) − despesas operacionais
-- (compra de mercadoria não entra: ela vira custo quando o produto é vendido)
-- ---------------------------------------------------------------------
create or replace function app.resultado_mensal(p_inicio date, p_fim date)
returns table (mes date, moeda app.moeda, vendido numeric, receita_itens numeric, custo numeric, lucro_bruto numeric,
               itens_sem_custo int, despesas numeric, resultado numeric)
language sql stable set search_path = app, pg_temp as $$
  with meses as (
    select generate_series(date_trunc('month', p_inicio), date_trunc('month', p_fim), interval '1 month')::date as mes),
  m as (select mes, x.moeda from meses cross join (values ('GS'::app.moeda), ('BRL'::app.moeda)) as x(moeda)),
  vend as (
    select date_trunc('month', data_pedido)::date as mes, moeda, sum(valor_total) as vendido
      from app.pedidos
     where app.conta_como_venda(status_comercial) and data_pedido between date_trunc('month', p_inicio) and p_fim
     group by 1, 2),
  luc as (
    select date_trunc('month', data_pedido)::date as mes, moeda,
           sum(receita) filter (where custo is not null) as receita, sum(custo) as custo, sum(lucro) as lucro,
           count(*) filter (where custo is null)::int as sem
      from app.v_itens_lucro
     where data_pedido between date_trunc('month', p_inicio) and p_fim
     group by 1, 2),
  desp as (
    select d.competencia as mes, d.moeda, sum(d.valor) as total
      from app.despesas d join app.despesa_categorias c on c.codigo = d.categoria
     where c.operacional and d.competencia between date_trunc('month', p_inicio) and p_fim
     group by 1, 2)
  select m.mes, m.moeda, coalesce(vend.vendido, 0), coalesce(luc.receita, 0), coalesce(luc.custo, 0), coalesce(luc.lucro, 0),
         coalesce(luc.sem, 0), coalesce(desp.total, 0), coalesce(luc.lucro, 0) - coalesce(desp.total, 0)
    from m
    left join vend on vend.mes = m.mes and vend.moeda = m.moeda
    left join luc on luc.mes = m.mes and luc.moeda = m.moeda
    left join desp on desp.mes = m.mes and desp.moeda = m.moeda
   order by m.mes, m.moeda desc
$$;

-- ---------------------------------------------------------------------
-- 6b. Envios ao Paraguai por semana: pedidos, volumes, caixas fechadas e peças;
-- custo estimado do passeiro (volumes × parâmetro) e o que foi pago ao passeiro na semana.
-- ---------------------------------------------------------------------
create or replace function app.envios_paraguai(p_inicio date, p_fim date)
returns table (semana date, pedidos int, clientes int, volumes int, pedidos_sem_volume int, caixas_fechadas numeric,
               pecas numeric, custo_estimado numeric, passeiro_pago numeric)
language sql stable set search_path = app, pg_temp as $$
  with ped as (
    select p.id, p.cliente_id, date_trunc('week', p.enviado_em)::date as semana, p.volumes
      from app.pedidos p join app.clientes c on c.id = p.cliente_id
     where c.pais = 'PY' and p.enviado_em between p_inicio and p_fim
       and p.status_comercial::text in ('enviado', 'aguardando_retirada', 'entregue')),
  it as (
    select ped.semana, sum(i.quantidade) as pecas,
           sum(case when pr.unidades_caixa > 0 then i.quantidade / pr.unidades_caixa end) as caixas
      from ped join app.pedido_itens i on i.pedido_id = ped.id left join app.produtos pr on pr.id = i.produto_id
     group by 1),
  sem as (
    select semana, count(*)::int as pedidos, count(distinct cliente_id)::int as clientes,
           coalesce(sum(volumes), 0)::int as volumes, count(*) filter (where volumes is null)::int as sem_vol
      from ped group by 1),
  pas as (
    select date_trunc('week', pago_em)::date as semana, sum(valor_pago) as total
      from app.despesas
     where categoria = 'passeiro' and moeda = 'GS' and pago_em between p_inicio and p_fim
     group by 1)
  select s.semana, s.pedidos, s.clientes, s.volumes, s.sem_vol, round(coalesce(it.caixas, 0), 1), coalesce(it.pecas, 0),
         s.volumes * coalesce(app.param('passeiro_custo_volume'), 0), coalesce(pas.total, 0)
    from sem s left join it on it.semana = s.semana left join pas on pas.semana = s.semana
   order by s.semana desc
$$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
grant select on app.v_itens_lucro, app.v_despesas, app.comissao_regras, app.despesa_categorias, app.despesas to vc_app;
grant insert, update, delete on app.comissao_regras, app.despesas to vc_app;
grant insert, update on app.despesa_categorias to vc_app;
grant execute on function
  app.conta_como_venda(app.status_comercial), app.custo_produto(uuid), app.tabela_para(uuid, app.moeda),
  app.preco_final_moeda(uuid, uuid, app.moeda, date),
  app.criar_pedido_vendedora(uuid, app.moeda, uuid, date, text, jsonb, boolean),
  app.gerar_link_pedido(uuid, text), app.link_pedido(text), app.confirmar_link_pedido(text, jsonb, text),
  app.definir_volumes(uuid, int), app.comissoes(date), app.resultado_mensal(date, date), app.envios_paraguai(date, date)
  to vc_app;
grant execute on function app.item_custo(), app.preparar_comissao(), app.preparar_despesa(), app.conta_como_venda(app.status_comercial)
  to vc_app, vc_sync;
