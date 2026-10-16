-- WhatsApp da empresa na área do cliente:
--   brasil   → número principal do site (e clientes em R$)
--   paraguai → clientes em Gs (pedido enviado, dúvidas, pagamento)
-- A vendedora continua sendo quem atende; o número exibido ao cliente é o da empresa.

create table app.contatos_empresa (
  chave      text primary key check (chave in ('brasil','paraguai')),
  whatsapp   text not null check (whatsapp ~ '^[0-9]{10,15}$'),   -- só dígitos, com DDI
  descricao  text not null
);
insert into app.contatos_empresa values
  ('brasil',   '5545999972092', 'Principal do site e clientes em R$'),
  ('paraguai', '595994859971',  'Clientes em Gs');
create trigger auditar after insert or update or delete on app.contatos_empresa for each row execute function app.auditar('chave');
alter table app.contatos_empresa enable row level security;
create policy ler on app.contatos_empresa for select using (true);
create policy gerir on app.contatos_empresa for all using (app.pode_gerir()) with check (app.pode_gerir());
grant select, update on app.contatos_empresa to vc_app;

create or replace function app.whatsapp_empresa(p_moeda app.moeda default null) returns text
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce((select whatsapp from app.contatos_empresa where chave = case when p_moeda = 'GS' then 'paraguai' else 'brasil' end),
                  (select whatsapp from app.contatos_empresa where chave = 'brasil'))
$$;
grant execute on function app.whatsapp_empresa(app.moeda) to vc_app, vc_sync;

-- O cliente vê o WhatsApp da empresa conforme a moeda dele (a vendedora pode não ter número cadastrado)
create or replace function app.portal_perfil(p_sessao_hash text)
returns table (cliente_id uuid, nome text, moeda app.moeda, categoria app.categoria_preco, pais app.pais,
               vendedora text, vendedora_whatsapp text)
language sql stable security definer set search_path = app, pg_temp as $$
  select c.id, c.nome, c.moeda, c.categoria_preco, c.pais, v.nome, app.whatsapp_empresa(c.moeda)
    from app.clientes c join app.vendedoras v on v.id = c.vendedora_id
   where c.id = app.portal_cliente_id(p_sessao_hash)
$$;
