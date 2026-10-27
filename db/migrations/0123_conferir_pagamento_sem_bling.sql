-- Gerente confirma o pagamento sem precisar do nº do Bling (pedidos do sistema/atacado no Paraguai nem sempre têm).
-- Se o nº for informado, continua ligando/conferindo como antes.
create or replace function app.conferir_pagamento(p_pagamento uuid, p_bling_numero bigint)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare v_pag app.pagamentos; v_ped app.pedidos;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono confere pagamentos.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_pag from app.pagamentos where id = p_pagamento for update;
  if not found then raise exception 'Pagamento não encontrado.'; end if;
  if v_pag.status_conferencia <> 'pendente' then raise exception 'Este pagamento já foi conferido ou recusado.'; end if;
  select * into v_ped from app.pedidos where id = v_pag.pedido_id for update;
  if v_ped.status_comercial = 'cancelado' then raise exception 'Pedido cancelado: não é possível conferir pagamento.'; end if;
  if p_bling_numero is not null then
    if v_ped.bling_numero is null then
      if exists (select 1 from app.pedidos where bling_numero = p_bling_numero) then
        raise exception 'O pedido % do Bling já está ligado a outro pedido do sistema.', p_bling_numero;
      end if;
      update app.pedidos set bling_numero = p_bling_numero,
             bling_id = coalesce(bling_id, (select bling_id from app.bling_pedidos where numero = p_bling_numero))
       where id = v_ped.id;
    elsif v_ped.bling_numero <> p_bling_numero then
      raise exception 'Número do Bling não confere: este pedido é o % no Bling.', v_ped.bling_numero;
    end if;
  end if;
  update app.pagamentos
     set status_conferencia = 'conferido', conferido_por = app.uid(), conferido_em = now(),
         conferencia_bling_numero = coalesce(p_bling_numero, v_ped.bling_numero)
   where id = p_pagamento;
end $$;
