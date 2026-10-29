-- =====================================================================
-- Migração 0137: dados para envio guardados na ficha do cliente
--
-- A vendedora registra uma vez (nome de quem recebe, identidade, telefone e direção) e fica salvo.
-- Ao marcar um pedido como envio, os dados vêm preenchidos e ela confirma (ou corrige: a ficha atualiza).
-- =====================================================================

alter table app.clientes
  add column if not exists envio_nome      text check (length(envio_nome) <= 120),
  add column if not exists envio_documento text check (length(envio_documento) <= 40),
  add column if not exists envio_telefone  text check (length(envio_telefone) <= 40),
  add column if not exists envio_endereco  text check (length(envio_endereco) <= 500),
  add column if not exists envio_atualizado_em  timestamptz,
  add column if not exists envio_atualizado_por uuid references app.usuarios(id);

create or replace function app.salvar_dados_envio(p_cliente uuid, p_nome text, p_documento text, p_telefone text, p_endereco text)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare v_cli app.clientes;
begin
  select * into v_cli from app.clientes where id = p_cliente;
  if v_cli.id is null then raise exception 'Cliente não encontrado.'; end if;
  if not (app.pode_escrever() and app.ve_pedido(v_cli.vendedora_id)) then
    raise exception 'Só a vendedora do cliente ou a gerência muda os dados de envio.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_nome), '') = '' or coalesce(trim(p_documento), '') = '' or coalesce(trim(p_telefone), '') = '' or coalesce(trim(p_endereco), '') = '' then
    raise exception 'Preencha nome, número de identidade, telefone e direção.';
  end if;
  perform set_config('app.motivo', 'Dados de envio do cliente', true);
  update app.clientes
     set envio_nome = left(trim(p_nome), 120), envio_documento = left(trim(p_documento), 40),
         envio_telefone = left(trim(p_telefone), 40), envio_endereco = left(trim(p_endereco), 500),
         envio_atualizado_em = now(), envio_atualizado_por = app.uid()
   where id = p_cliente;
end $$;
grant execute on function app.salvar_dados_envio(uuid, text, text, text, text) to vc_app;
