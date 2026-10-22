-- Banners: imagem própria para celular (opcional) e só os banners cadastrados pela equipe aparecem no site.
alter table app.banners add column if not exists imagem_celular text
  check (imagem_celular ~ '^/fotos/[0-9a-f-]{36}-[0-9]+\.(jpg|png|webp)$');

drop function if exists app.banners_ativos(text);
create function app.banners_ativos(p_idioma text)
returns table (id uuid, titulo text, subtitulo text, imagem text, link text, imagem_celular text)
language sql stable security definer set search_path = app, pg_temp as $$
  select b.id, b.titulo, b.subtitulo, b.imagem, b.link, b.imagem_celular from app.banners b
   where b.ativo and b.idioma in ('todos', coalesce(p_idioma, 'pt'))
     and (b.inicio is null or b.inicio <= current_date) and (b.fim is null or b.fim >= current_date)
   order by b.ordem, b.criado_em desc
$$;
grant execute on function app.banners_ativos(text) to vc_app;
