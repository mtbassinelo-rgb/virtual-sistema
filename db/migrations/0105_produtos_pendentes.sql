-- =====================================================================
-- Migração 0105: produtos pendentes enviados pela vendedora
--
-- A vendedora fotografa um produto que tem na unidade dela (ex.: loja CDE),
-- informa quantidade e preço ofertado. Gerente/dono confere e clica em
-- "Atualizar": o produto (novo ou já cadastrado) recebe a foto, a quantidade
-- entra no estoque da unidade e o preço vai para a tabela da unidade
-- (CDE → CDE Normal/VIP; demais → Paraguai Normal/VIP). Aí aparece no catálogo.
-- =====================================================================

create table if not exists app.produtos_pendentes (
  id             uuid primary key default gen_random_uuid(),
  deposito_id    uuid not null references app.depositos(id),
  descricao      text not null check (length(trim(descricao)) > 1),
  marca          text,
  quantidade     numeric(12,3) not null check (quantidade > 0),
  preco_normal   numeric(14,2) not null check (preco_normal > 0),
  preco_vip      numeric(14,2) check (preco_vip is null or preco_vip > 0),
  foto           text,                 -- arquivo na pasta privada (até ser aprovado)
  foto_mime      text,
  observacao     text,
  status         text not null default 'pendente' check (status in ('pendente','aprovado','recusado')),
  produto_id     uuid references app.produtos(id) on delete set null,
  criado_por     uuid references app.usuarios(id) default app.uid(),
  criado_em      timestamptz not null default now(),
  decidido_por   uuid references app.usuarios(id),
  decidido_em    timestamptz,
  motivo         text
);
create index if not exists produtos_pendentes_abertos on app.produtos_pendentes (criado_em) where status = 'pendente';
alter table app.produtos_pendentes enable row level security;
drop policy if exists ler on app.produtos_pendentes;
create policy ler on app.produtos_pendentes for select using (app.pode_gerir() or criado_por = app.uid());
grant select on app.produtos_pendentes to vc_app;

-- Vendedora (ou quem opera a unidade) envia
create or replace function app.enviar_produto_pendente(p_deposito uuid, p_descricao text, p_marca text, p_quantidade numeric,
  p_normal numeric, p_vip numeric, p_foto text, p_mime text, p_obs text) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id uuid;
begin
  if not coalesce(app.pode_escrever(), false) and not app.pode_operar_deposito(p_deposito) then
    raise exception 'Sem permissão para enviar produtos.' using errcode = 'insufficient_privilege';
  end if;
  if not (app.pode_gerir() or app.pode_operar_deposito(p_deposito)
          or exists (select 1 from app.vendedora_depositos vd where vd.deposito_id = p_deposito and vd.vendedora_id = app.minha_vendedora())) then
    raise exception 'Você não trabalha nessa unidade.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_foto, '') = '' then raise exception 'Tire a foto do produto.'; end if;
  insert into app.produtos_pendentes (deposito_id, descricao, marca, quantidade, preco_normal, preco_vip, foto, foto_mime, observacao)
  values (p_deposito, trim(p_descricao), nullif(upper(trim(p_marca)), ''), p_quantidade, p_normal, p_vip, p_foto, p_mime, nullif(trim(p_obs), ''))
  returning id into v_id;
  return v_id;
end $$;

-- Gerente/dono atualiza: liga a um produto existente (p_produto) ou cria um novo.
-- Devolve o produto e se ele ainda não tinha foto (a aplicação copia a foto).
create or replace function app.aprovar_produto_pendente(p_id uuid, p_produto uuid, p_descricao text, p_marca text,
  p_quantidade numeric, p_normal numeric, p_vip numeric) returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare r app.produtos_pendentes; v_prod uuid; v_cod text; v_marca text; v_cde boolean; c record; v_sem_foto boolean;
begin
  if not coalesce(app.pode_gerir(), false) then
    raise exception 'Só gerente ou dono atualiza os produtos pendentes.' using errcode = 'insufficient_privilege';
  end if;
  select * into r from app.produtos_pendentes where id = p_id for update;
  if r.id is null then raise exception 'Pendente não encontrado.'; end if;
  if r.status <> 'pendente' then raise exception 'Este pendente já foi decidido.'; end if;
  if coalesce(p_quantidade, 0) <= 0 then raise exception 'Informe a quantidade.'; end if;
  if coalesce(p_normal, 0) <= 0 then raise exception 'Informe o preço normal.'; end if;

  if p_produto is not null then
    select id into v_prod from app.produtos where id = p_produto;
    if v_prod is null then raise exception 'Produto escolhido não encontrado.'; end if;
    update app.produtos set ativo = true where id = v_prod and not ativo;
  else
    select p.marca into v_marca from app.produtos p
     where p.marca is not null and app.nome_normal(p.marca) = app.nome_normal(coalesce(p_marca, r.marca)) limit 1;
    v_cod := 'VEND-' || upper(substr(replace(r.id::text, '-', ''), 1, 8));
    insert into app.produtos (codigo, nome, marca, ativo, codigo_provisorio, mostrar_no_site)
    values (v_cod, left(trim(coalesce(nullif(p_descricao, ''), r.descricao)), 200), coalesce(v_marca, nullif(upper(trim(coalesce(p_marca, r.marca))), '')), true, true, true)
    on conflict (codigo) do update set nome = excluded.nome
    returning id into v_prod;
  end if;
  select codigo into v_cod from app.produtos where id = v_prod;

  -- estoque na unidade da vendedora (kit entra pelos componentes)
  for c in select * from app.componentes(v_prod, p_quantidade) loop
    perform app._lancar(r.deposito_id, c.produto_id, 'entrada_compra', c.quantidade, 'pendente', r.id::text,
                        'Produto enviado pela vendedora: ' || r.descricao);
  end loop;

  -- preço na tabela da unidade
  v_cde := (select codigo from app.depositos where id = r.deposito_id) = 'loja-cde';
  perform app.importar_precos(jsonb_build_array(
    jsonb_build_object('codigo', v_cod, 'tabela', case when v_cde then 'cde_normal' else 'py_normal' end, 'valor', p_normal),
    jsonb_build_object('codigo', v_cod, 'tabela', case when v_cde then 'cde_vip' else 'py_vip' end, 'valor', coalesce(p_vip, p_normal))));

  select foto is null into v_sem_foto from app.produtos where id = v_prod;
  update app.produtos_pendentes set status = 'aprovado', produto_id = v_prod, decidido_por = app.uid(), decidido_em = now(),
         quantidade = p_quantidade, preco_normal = p_normal, preco_vip = coalesce(p_vip, p_normal)
   where id = r.id;
  return jsonb_build_object('produto_id', v_prod, 'codigo', v_cod, 'sem_foto', v_sem_foto);
end $$;

create or replace function app.recusar_produto_pendente(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then
    raise exception 'Só gerente ou dono decide os produtos pendentes.' using errcode = 'insufficient_privilege';
  end if;
  update app.produtos_pendentes set status = 'recusado', decidido_por = app.uid(), decidido_em = now(), motivo = nullif(trim(p_motivo), '')
   where id = p_id and status = 'pendente';
  if not found then raise exception 'Pendente não encontrado ou já decidido.'; end if;
end $$;

grant execute on function
  app.enviar_produto_pendente(uuid, text, text, numeric, numeric, numeric, text, text, text),
  app.aprovar_produto_pendente(uuid, uuid, text, text, numeric, numeric, numeric),
  app.recusar_produto_pendente(uuid, text)
to vc_app;
