-- Vitrine pública do site (sem preços) e pedidos de visitantes enviados pelo WhatsApp.

-- Produtos que aparecem no site: só dados de vitrine (nada de custo, preço ou fornecedor).
create or replace function app.vitrine_publica()
returns table (produto_id uuid, codigo text, nome text, marca text, tipo text, foto text, tem_estoque boolean)
language sql stable security definer set search_path = app, pg_temp as $$
  select p.id, p.codigo, p.nome, p.marca, p.tipo, p.foto,
         exists (select 1 from app.depositos d where d.ativo and app.saldo_disponivel(d.id, p.id) > 0)
    from app.produtos p
   where p.ativo
   order by p.nome
$$;
grant execute on function app.vitrine_publica() to vc_app;

-- Pedido montado por um visitante (ainda não é cliente). Vira atendimento da equipe.
create table app.pedidos_site (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(nome) between 2 and 120),
  whatsapp    text not null check (whatsapp ~ '^[0-9]{8,15}$'),
  pais        app.pais not null,
  cidade      text check (length(cidade) <= 120),
  itens       jsonb not null check (jsonb_typeof(itens) = 'array' and jsonb_array_length(itens) between 1 and 200),
  observacao  text check (length(observacao) <= 1000),
  criado_em   timestamptz not null default now(),
  atendido_em timestamptz,
  atendido_por uuid references app.usuarios(id)
);
create index on app.pedidos_site (criado_em desc);
alter table app.pedidos_site enable row level security;
create policy ler on app.pedidos_site for select using (app.uid() is not null and app.perfil_atual() <> 'consulta');
create policy atender on app.pedidos_site for update using (app.pode_escrever()) with check (app.pode_escrever());
grant select, update (atendido_em, atendido_por) on app.pedidos_site to vc_app;
create trigger auditar after insert or update or delete on app.pedidos_site for each row execute function app.auditar('id');

-- Entrada pública, com limites contra abuso. Devolve o WhatsApp da empresa que atende o país.
create or replace function app.registrar_pedido_site(p_nome text, p_whatsapp text, p_pais app.pais, p_cidade text,
                                                     p_itens jsonb, p_obs text)
returns text language plpgsql security definer set search_path = app, pg_temp as $$
declare v_zap text := regexp_replace(coalesce(p_whatsapp,''), '\D', '', 'g'); v_itens jsonb;
begin
  if (select count(*) from app.pedidos_site where criado_em > now() - interval '1 hour') >= 120 then
    raise exception 'Muitos pedidos agora. Fale direto pelo WhatsApp.';
  end if;
  if (select count(*) from app.pedidos_site where whatsapp = v_zap and criado_em > now() - interval '10 minutes') >= 3 then
    raise exception 'Você já enviou pedidos agora há pouco. Continue a conversa pelo WhatsApp.';
  end if;
  if length(trim(coalesce(p_nome,''))) < 2 then raise exception 'Informe o seu nome.'; end if;
  if length(v_zap) < 8 then raise exception 'Informe um WhatsApp válido, com DDD.'; end if;
  -- só guarda produtos que existem, com quantidade inteira e razoável
  select jsonb_agg(jsonb_build_object('produto_id', p.id, 'codigo', p.codigo, 'nome', p.nome, 'quantidade', q.qtd) order by p.nome)
    into v_itens
    from (select (e->>'produto_id')::uuid as id, least(greatest(floor((e->>'quantidade')::numeric), 0), 10000) as qtd
            from jsonb_array_elements(coalesce(p_itens,'[]')) e
           where (e->>'produto_id') ~ '^[0-9a-f-]{36}$' and (e->>'quantidade') ~ '^[0-9]+(\.[0-9]+)?$') q
    join app.produtos p on p.id = q.id and p.ativo
   where q.qtd > 0;
  if v_itens is null then raise exception 'O carrinho está vazio.'; end if;
  insert into app.pedidos_site (nome, whatsapp, pais, cidade, itens, observacao)
  values (left(trim(p_nome), 120), v_zap, p_pais, nullif(left(trim(coalesce(p_cidade,'')), 120), ''), v_itens,
          nullif(left(trim(coalesce(p_obs,'')), 1000), ''));
  return app.whatsapp_empresa(case when p_pais = 'PY' then 'GS'::app.moeda else 'BRL'::app.moeda end);
end $$;
grant execute on function app.registrar_pedido_site(text, text, app.pais, text, jsonb, text) to vc_app;

-- O cliente com acesso fala com o WhatsApp da vendedora dele; sem número cadastrado, o da empresa.
create or replace function app.portal_perfil(p_sessao_hash text)
returns table (cliente_id uuid, nome text, moeda app.moeda, categoria app.categoria_preco, pais app.pais,
               vendedora text, vendedora_whatsapp text)
language sql stable security definer set search_path = app, pg_temp as $$
  select c.id, c.nome, c.moeda, c.categoria_preco, c.pais, v.nome,
         coalesce(nullif(regexp_replace(coalesce(v.whatsapp,''), '\D', '', 'g'), ''), app.whatsapp_empresa(c.moeda))
    from app.clientes c join app.vendedoras v on v.id = c.vendedora_id
   where c.id = app.portal_cliente_id(p_sessao_hash)
$$;
