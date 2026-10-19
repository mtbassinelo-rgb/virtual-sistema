-- Gerar nova senha para o cliente também tira o bloqueio de 15 minutos por tentativas erradas.
create or replace function app.definir_acesso_cliente(p_cliente uuid, p_documento text, p_senha_hash text) returns text
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_vend uuid; v_login text := app.normalizar_documento(p_documento); v_outro text;
begin
  select vendedora_id into v_vend from app.clientes where id = p_cliente and mesclado_em is null;
  if v_vend is null or not app.pode_escrever() or not app.ve_pedido(v_vend) then
    raise exception 'Sem permissão para dar acesso a este cliente.' using errcode = 'insufficient_privilege';
  end if;
  if v_login is null or length(v_login) < 5 then raise exception 'Informe o CI, RUC, CPF ou CNPJ do cliente.'; end if;
  select nome into v_outro from app.clientes where documento_login = v_login and id <> p_cliente and mesclado_em is null;
  if v_outro is not null then raise exception 'Este documento já está no cadastro de outro cliente: %.', v_outro; end if;
  if coalesce(length(p_senha_hash), 0) < 20 then raise exception 'Senha inválida.'; end if;
  update app.clientes set documento = left(trim(p_documento), 30), portal_ativo = true where id = p_cliente;
  insert into app.portal_acessos (cliente_id, senha_hash, criado_por) values (p_cliente, p_senha_hash, app.uid())
  on conflict (cliente_id) do update set senha_hash = excluded.senha_hash, criado_por = excluded.criado_por, criado_em = now(), trocada_em = null;
  delete from app.portal_sessoes where cliente_id = p_cliente;
  -- senha nova libera o documento que estava travado por tentativas erradas
  delete from app.tentativas_login where email = 'cliente:' || v_login and not ok;
  return v_login;
end $$;
