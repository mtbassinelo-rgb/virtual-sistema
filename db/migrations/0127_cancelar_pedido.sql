-- =====================================================================
-- Migração 0127: botão "Cancelar pedido"
--
-- Vendedora (a dona do pedido) cancela antes do pedido sair: aguardando ou em
-- separação (antes ou depois da expedição conferir). Motivo obrigatório.
-- Se o pedido tem pagamento registrado, só o gerente cancela.
-- Gerente/dono também cancelam pedido já enviado, aguardando retirada ou entregue
-- (a mercadoria volta ao estoque como devolução, pela regra que já existe).
--
-- Liga/desliga para as vendedoras em Parâmetros: vendedora_cancela_pedido
-- (1 = liberado, 0 = só gerente). Pedidos do Bling e de marketplace não
-- cancelam por aqui.
-- =====================================================================

insert into app.parametros (chave, valor, descricao) values
  ('vendedora_cancela_pedido', 1,
   'Vendedoras podem cancelar os próprios pedidos antes de saírem, com motivo (1 = sim, 0 = só gerente)')
on conflict (chave) do nothing;

create or replace function app.cancelar_pedido(p_pedido uuid, p_motivo text) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; v_gestao boolean := coalesce(app.pode_gerir(), false); v_mot text := left(trim(coalesce(p_motivo, '')), 300);
begin
  select * into v_ped from app.pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if not (v_gestao or (app.perfil_atual() = 'vendedora' and v_ped.vendedora_id = app.minha_vendedora())) then
    raise exception 'Só a vendedora do pedido ou a gerência cancela o pedido.' using errcode = 'insufficient_privilege';
  end if;
  if not v_gestao and coalesce(app.param('vendedora_cancela_pedido'), 0) <> 1 then
    raise exception 'Cancelar pedido está liberado só para o gerente. Peça a ele.' using errcode = 'insufficient_privilege';
  end if;
  if v_mot = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  if v_ped.origem = 'bling' then raise exception 'Pedido do Bling: cancele no Bling.'; end if;
  if v_ped.origem = 'planilha' and v_ped.numero_externo is not null then raise exception 'Pedido de marketplace: cancele em Vendas Shopee / Mercado Livre.'; end if;

  if v_ped.status_comercial::text = 'cancelado' then raise exception 'Este pedido já está cancelado.'; end if;
  if not v_gestao and v_ped.status_comercial::text not in ('aguardando_cliente', 'aguardando_aprovacao', 'em_separacao') then
    raise exception 'O pedido já saiu: só o gerente cancela agora (a mercadoria volta ao estoque).';
  end if;
  if not v_gestao and exists (select 1 from app.pagamentos where pedido_id = p_pedido and status_conferencia::text <> 'recusado') then
    raise exception 'Este pedido tem pagamento registrado: peça ao gerente para cancelar (e combinar a devolução).';
  end if;

  perform set_config('app.motivo', 'Pedido cancelado: ' || v_mot, true);
  update app.pedidos
     set status_comercial = 'cancelado',
         observacoes = concat_ws(' | ', nullif(observacoes, ''), 'Cancelado: ' || v_mot)
   where id = p_pedido;

  -- transferência preparada para este pedido e ainda não enviada: cancela junto
  update app.transferencias set status = 'cancelada', cancelada_por = app.uid(), cancelada_em = now(),
         motivo_cancelamento = left('Pedido cancelado: ' || v_mot, 300)
   where pedido_id = p_pedido and status in ('rascunho', 'solicitada', 'separada');

  -- pedidos de remoção que ficaram esperando o gerente: encerrados
  update app.pedido_remocoes set status = 'recusada', decidido_por = app.uid(), decidido_em = now(), motivo_decisao = 'Pedido cancelado'
   where pedido_id = p_pedido and status = 'pendente';
end $$;
grant execute on function app.cancelar_pedido(uuid, text) to vc_app;
