-- =====================================================================
-- Migração 0131: vendedora edita o preço até o VIP e dá desconto no pedido
--
-- Antes: a vendedora só podia cobrar a tabela ou mais. Agora pode baixar o preço de cada produto até o preço VIP
-- (py_vip em Gs, br_vip em R$) e dar um desconto em valor no pedido inteiro, que sai da folga acima do VIP.
-- Abaixo do VIP continua só para gerente, dono ou quem tem a liberação "vender abaixo da tabela".
-- =====================================================================

-- Menor preço que a vendedora pode cobrar: o VIP do produto na moeda (ou a tabela, se for menor: promoção)
create or replace function app.preco_piso_vendedora(p_prod uuid, p_moeda app.moeda, p_tabela numeric) returns numeric
language sql stable security definer set search_path = app, pg_temp as $$
  select least(coalesce(p_tabela, v.valor), coalesce(v.valor, p_tabela))
    from (select (select z.valor from app.precos z where z.produto_id = p_prod
                     and z.tabela::text = case when p_moeda = 'GS' then 'py_vip' else 'br_vip' end
                     and z.vigente_desde <= current_date order by z.vigente_desde desc limit 1) as valor) v
$$;
grant execute on function app.preco_piso_vendedora(uuid, app.moeda, numeric) to vc_app;

drop function if exists app.criar_pedido_vendedora(uuid, app.moeda, uuid, date, text, jsonb, boolean);
create or replace function app.criar_pedido_vendedora(p_cliente uuid, p_moeda app.moeda, p_deposito uuid, p_previsao date,
    p_obs text, p_itens jsonb, p_para_cliente boolean default false, p_desconto numeric default null)
returns uuid language plpgsql set search_path = app, pg_temp as $$
declare
  v_cli app.clientes; v_ped uuid; v_dep app.depositos; it jsonb; v_qtd numeric; v_prod app.produtos; f record;
  v_disp numeric; v_total numeric := 0; n int := 0; v_moeda app.moeda; v_preco numeric; v_piso numeric;
  v_margem numeric; v_fator numeric; v_baixa boolean := app.pode_baixar_preco(); r record;
  v_exige boolean := coalesce(app.param('pedido_exige_estoque'), 0) = 1;
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
    if v_exige then
      v_disp := app.saldo_disponivel(v_dep.id, v_prod.id)
              + case when v_dep.abastecido_por is null then 0 else app.saldo_disponivel(v_dep.abastecido_por, v_prod.id) end
              - coalesce((select sum(quantidade) from app.pedido_itens where pedido_id = v_ped and produto_id = v_prod.id), 0);
      if v_qtd > v_disp then
        raise exception 'Estoque insuficiente de % (%): disponível %.', v_prod.nome, v_dep.nome, greatest(v_disp, 0);
      end if;
    end if;
    insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco)
    values (v_ped, v_prod.id, v_prod.codigo,
            v_prod.nome || case when f.promocao_id is not null and v_preco = f.preco then ' (promoção -' || f.desconto_pct::int || '%)' else '' end,
            v_qtd, v_preco, f.tabela);
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
