-- =====================================================================
-- Migração 0122: WhatsApp rápido
--
-- As regras de quem vê cada conversa eram conferidas mensagem por mensagem
-- (uma consulta por linha). Com dezenas de milhares de mensagens a tela
-- levava dezenas de segundos. Agora a lista de números que a pessoa pode
-- ver é calculada uma vez por consulta.
-- =====================================================================
create or replace function app.minhas_conexoes_whatsapp() returns uuid[]
language sql stable security definer set search_path = app, pg_temp as $$
  select case when app.e_gestao() then null
         else coalesce(array(
           select w.id from app.whatsapp_conexoes w
            where app.perfil_atual() = 'vendedora'
              and (w.vendedora_id = app.minha_vendedora()
                   or exists (select 1 from app.whatsapp_conexao_vendedoras x where x.conexao_id = w.id and x.vendedora_id = app.minha_vendedora()))),
           '{}') end
$$;
grant execute on function app.minhas_conexoes_whatsapp() to vc_app;

-- null = gestão (vê tudo); senão, só os números da lista
drop policy if exists ler on app.whatsapp_mensagens;
create policy ler on app.whatsapp_mensagens for select using (
  (select app.e_gestao()) or conexao_id in (select unnest(app.minhas_conexoes_whatsapp())));
drop policy if exists ler on app.whatsapp_contatos;
create policy ler on app.whatsapp_contatos for select using (
  (select app.e_gestao()) or conexao_id in (select unnest(app.minhas_conexoes_whatsapp())));
drop policy if exists ler on app.whatsapp_conexoes;
create policy ler on app.whatsapp_conexoes for select using (
  (select app.e_gestao()) or id in (select unnest(app.minhas_conexoes_whatsapp())));

-- índice para "mensagens do período" e para a resposta seguinte de cada conversa
create index if not exists whatsapp_mensagens_conversa_enviada on app.whatsapp_mensagens (conexao_id, contato, enviada, em);
analyze app.whatsapp_mensagens;
