-- =====================================================================
-- Migração 0142: vender o estoque de outra unidade (ex.: vendedora do CD principal vende o que está na Loja CDE)
--
-- No Novo pedido, cada produto pode "sair de" outra unidade. O sistema confere o estoque de lá e cria sozinho o
-- pedido entre unidades (solicitação) ligado ao pedido: a loja CDE separa e envia (um passo), o CD recebe e o
-- produto entra no estoque do CD, de onde sai na venda como sempre. Pedido cancelado → a solicitação é cancelada.
-- =====================================================================

create or replace function app.criar_pedido_vendedora(p_cliente uuid, p_moeda app.moeda, p_deposito uuid, p_previsao date,
    p_obs text, p_itens jsonb, p_para_cliente boolean default false, p_desconto numeric default null)
returns uuid language plpgsql set search_path = app, pg_temp as $$
declare
  v_cli app.clientes; v_ped uuid; v_dep app.depositos; it jsonb; v_qtd numeric; v_prod app.produtos; f record;
  v_disp numeric; v_total numeric := 0; n int := 0; v_moeda app.moeda; v_preco numeric; v_piso numeric;
  v_margem numeric; v_fator numeric; v_baixa boolean := app.pode_baixar_preco(); r record;
  v_exige boolean := coalesce(app.param('pedido_exige_estoque'), 0) = 1; v_orig app.depositos;
begin
  if not app.pode_escrever() then raise exception 'Sem permissão.' using errcode = 'insufficient_privilege'; end if;
  select * into v_cli from app.clientes where id = p_cliente and mesclado_em is null;
  if v_cli.id is null then raise exception 'Cliente não encontrado.'; end if;
  v_moeda := coalesce(p_moeda, v_cli.moeda);
  insert into app.pedidos (origem, canal, cliente_id, vendedora_id, data_pedido, moeda, valor_total, status_comercial,
                           previsao_envio, deposito_id, observacoes, criado_por)
  values ('manual', 'direto', v_cli.id, v_cli.vendedora_id, current_date, v_moeda, 0,
          case when p_para_cliente then 'aguardando_cliente'::app.status_comercial else 'em_separacao'::app.status_comercial end,
          p_previsao, p_deposito, nullif(left(trim(coalesce(p_obs, '')), 1000), ''), app.uid())
  returning id into v_ped;
  select d.* into v_dep from app.depositos d join app.pedidos p on p.deposito_id = d.id where p.id = v_ped;
  if v_exige and v_dep.id is null then
    raise exception 'Escolha o depósito do pedido para conferir o estoque.';
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    select * into v_prod from app.produtos where id = nullif(it->>'produto_id', '')::uuid and ativo;
    continue when v_prod.id is null and coalesce(it->>'produto_id', '') = '';
    if v_prod.id is null then raise exception 'Produto não encontrado ou inativo.'; end if;
    v_qtd := coalesce(nullif(it->>'quantidade', '')::numeric,
                      nullif(it->>'caixas', '')::numeric * coalesce(v_prod.unidades_caixa, 1));
    continue when v_qtd is null or v_qtd <= 0;
    select * into f from app.preco_final_moeda(v_cli.id, v_prod.id, v_moeda);
    if f.preco is null then
      raise exception 'O produto % não tem preço em % na tabela deste cliente.', v_prod.codigo,
        case when v_moeda = 'GS' then 'Gs' else 'R$' end;
    end if;
    -- Preço informado: a vendedora pode baixar até o preço VIP do produto (nunca menos). Gerente, dono e quem tem
    -- a liberação "vender abaixo da tabela" podem qualquer valor.
    v_piso := app.preco_piso_vendedora(v_prod.id, v_moeda, f.preco);
    v_preco := nullif(it->>'preco', '')::numeric;
    if v_preco is not null and v_preco <= 0 then raise exception 'Preço de % inválido.', v_prod.nome; end if;
    if v_preco is not null and v_preco < v_piso and not v_baixa then
      raise exception 'O preço de % não pode ficar abaixo do VIP (%). Para baixar mais, fale com o gerente.', v_prod.nome,
        case when v_moeda = 'GS' then 'Gs ' || to_char(v_piso, 'FM999G999G999') else 'R$ ' || to_char(v_piso, 'FM999G990D00') end;
    end if;
    v_preco := coalesce(v_preco, f.preco);
    if f.limite_qtd is not null and v_qtd > f.limite_qtd then
      raise exception 'Promoção de % limitada a % unidades por pedido.', v_prod.nome, f.limite_qtd;
    end if;
    -- Sai de outra unidade (ex.: cliente do CD principal compra o que está na Loja CDE): confere o estoque de lá
    v_orig := null;
    if nullif(it->>'origem', '') is not null and (v_dep.id is null or (it->>'origem')::uuid <> v_dep.id) then
      select * into v_orig from app.depositos where id = (it->>'origem')::uuid and ativo;
      if v_orig.id is null then raise exception 'Unidade de origem não encontrada.'; end if;
      if v_dep.id is null then raise exception 'Escolha o depósito do pedido para trazer produto de outra unidade.'; end if;
      v_disp := app.saldo_disponivel(v_orig.id, v_prod.id)
              - coalesce((select sum(quantidade) from app.pedido_itens where pedido_id = v_ped and produto_id = v_prod.id and deposito_origem_id = v_orig.id), 0);
      if v_qtd > v_disp then
        raise exception 'Estoque insuficiente de % em % : disponível %.', v_prod.nome, v_orig.nome, greatest(v_disp, 0);
      end if;
    elsif v_exige then
      v_disp := app.saldo_disponivel(v_dep.id, v_prod.id)
              + case when v_dep.abastecido_por is null then 0 else app.saldo_disponivel(v_dep.abastecido_por, v_prod.id) end
              - coalesce((select sum(quantidade) from app.pedido_itens where pedido_id = v_ped and produto_id = v_prod.id), 0);
      if v_qtd > v_disp then
        raise exception 'Estoque insuficiente de % (%): disponível %.', v_prod.nome, v_dep.nome, greatest(v_disp, 0);
      end if;
    end if;
    insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
    values (v_ped, v_prod.id, v_prod.codigo,
            v_prod.nome || case when f.promocao_id is not null and v_preco = f.preco then ' (promoção -' || f.desconto_pct::int || '%)' else '' end
                        || case when v_orig.id is not null then ' · vem da ' || v_orig.nome else '' end,
            v_qtd, v_preco, f.tabela, v_orig.id);
    v_total := v_total + round(v_qtd * v_preco, 2);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Inclua pelo menos um produto com quantidade.'; end if;

  -- Desconto no pedido (valor): sai do que cada item tem acima do preço VIP, proporcional a essa folga.
  -- Sem liberação, o desconto máximo é a soma dessas folgas (nenhum item fica abaixo do VIP).
  if coalesce(p_desconto, 0) > 0 then
    if p_desconto >= v_total then raise exception 'O desconto não pode ser maior ou igual ao total do pedido.'; end if;
    select coalesce(sum(i.quantidade * greatest(i.preco_unitario - app.preco_piso_vendedora(i.produto_id, v_moeda,
             (select ff.preco from app.preco_final_moeda(v_cli.id, i.produto_id, v_moeda) ff)), 0)), 0)
      into v_margem from app.pedido_itens i where i.pedido_id = v_ped;
    if v_baixa and p_desconto > v_margem then
      -- liberado: o que passar da folga sai de todos os itens, proporcional ao valor
      v_fator := 1 - p_desconto / v_total;
      update app.pedido_itens set preco_unitario = round(preco_unitario * v_fator, case when v_moeda = 'GS' then 0 else 2 end)
       where pedido_id = v_ped;
    else
      if p_desconto > v_margem then
        raise exception 'Desconto acima do permitido: o máximo sem passar do preço VIP é %. Para dar mais, fale com o gerente.',
          case when v_moeda = 'GS' then 'Gs ' || to_char(v_margem, 'FM999G999G999') else 'R$ ' || to_char(v_margem, 'FM999G990D00') end;
      end if;
      for r in select i.id, i.quantidade, i.preco_unitario,
                      app.preco_piso_vendedora(i.produto_id, v_moeda, (select ff.preco from app.preco_final_moeda(v_cli.id, i.produto_id, v_moeda) ff)) piso
                 from app.pedido_itens i where i.pedido_id = v_ped loop
        if r.preco_unitario > r.piso then
          update app.pedido_itens
             set preco_unitario = greatest(r.piso, round(r.preco_unitario - (r.preco_unitario - r.piso) * p_desconto / v_margem,
                                                         case when v_moeda = 'GS' then 0 else 2 end))
           where id = r.id;
        end if;
      end loop;
    end if;
    select coalesce(sum(round(quantidade * preco_unitario, 2)), 0) into v_total from app.pedido_itens where pedido_id = v_ped;
    update app.pedidos set observacoes = concat_ws(' | ', observacoes, 'Desconto aplicado: ' ||
             case when v_moeda = 'GS' then 'Gs ' || to_char(p_desconto, 'FM999G999G999') else 'R$ ' || to_char(p_desconto, 'FM999G990D00') end)
     where id = v_ped;
  end if;
  update app.pedidos set valor_total = v_total where id = v_ped;
  return v_ped;
end $$;
grant execute on function app.criar_pedido_vendedora(uuid, app.moeda, uuid, date, text, jsonb, boolean, numeric) to vc_app;

-- Cria (ou acerta) a solicitação para a unidade de origem com o que o pedido precisa de lá
create or replace function app._solicitar_do_pedido(p_pedido uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_ped app.pedidos; o record; it record; v_t app.transferencias;
begin
  select * into v_ped from app.pedidos where id = p_pedido;
  if v_ped.id is null or v_ped.deposito_id is null or v_ped.status_comercial::text <> 'em_separacao' then return; end if;
  for o in select distinct i.deposito_origem_id as origem from app.pedido_itens i
            where i.pedido_id = p_pedido and i.deposito_origem_id is not null and i.deposito_origem_id <> v_ped.deposito_id loop
    select * into v_t from app.transferencias t
     where t.pedido_id = p_pedido and t.origem_id = o.origem and t.status <> 'cancelada' order by t.criada_em desc limit 1;
    if v_t.id is not null and v_t.status <> 'solicitada' then continue; end if;   -- já separada/enviada: não mexe
    if v_t.id is null then
      insert into app.transferencias (origem_id, destino_id, status, observacao, criada_por, pedido_id)
      values (o.origem, v_ped.deposito_id, 'solicitada',
              'Para o pedido de ' || coalesce((select nome from app.clientes where id = v_ped.cliente_id), 'cliente')
                || ' (' || coalesce((select nome from app.vendedoras where id = v_ped.vendedora_id), '') || ')',
              coalesce(app.uid(), v_ped.criado_por), p_pedido)
      returning * into v_t;
    end if;
    delete from app.transferencia_itens where transferencia_id = v_t.id;
    for it in select c.produto_id, sum(c.quantidade) q
                from app.pedido_itens i cross join lateral app.componentes(i.produto_id, i.quantidade) c
               where i.pedido_id = p_pedido and i.deposito_origem_id = o.origem group by 1 loop
      insert into app.transferencia_itens (transferencia_id, produto_id, quantidade_solicitada, quantidade_enviada)
      values (v_t.id, it.produto_id, it.q, it.q);
    end loop;
  end loop;
end $$;
revoke execute on function app._solicitar_do_pedido(uuid) from public;

create or replace function app._tg_itens_outra_unidade() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare r record;
begin
  for r in select distinct n.pedido_id from novos n where n.deposito_origem_id is not null loop
    perform app._solicitar_do_pedido(r.pedido_id);
  end loop;
  return null;
end $$;
drop trigger if exists itens_outra_unidade on app.pedido_itens;
create trigger itens_outra_unidade after insert on app.pedido_itens
  referencing new table as novos for each statement execute function app._tg_itens_outra_unidade();

-- Pedido do cliente confirmado depois (link) → cria a solicitação; pedido cancelado → cancela a que ainda não saiu
create or replace function app._tg_pedido_outra_unidade() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if new.status_comercial::text = 'em_separacao' and old.status_comercial::text in ('aguardando_cliente', 'aguardando_aprovacao') and new.origem <> 'portal' then
    perform app._solicitar_do_pedido(new.id);
  elsif new.status_comercial::text = 'cancelado' and old.status_comercial::text <> 'cancelado' then
    update app.transferencias set status = 'cancelada', cancelada_em = now(), cancelada_por = app.uid(),
           motivo_cancelamento = 'Pedido do cliente cancelado'
     where pedido_id = new.id and status in ('solicitada', 'separada', 'rascunho');
  end if;
  return null;
end $$;
drop trigger if exists pedido_outra_unidade on app.pedidos;
create trigger pedido_outra_unidade after update of status_comercial on app.pedidos
  for each row execute function app._tg_pedido_outra_unidade();

-- Estoque de um produto em cada unidade (para a vendedora escolher de onde sai)
create or replace function app.estoque_por_unidade(p_produto uuid)
returns table (deposito_id uuid, nome text, saldo numeric)
language sql stable security definer set search_path = app, pg_temp as $$
  select d.id, d.nome, app.saldo_disponivel(d.id, p_produto) from app.depositos d where d.ativo and app.uid() is not null order by d.tipo, d.nome
$$;
grant execute on function app.estoque_por_unidade(uuid) to vc_app;
