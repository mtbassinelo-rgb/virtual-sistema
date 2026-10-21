-- Compra por unidade (sortido) no site: a vendedora pede, o gerente ou o dono aprova.
-- Vale para clientes de preço NORMAL do Brasil (R$) e do Paraguai (Gs). Cliente VIP compra sempre caixa fechada.

alter table app.clientes
  add column if not exists compra_unidade_sugerido_por uuid references app.usuarios(id),
  add column if not exists compra_unidade_sugerido_em timestamptz;

-- Só a gestão libera; cliente que vira VIP perde a liberação (e o pedido pendente) na hora.
create or replace function app.proteger_compra_unidade() returns trigger
language plpgsql set search_path = app, pg_temp as $$
begin
  if new.categoria_preco = 'vip' then
    new.compra_unidade := false; new.compra_unidade_sugerido_por := null; new.compra_unidade_sugerido_em := null;
    return new;
  end if;
  if new.compra_unidade and not old.compra_unidade and not coalesce(app.pode_gerir(), false) then
    raise exception 'Só gerente ou dono libera a compra por unidade.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
drop trigger if exists proteger_compra_unidade on app.clientes;
create trigger proteger_compra_unidade before update on app.clientes
  for each row execute function app.proteger_compra_unidade();

-- Vendedora pede a liberação (só clientes dela); a gestão libera direto.
create or replace function app.sugerir_compra_unidade(p_cliente uuid) returns text
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_vend uuid; v_cat text; v_lib boolean;
begin
  select vendedora_id, categoria_preco::text, compra_unidade into v_vend, v_cat, v_lib
    from app.clientes where id = p_cliente and mesclado_em is null;
  if v_vend is null or not coalesce(app.pode_escrever(), false) or not coalesce(app.ve_pedido(v_vend), false) then
    raise exception 'Sem permissão para este cliente.' using errcode = 'insufficient_privilege';
  end if;
  if v_cat = 'vip' then raise exception 'Cliente VIP compra só caixa fechada.'; end if;
  if v_lib then return 'ja_liberado'; end if;
  if coalesce(app.pode_gerir(), false) then
    update app.clientes set compra_unidade = true, compra_unidade_sugerido_por = null, compra_unidade_sugerido_em = null where id = p_cliente;
    return 'liberado';
  end if;
  update app.clientes set compra_unidade_sugerido_por = app.uid(), compra_unidade_sugerido_em = now() where id = p_cliente;
  return 'sugerido';
end $$;

-- Gestão aprova, recusa o pedido da vendedora, ou volta o cliente para só caixa.
create or replace function app.decidir_compra_unidade(p_cliente uuid, p_liberar boolean) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_cat text;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono libera a compra por unidade.'; end if;
  select categoria_preco::text into v_cat from app.clientes where id = p_cliente and mesclado_em is null;
  if not found then raise exception 'Cliente não encontrado.'; end if;
  if p_liberar and v_cat = 'vip' then raise exception 'Cliente VIP compra só caixa fechada.'; end if;
  update app.clientes set compra_unidade = coalesce(p_liberar, false), compra_unidade_sugerido_por = null, compra_unidade_sugerido_em = null
   where id = p_cliente;
end $$;

revoke execute on function app.sugerir_compra_unidade(uuid), app.decidir_compra_unidade(uuid, boolean) from public;
grant execute on function app.sugerir_compra_unidade(uuid), app.decidir_compra_unidade(uuid, boolean) to vc_app;

-- No site: a unidade que vende por unidade (loja CDE) ou o cliente normal liberado pela gestão, Brasil ou Paraguai.
create or replace function app.portal_compra_unidade(p_sessao_hash text) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce((select coalesce(d.vende_unidade, false) or (c.compra_unidade and c.categoria_preco = 'normal')
                     from app.clientes c left join app.depositos d on d.id = app.deposito_do_cliente(c.id)
                    where c.id = app.portal_cliente_id(p_sessao_hash)), false)
$$;

update app.clientes set compra_unidade = false where compra_unidade and categoria_preco = 'vip';
