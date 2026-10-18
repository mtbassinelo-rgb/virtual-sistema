-- Ferramentas de venda do site: link da vendedora, compre junto, lista de reposição, aviso de "chegou",
-- desconto por quantidade e eventos do site (para o funil de vendas).

-- 1) Link da vendedora: distribuidoravirtualcosmeticos.com/loja/v/<slug>
alter table app.vendedoras add column slug text unique check (slug ~ '^[a-z0-9-]{2,30}$');
update app.vendedoras v set slug = s.slug
  from (select id, lower(regexp_replace(translate(split_part(trim(nome), ' ', 1), 'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ', 'aaaaeeiooouc' || 'AAAAEEIOOOUC'), '[^A-Za-z0-9]', '', 'g')) as slug,
               row_number() over (partition by lower(split_part(trim(nome), ' ', 1)) order by criado_em) as n
          from app.vendedoras where nome <> 'Marketplace') s
 where v.id = s.id and s.n = 1 and length(s.slug) >= 2;
alter table app.pedidos_site add column vendedora_id uuid references app.vendedoras(id);
alter table app.cadastros_site add column vendedora_id uuid references app.vendedoras(id);

create or replace function app.vendedora_do_link(p_slug text)
returns table (id uuid, nome text, whatsapp text)
language sql stable security definer set search_path = app, pg_temp as $$
  select id, nome, whatsapp from app.vendedoras where ativo and slug = lower(trim(p_slug)) and nome <> 'Marketplace'
$$;

-- Pedido ou cadastro de visitante que entrou pelo link da vendedora: fica na carteira dela
create or replace function app.site_atribuir_vendedora(p_tipo text, p_whatsapp text, p_slug text) returns text
language plpgsql security definer set search_path = app, pg_temp as $$
declare v app.vendedoras; z text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
begin
  select * into v from app.vendedoras where ativo and slug = lower(trim(coalesce(p_slug, ''))) and nome <> 'Marketplace';
  if v.id is null then return null; end if;
  if p_tipo = 'pedido' then
    update app.pedidos_site set vendedora_id = v.id
     where id = (select id from app.pedidos_site where whatsapp = z and vendedora_id is null and criado_em > now() - interval '5 minutes' order by criado_em desc limit 1);
  elsif p_tipo = 'cadastro' then
    update app.cadastros_site set vendedora_id = v.id
     where id = (select id from app.cadastros_site where whatsapp = z and vendedora_id is null and criado_em > now() - interval '5 minutes' order by criado_em desc limit 1);
  end if;
  return nullif(regexp_replace(coalesce(v.whatsapp, ''), '\D', '', 'g'), '');
end $$;

-- 2) Compre junto: o que os clientes costumam levar junto (pedidos do último ano) e, se faltar, a mesma linha da marca
create or replace function app.compre_junto(p_produtos uuid[], p_limite int default 6)
returns table (produto_id uuid, motivo text)
language sql stable security definer set search_path = app, pg_temp as $$
  with juntos as (
    select i2.produto_id, count(distinct i2.pedido_id) as n
      from app.pedido_itens i1
      join app.pedidos p on p.id = i1.pedido_id and p.status_comercial <> 'cancelado' and p.data_pedido > current_date - 365
      join app.pedido_itens i2 on i2.pedido_id = i1.pedido_id and i2.produto_id <> all(p_produtos)
     where i1.produto_id = any(p_produtos)
     group by 1),
  linha as (
    select distinct o.id as produto_id
      from app.produtos b cross join lateral app.linha_capilar(b.nome, b.marca) lb
      join app.produtos o on o.marca = b.marca and o.id <> all(p_produtos) and o.ativo and o.tipo <> 'kit'
      cross join lateral app.linha_capilar(o.nome, o.marca) lo
     where b.id = any(p_produtos) and lo.linha is not null and lo.linha = lb.linha)
  select x.produto_id, x.motivo from (
    select j.produto_id, 'juntos' as motivo, j.n::numeric as peso from juntos j
    union all
    select l.produto_id, 'linha', 0.5 from linha l where l.produto_id not in (select produto_id from juntos)
  ) x join app.produtos pr on pr.id = x.produto_id and pr.ativo and pr.mostrar_no_site
  order by x.peso desc, pr.nome limit greatest(1, least(coalesce(p_limite, 6), 20))
$$;

-- 3) Lista de reposição do cliente: o que ele compra, quantas vezes e a quantidade de costume
create or replace function app.portal_reposicao(p_sessao_hash text)
returns table (produto_id uuid, vezes int, quantidade_media numeric, ultima date)
language sql stable security definer set search_path = app, pg_temp as $$
  select i.produto_id, count(distinct p.id)::int, round(avg(i.quantidade)), max(p.data_pedido)
    from app.pedidos p join app.pedido_itens i on i.pedido_id = p.id
    join app.produtos pr on pr.id = i.produto_id and pr.ativo
   where p.cliente_id = app.portal_cliente_id(p_sessao_hash) and p.status_comercial <> 'cancelado'
     and p.data_pedido > current_date - 365 and i.produto_id is not null
   group by 1 order by 2 desc, 4 desc limit 80
$$;

-- 4) "Chegou": procuras de produtos que voltaram ao estoque, para a vendedora avisar o cliente
alter table app.procuras add column avisado_em timestamptz, add column avisado_por uuid references app.usuarios(id);
create or replace function app.procuras_chegaram()
returns table (id uuid, produto_id uuid, produto text, quantidade numeric, cliente text, whatsapp text, vendedora text, criado_em timestamptz, estoque numeric)
language sql stable security definer set search_path = app, pg_temp as $$
  select pc.id, pc.produto_id, pr.nome, pc.quantidade, coalesce(c.nome, pc.contato_nome),
         coalesce(nullif(regexp_replace(coalesce(c.whatsapp, c.telefone, ''), '\D', '', 'g'), ''), regexp_replace(coalesce(pc.contato_whatsapp, ''), '\D', '', 'g')),
         v.nome, pc.criado_em, s.saldo
    from app.procuras pc
    join app.produtos pr on pr.id = pc.produto_id and pr.ativo
    left join app.clientes c on c.id = pc.cliente_id
    left join app.vendedoras v on v.id = c.vendedora_id
    cross join lateral (select coalesce(sum(es.quantidade), 0) saldo from app.estoque_saldos es join app.depositos d on d.id = es.deposito_id and d.ativo
                         where es.produto_id = pr.id) s
   where pc.avisado_em is null and s.saldo > 0 and app.uid() is not null
     and (app.perfil_atual() in ('gerente','dono') or c.vendedora_id = (select vendedora_id from app.usuarios where id = app.uid()) or pc.cliente_id is null)
   order by pc.criado_em
$$;
create or replace function app.marcar_procura_avisada(p_id uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if app.uid() is null then raise exception 'Entre no sistema.' using errcode = 'insufficient_privilege'; end if;
  update app.procuras set avisado_em = now(), avisado_por = app.uid() where id = p_id and avisado_em is null;
end $$;
-- Cliente logado vê no site o que ele pediu e já chegou
create or replace function app.portal_chegaram(p_sessao_hash text)
returns table (produto_id uuid, nome text)
language sql stable security definer set search_path = app, pg_temp as $$
  select distinct pr.id, pr.nome from app.procuras pc join app.produtos pr on pr.id = pc.produto_id and pr.ativo
   where pc.cliente_id = app.portal_cliente_id(p_sessao_hash) and pc.criado_em > now() - interval '120 days'
     and exists (select 1 from app.estoque_saldos es where es.produto_id = pr.id and es.quantidade > 0
                   and es.deposito_id = app.deposito_do_cliente(pc.cliente_id))
$$;

-- 5) Desconto por quantidade: levando N caixas (ou unidades, quando o produto não tem caixa) da marca, X% de desconto
create table app.descontos_quantidade (
  id          uuid primary key default gen_random_uuid(),
  marca       text,                                  -- vazio = qualquer marca
  min_qtd     int not null check (min_qtd between 2 and 10000),
  desconto_pct numeric(5,2) not null check (desconto_pct > 0 and desconto_pct <= 30),
  pais        app.pais,                              -- vazio = os dois países
  ativo       boolean not null default true,
  criado_por  uuid references app.usuarios(id),
  criado_em   timestamptz not null default now()
);
alter table app.descontos_quantidade enable row level security;
create policy ler on app.descontos_quantidade for select using (app.uid() is not null);
grant select on app.descontos_quantidade to vc_app;
create trigger auditar after insert or update or delete on app.descontos_quantidade for each row execute function app.auditar('id');

create or replace function app.salvar_desconto_quantidade(p_id uuid, p_marca text, p_min int, p_pct numeric, p_pais text, p_ativo boolean)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare v uuid;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono define descontos.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then
    insert into app.descontos_quantidade (marca, min_qtd, desconto_pct, pais, ativo, criado_por)
    values (nullif(upper(trim(coalesce(p_marca, ''))), ''), p_min, p_pct, nullif(p_pais, '')::app.pais, coalesce(p_ativo, true), app.uid()) returning id into v;
  else
    update app.descontos_quantidade set marca = nullif(upper(trim(coalesce(p_marca, ''))), ''), min_qtd = p_min, desconto_pct = p_pct,
           pais = nullif(p_pais, '')::app.pais, ativo = coalesce(p_ativo, true) where id = p_id returning id into v;
  end if;
  return v;
end $$;

-- Regras ativas para o site (públicas: o carrinho mostra "faltam N caixas para X%")
create or replace function app.descontos_quantidade_ativos()
returns table (marca text, min_qtd int, desconto_pct numeric, pais app.pais)
language sql stable security definer set search_path = app, pg_temp as $$
  select marca, min_qtd, desconto_pct, pais from app.descontos_quantidade where ativo order by marca nulls last, min_qtd
$$;

-- Aplica no pedido do cliente recém-criado pelo site: por marca, soma as caixas (ou unidades) e usa a maior faixa atingida
create or replace function app.portal_aplicar_desconto_quantidade(p_sessao_hash text, p_pedido uuid) returns numeric
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; v_pais app.pais; r record; v_total numeric;
begin
  select * into v_ped from app.pedidos where id = p_pedido and cliente_id = app.portal_cliente_id(p_sessao_hash) and origem = 'portal'
     and criado_em > now() - interval '10 minutes' and total_confirmado_em is null;
  if v_ped.id is null then return 0; end if;
  v_pais := case when v_ped.moeda = 'GS' then 'PY' else 'BR' end;
  for r in
    with q as (
      select pr.marca, sum(case when pr.unidades_caixa > 0 then i.quantidade / pr.unidades_caixa else i.quantidade end) as qtd
        from app.pedido_itens i join app.produtos pr on pr.id = i.produto_id
       where i.pedido_id = p_pedido and i.descricao not ilike '%(promoção%' group by pr.marca)
    select q.marca, max(d.desconto_pct) as pct
      from q join app.descontos_quantidade d on d.ativo and (d.marca is null or d.marca = q.marca) and (d.pais is null or d.pais = v_pais)
       and q.qtd >= d.min_qtd
     group by q.marca
  loop
    update app.pedido_itens i set preco_unitario = app.arredondar_preco(i.preco_unitario * (1 - r.pct / 100), v_ped.moeda),
           descricao = i.descricao || ' (−' || trim(to_char(r.pct, 'FM990.##')) || '% por quantidade)'
      from app.produtos pr
     where i.pedido_id = p_pedido and pr.id = i.produto_id and pr.marca is not distinct from r.marca and i.descricao not ilike '%(promoção%';
  end loop;
  select round(sum(quantidade * preco_unitario), 2) into v_total from app.pedido_itens where pedido_id = p_pedido;
  update app.pedidos set valor_total = coalesce(v_total, 0) where id = p_pedido;
  return v_ped.valor_total - coalesce(v_total, 0);
end $$;

-- 6) Eventos do site para o funil: visitas, buscas, produto adicionado ao carrinho
create table app.eventos_site (
  id         bigserial primary key,
  tipo       text not null check (tipo in ('visita','busca','carrinho','pedido')),
  sessao     text,                 -- identificador anônimo do navegador
  cliente_id uuid references app.clientes(id),
  produto_id uuid references app.produtos(id),
  termo      text,
  resultados int,
  unidade    text,
  em         timestamptz not null default now()
);
create index on app.eventos_site (em desc);
create index on app.eventos_site (tipo, em desc);
alter table app.eventos_site enable row level security;
create policy ler on app.eventos_site for select using (app.perfil_atual() in ('gerente','dono'));
grant select on app.eventos_site to vc_app;

create or replace function app.registrar_evento_site(p_tipo text, p_sessao text, p_sessao_cliente text, p_produto uuid, p_termo text, p_resultados int, p_unidade text)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if p_tipo not in ('visita','busca','carrinho','pedido') then return; end if;
  -- proteção contra excesso: no máximo 300 eventos por navegador por hora
  if (select count(*) from app.eventos_site where sessao = left(p_sessao, 64) and em > now() - interval '1 hour') >= 300 then return; end if;
  insert into app.eventos_site (tipo, sessao, cliente_id, produto_id, termo, resultados, unidade)
  values (p_tipo, left(p_sessao, 64), case when p_sessao_cliente is not null then app.portal_cliente_id(p_sessao_cliente) end,
          (select id from app.produtos where id = p_produto), nullif(left(lower(trim(coalesce(p_termo, ''))), 80), ''), p_resultados, left(p_unidade, 20));
end $$;

grant execute on function app.vendedora_do_link(text), app.site_atribuir_vendedora(text, text, text), app.compre_junto(uuid[], int),
  app.portal_reposicao(text), app.procuras_chegaram(), app.marcar_procura_avisada(uuid), app.portal_chegaram(text),
  app.salvar_desconto_quantidade(uuid, text, int, numeric, text, boolean), app.descontos_quantidade_ativos(),
  app.portal_aplicar_desconto_quantidade(text, uuid), app.registrar_evento_site(text, text, text, uuid, text, int, text) to vc_app;
