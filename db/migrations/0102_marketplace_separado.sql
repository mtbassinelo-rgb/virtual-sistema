-- =====================================================================
-- Migração 0102: produtos de marketplace separados do catálogo da distribuidora
--
-- Kits e anúncios criados para Shopee, Mercado Livre e TikTok (KIT2-, KC-, MLB...,
-- SEMCOD-, IDs de anúncio) ficam marcados como "marketplace": saem das telas de
-- preço, produtos, catálogo e pedidos (não têm preço de atacado) e ganham uma
-- área própria. Nada muda em preço nem em estoque.
-- =====================================================================

alter table app.produtos add column if not exists marketplace boolean not null default false;
create index if not exists produtos_marketplace on app.produtos (marketplace) where marketplace;

-- Códigos que são de anúncio de marketplace
create or replace function app.codigo_de_marketplace(p_codigo text) returns boolean
language sql immutable as $$
  select coalesce(p_codigo ~ '^(KIT[0-9]+-|KC-|MLBU?[0-9]|SEMCOD-)' or p_codigo ~ '^[0-9]{11}(-|$)', false)
$$;

update app.produtos set marketplace = true where app.codigo_de_marketplace(codigo) and not marketplace;

-- Produto novo com código de anúncio já nasce como marketplace (a marcação manual depois prevalece)
create or replace function app.produto_marketplace_padrao() returns trigger language plpgsql as $$
begin
  if app.codigo_de_marketplace(new.codigo) then new.marketplace := true; end if;
  return new;
end $$;
drop trigger if exists marketplace_padrao on app.produtos;
create trigger marketplace_padrao before insert on app.produtos for each row execute function app.produto_marketplace_padrao();

-- Novos marketplaces (para quando começarmos a vender neles)
insert into app.canais (codigo, nome, marketplace) values ('temu', 'Temu', true), ('shein', 'Shein', true)
on conflict (codigo) do nothing;

-- Disponível de cada produto de marketplace no CD: kit = quantos kits fecham com os componentes em estoque
create or replace function app.marketplace_disponivel(p_produto uuid, p_deposito uuid) returns numeric
language sql stable security invoker set search_path = app, pg_temp as $$
  select coalesce(floor(min(coalesce(s.quantidade, 0) / nullif(c.quantidade, 0))), 0)
    from app.componentes(p_produto, 1) c
    left join app.estoque_saldos s on s.produto_id = c.produto_id and s.deposito_id = p_deposito
$$;
grant execute on function app.marketplace_disponivel(uuid, uuid), app.codigo_de_marketplace(text) to vc_app;
