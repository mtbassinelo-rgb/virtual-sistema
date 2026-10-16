-- Banners da página inicial do site e produtos marcados como novidade.

alter table app.produtos add column novidade boolean not null default false;

create table app.banners (
  id         uuid primary key default gen_random_uuid(),
  titulo     text not null check (length(titulo) between 1 and 120),
  subtitulo  text check (length(subtitulo) <= 200),
  imagem     text check (imagem ~ '^/fotos/[0-9a-f-]{36}-[0-9]+\.(jpg|png|webp)$'),
  link       text check (link ~ '^/loja' or link ~ '^https://'),
  idioma     text not null default 'todos' check (idioma in ('todos','pt','es')),
  ordem      int not null default 0,
  ativo      boolean not null default true,
  inicio     date,
  fim        date,
  criado_por uuid references app.usuarios(id),
  criado_em  timestamptz not null default now(),
  constraint periodo check (fim is null or inicio is null or fim >= inicio)
);
create trigger auditar after insert or update or delete on app.banners for each row execute function app.auditar('id');
alter table app.banners enable row level security;
create policy ler on app.banners for select using (app.uid() is not null);
create policy gerir on app.banners for all using (app.pode_gerir()) with check (app.pode_gerir());
grant select, insert, update, delete on app.banners to vc_app;

-- Banners que aparecem agora no site (público)
create or replace function app.banners_ativos(p_idioma text)
returns table (id uuid, titulo text, subtitulo text, imagem text, link text)
language sql stable security definer set search_path = app, pg_temp as $$
  select b.id, b.titulo, b.subtitulo, b.imagem, b.link from app.banners b
   where b.ativo and b.idioma in ('todos', coalesce(p_idioma, 'pt'))
     and (b.inicio is null or b.inicio <= current_date) and (b.fim is null or b.fim >= current_date)
   order by b.ordem, b.criado_em desc
$$;
grant execute on function app.banners_ativos(text) to vc_app;

create or replace function app.definir_novidade(p_id uuid, p_novidade boolean) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono marca novidades.' using errcode = 'insufficient_privilege';
  end if;
  update app.produtos set novidade = coalesce(p_novidade, false) where id = p_id;
end $$;
grant execute on function app.definir_novidade(uuid, boolean) to vc_app;

-- a vitrine passa a informar também se é novidade
drop function app.vitrine_publica();
create function app.vitrine_publica()
returns table (produto_id uuid, codigo text, nome text, marca text, tipo text, foto text, tem_estoque boolean, novidade boolean)
language sql stable security definer set search_path = app, pg_temp as $$
  select p.id, p.codigo, p.nome, p.marca, p.tipo, p.foto,
         exists (select 1 from app.depositos d where d.ativo and app.saldo_disponivel(d.id, p.id) > 0),
         p.novidade
    from app.produtos p
   where p.ativo
   order by p.nome
$$;
grant execute on function app.vitrine_publica() to vc_app;
