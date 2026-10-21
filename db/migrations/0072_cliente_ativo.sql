-- =====================================================================
-- Cliente ativo / inativo: só gerente ou dono muda.
-- Inativo some das listas do dia a dia (clientes, novo pedido, caixa, metas, recompra), mas continua no sistema:
-- o cadastro abre e pode ser editado, os pedidos e a importação continuam atualizando, e pode ser reativado a qualquer hora.
-- =====================================================================
alter table app.clientes
  add column ativo boolean not null default true,
  add column inativado_em timestamptz,
  add column inativado_por uuid references app.usuarios(id),
  add column motivo_inativo text check (length(motivo_inativo) <= 300);

create or replace function app.proteger_cliente_ativo() returns trigger
language plpgsql set search_path = app, pg_temp as $$
begin
  if new.ativo is distinct from old.ativo and not coalesce(app.pode_gerir(), false) then
    raise exception 'Só gerente ou dono ativa ou desativa cliente.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger proteger_cliente_ativo before update of ativo on app.clientes
  for each row execute function app.proteger_cliente_ativo();

create or replace function app.ativar_cliente(p_cliente uuid, p_ativo boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono ativa ou desativa cliente.' using errcode = 'insufficient_privilege'; end if;
  update app.clientes set ativo = coalesce(p_ativo, true),
         inativado_em = case when p_ativo then null else now() end,
         inativado_por = case when p_ativo then null else app.uid() end,
         motivo_inativo = case when p_ativo then null else nullif(trim(coalesce(p_motivo, '')), '') end
   where id = p_cliente and mesclado_em is null;
  if not found then raise exception 'Cliente não encontrado.'; end if;
end $$;
revoke execute on function app.ativar_cliente(uuid, boolean, text) from public;
grant execute on function app.ativar_cliente(uuid, boolean, text) to vc_app;
