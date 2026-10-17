-- Fotos tiradas do catálogo em PDF (Canva). Cada cartão do catálogo vira uma foto candidata,
-- com o produto sugerido pela comparação de nomes. As certas já entram no produto; as outras
-- a gerência confirma, troca o produto ou descarta na tela Produtos → Fotos do catálogo.
create table app.fotos_catalogo (
  id           text primary key check (id ~ '^p[0-9]{2}-[0-9]{2}$'),   -- página e posição no catálogo
  pagina       int  not null check (pagina between 1 and 999),
  nome         text not null default '' check (length(nome) <= 300),     -- nome escrito no cartão
  sugestao     uuid references app.produtos(id) on delete set null,
  sugestao2    uuid references app.produtos(id) on delete set null,
  confianca    numeric(4,2),
  status       text not null default 'pendente' check (status in ('pendente','aplicada','descartada')),
  produto_id   uuid references app.produtos(id) on delete set null,      -- onde a foto foi usada
  decidido_por uuid references app.usuarios(id),
  decidido_em  timestamptz,
  criado_em    timestamptz not null default now()
);
create index on app.fotos_catalogo (status, pagina, id);
alter table app.fotos_catalogo enable row level security;
create policy ler on app.fotos_catalogo for select using (app.perfil_atual() in ('gerente','dono'));
grant select on app.fotos_catalogo to vc_app;
create trigger auditar after insert or update or delete on app.fotos_catalogo for each row execute function app.auditar('id');

-- Carga das candidatas (script do servidor). Não mexe nas que já foram decididas.
create or replace function app.importar_fotos_catalogo(p_itens jsonb) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_n int;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono importa fotos.' using errcode = 'insufficient_privilege';
  end if;
  insert into app.fotos_catalogo (id, pagina, nome, sugestao, sugestao2, confianca)
  select i->>'id', (i->>'pagina')::int, left(coalesce(i->>'nome',''), 300),
         (select id from app.produtos where codigo = i->>'sugestao'),
         (select id from app.produtos where codigo = i->>'sugestao2'),
         nullif(i->>'confianca','')::numeric
    from jsonb_array_elements(p_itens) i
  on conflict (id) do update set pagina = excluded.pagina, nome = excluded.nome, sugestao = excluded.sugestao,
         sugestao2 = excluded.sugestao2, confianca = excluded.confianca
   where app.fotos_catalogo.status = 'pendente';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Registra a decisão sobre uma foto. 'aplicar' exige o produto; a aplicação copia o arquivo e chama definir_foto.
create or replace function app.decidir_foto_catalogo(p_id text, p_acao text, p_produto uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono decide as fotos do catálogo.' using errcode = 'insufficient_privilege';
  end if;
  if p_acao = 'aplicar' then
    if p_produto is null or not exists (select 1 from app.produtos where id = p_produto) then raise exception 'Escolha o produto.'; end if;
    update app.fotos_catalogo set status = 'aplicada', produto_id = p_produto, decidido_por = app.uid(), decidido_em = now() where id = p_id;
  elsif p_acao = 'descartar' then
    update app.fotos_catalogo set status = 'descartada', produto_id = null, decidido_por = app.uid(), decidido_em = now() where id = p_id;
  elsif p_acao = 'reabrir' then
    update app.fotos_catalogo set status = 'pendente', produto_id = null, decidido_por = null, decidido_em = null where id = p_id;
  else
    raise exception 'Ação inválida.';
  end if;
  if not found then raise exception 'Foto do catálogo não encontrada.'; end if;
end $$;

grant execute on function app.importar_fotos_catalogo(jsonb), app.decidir_foto_catalogo(text, text, uuid) to vc_app;
