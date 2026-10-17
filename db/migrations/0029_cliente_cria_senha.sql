-- Primeiro acesso do cliente: entra com a senha provisória de 6 números que a vendedora enviou
-- e, antes de continuar, cria a própria senha. Enquanto não criar, a senha é "provisória" (trocada_em vazio).
create or replace function app.portal_senha_provisoria(p_sessao_hash text) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select exists (select 1 from app.portal_acessos a
                  where a.cliente_id = app.portal_cliente_id(p_sessao_hash) and a.trocada_em is null)
$$;

-- Cria a senha definitiva (só enquanto a atual for a provisória; depois, a troca pede a senha atual).
create or replace function app.portal_criar_senha(p_sessao_hash text, p_senha_hash text) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_cli uuid := app.portal_cliente_id(p_sessao_hash);
begin
  if v_cli is null then raise exception 'Entre na área do cliente para criar a senha.'; end if;
  if not app.portal_senha_provisoria(p_sessao_hash) then raise exception 'A sua senha já foi criada. Para trocar, use Minha área.'; end if;
  if coalesce(length(p_senha_hash), 0) < 20 then raise exception 'Senha inválida.'; end if;
  update app.portal_acessos set senha_hash = p_senha_hash, trocada_em = now() where cliente_id = v_cli;
  delete from app.portal_sessoes where cliente_id = v_cli and token_hash <> p_sessao_hash;
end $$;

grant execute on function app.portal_senha_provisoria(text), app.portal_criar_senha(text, text) to vc_app;
