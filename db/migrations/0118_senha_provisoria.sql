-- =====================================================================
-- Migração 0118: senha provisória definida pelo gerente/dono
--
-- Além do link de primeiro acesso, o gerente (ou dono) pode definir uma senha
-- para a pessoa entrar na hora. Depois ela troca em Minha conta, se quiser.
-- Gerente não define senha de dono. A senha nunca vai para a auditoria.
-- =====================================================================
create or replace function app.definir_senha_pessoa(p_usuario uuid, p_senha_hash text) returns text
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_email text;
begin
  perform app._pode_gerir(p_usuario, null);
  if coalesce(length(p_senha_hash), 0) < 20 then raise exception 'Senha inválida.'; end if;
  update app.usuarios set senha_hash = p_senha_hash where id = p_usuario and ativo returning email into v_email;
  if v_email is null then raise exception 'Pessoa não encontrada ou inativa.'; end if;
  delete from app.sessoes where usuario_id = p_usuario;                                   -- sai de onde estiver logada
  update app.usuario_convites set usado_em = now() where usuario_id = p_usuario and usado_em is null;  -- links antigos deixam de valer
  return v_email;
end $$;
grant execute on function app.definir_senha_pessoa(uuid, text) to vc_app;
