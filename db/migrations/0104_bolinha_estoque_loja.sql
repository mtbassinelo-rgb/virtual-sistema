-- =====================================================================
-- Migração 0104: bolinha de disponibilidade para o cliente na loja online
--   verde    = tem na unidade do cliente (retira na hora)
--   azul     = não tem na unidade dele, mas tem na outra sede (pode solicitar)
--   vermelho = não tem em nenhuma sede
-- Vale para clientes da loja de CDE e do CD Foz. Não mostra quantidade e não bloqueia o pedido.
-- =====================================================================
create or replace function app.portal_situacao_estoque(p_sessao_hash text)
returns table (produto_id uuid, situacao text)
language sql stable security definer set search_path = app, pg_temp as $$
  with dep as (select app.deposito_do_cliente(app.portal_cliente_id(p_sessao_hash)) as id),
       outros as (select d.id from app.depositos d where d.ativo and d.id is distinct from (select id from dep))
  select pr.id,
         case when app.saldo_disponivel((select id from dep), pr.id) > 0 then 'retirar'
              when exists (select 1 from outros o where app.saldo_disponivel(o.id, pr.id) > 0) then 'solicitar'
              else 'indisponivel' end
    from app.produtos pr
   where pr.ativo and (select id from dep) is not null
$$;
grant execute on function app.portal_situacao_estoque(text) to vc_app;
