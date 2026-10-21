-- =====================================================================
-- "Quero ser cliente" do site: aprovar CRIA o cliente (antes só marcava "atendido" e o cadastro sumia).
-- Se já existe cliente com o mesmo WhatsApp ou documento, liga ao que existe (não duplica).
-- Cadastros já marcados como atendidos sem cliente podem ser convertidos depois.
-- =====================================================================
alter table app.cadastros_site add column cliente_id uuid references app.clientes(id);
grant update (cliente_id) on app.cadastros_site to vc_app;

create or replace function app.aprovar_cadastro_site(p_cadastro uuid, p_vendedora uuid) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare s app.cadastros_site; v_cli uuid; v_vend uuid; v_doc text;
begin
  if not coalesce(app.pode_escrever(), false) then raise exception 'Sem permissão para aprovar cadastros.' using errcode = 'insufficient_privilege'; end if;
  select * into s from app.cadastros_site where id = p_cadastro for update;
  if s.id is null then raise exception 'Cadastro não encontrado.'; end if;
  if s.cliente_id is not null then return s.cliente_id; end if;
  v_vend := coalesce(p_vendedora, s.vendedora_id);
  if v_vend is null then raise exception 'Escolha a vendedora que vai atender este cliente.'; end if;
  v_doc := app.normalizar_documento(s.documento);
  -- já é cliente? (mesmo documento ou mesmo WhatsApp)
  select id into v_cli from app.clientes
   where mesclado_em is null and ((v_doc is not null and documento_login = v_doc)
                                  or regexp_replace(coalesce(whatsapp, ''), '\D', '', 'g') = s.whatsapp)
   order by (v_doc is not null and documento_login = v_doc) desc limit 1;
  if v_cli is null then
    insert into app.clientes (nome, whatsapp, cidade, pais, perfil_comercial, observacoes, vendedora_id, documento, email)
    values (s.nome, s.whatsapp, s.cidade, case when s.idioma = 'es' then 'PY'::app.pais else 'BR'::app.pais end,
            case s.tipo when 'salao' then 'Salão' when 'perfumaria' then 'Perfumaria' when 'revenda' then 'Revendedora'
                        when 'farmacia' then 'Farmácia' when 'loja' then 'Loja' else null end,
            nullif(concat_ws(' · ', case when s.contato is not null then 'Contato: ' || s.contato end,
                             case when s.mensagem is not null then 'Mensagem no cadastro do site: ' || s.mensagem end), ''),
            v_vend, s.documento, s.email)
    returning id into v_cli;
  end if;
  update app.cadastros_site set cliente_id = v_cli, vendedora_id = coalesce(vendedora_id, v_vend),
         atendido_em = coalesce(atendido_em, now()), atendido_por = coalesce(atendido_por, app.uid())
   where id = p_cadastro;
  return v_cli;
end $$;
revoke execute on function app.aprovar_cadastro_site(uuid, uuid) from public;
grant execute on function app.aprovar_cadastro_site(uuid, uuid) to vc_app;
