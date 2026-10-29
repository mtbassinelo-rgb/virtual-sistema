-- =====================================================================
-- Migração 0135: "Chegando na CDE" — a loja CDE vê o que saiu do CD com o passeiro
--
-- Substitui o PDF: a encarregada da CDE (Yessica) vê, com os itens e as caixas,
--  * os envios para outras cidades do Paraguai (despacha pela transportadora e confirma) e
--  * os pedidos para o cliente retirar na CDE (entrega e dá o ✓ "cliente retirou").
-- =====================================================================

create or replace function app.cde_chegando()
returns table (id uuid, tipo text, cliente text, cidade text, telefone text, vendedora text, meio text, dados text, volumes int,
               despachado_em timestamptz, saldo numeric, moeda text, itens jsonb)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.pode_confirmar_envio_py() then return; end if;
  return query
  select p.id, case when p.entrega_tipo = 'envio' then 'envio' else 'retira' end, cl.nome, cl.cidade, coalesce(cl.whatsapp, cl.telefone), v.nome,
         p.entrega_meio, p.entrega_dados, coalesce(p.volumes, p.caixas_separadas), coalesce(p.despachado_em, p.chegou_em),
         vp.saldo, p.moeda::text,
         (select coalesce(jsonb_agg(jsonb_build_object('q', i.quantidade, 'd', i.descricao, 'c', i.codigo) order by i.descricao), '[]')
            from app.pedido_itens i where i.pedido_id = p.id)
    from app.pedidos p join app.v_pedidos vp on vp.id = p.id
    join app.clientes cl on cl.id = p.cliente_id join app.vendedoras v on v.id = p.vendedora_id
   where app.envio_py_pendente(p)
      or (p.entrega_tipo = 'retira' and p.status_comercial::text = 'aguardando_retirada' and coalesce(p.local_retirada, p.entrega_meio) ilike '%CDE%')
   order by 2, coalesce(p.despachado_em, p.chegou_em);
end $$;
grant execute on function app.cde_chegando() to vc_app;

-- A loja CDE entrega o pedido de retirada ao cliente
create or replace function app.cde_cliente_retirou(p_pedido uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos;
begin
  if not app.pode_confirmar_envio_py() then
    raise exception 'Só a loja CDE ou a gerência entrega os pedidos de retirada.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_ped from app.pedidos where id = p_pedido for update;
  if v_ped.id is null or v_ped.status_comercial::text <> 'aguardando_retirada' or coalesce(v_ped.local_retirada, v_ped.entrega_meio) not ilike '%CDE%' then
    raise exception 'Este pedido não está aguardando retirada na CDE.';
  end if;
  perform set_config('app.motivo', 'Cliente retirou na loja CDE', true);
  update app.pedidos set status_comercial = 'entregue', entregue_em = current_date where id = p_pedido;
end $$;
grant execute on function app.cde_cliente_retirou(uuid) to vc_app;
