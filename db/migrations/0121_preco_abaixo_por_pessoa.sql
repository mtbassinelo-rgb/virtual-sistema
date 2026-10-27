-- =====================================================================
-- Migração 0121: liberar "vender abaixo da tabela" por pessoa
--
-- Regra continua: vendedora só muda preço para mais. O gerente pode liberar
-- uma pessoa específica para baixar preço (Equipe → Acessos: "Pode vender
-- abaixo da tabela"). Liberado agora para a Yessica, a pedido do dono.
-- =====================================================================
create or replace function app.pode_baixar_preco() returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce(app.pode_gerir(), false)
      or coalesce((select (permissoes->>'preco_abaixo')::boolean from app.usuarios where id = app.uid() and ativo), false)
$$;
grant execute on function app.pode_baixar_preco() to vc_app;

create or replace function app.criar_pedido_vendedora(p_cliente uuid, p_moeda app.moeda, p_deposito uuid, p_previsao date,
    p_obs text, p_itens jsonb, p_para_cliente boolean default false)
returns uuid language plpgsql set search_path = app, pg_temp as $$
declare
  v_cli app.clientes; v_ped uuid; v_dep app.depositos; it jsonb; v_qtd numeric; v_prod app.produtos; f record;
  v_disp numeric; v_total numeric := 0; n int := 0; v_moeda app.moeda; v_preco numeric;
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
    -- Preço informado: a vendedora pode cobrar mais que a tabela, nunca menos. Gerente e dono podem qualquer valor.
    v_preco := nullif(it->>'preco', '')::numeric;
    if v_preco is not null and v_preco <= 0 then raise exception 'Preço de % inválido.', v_prod.nome; end if;
    if v_preco is not null and v_preco < f.preco and not app.pode_baixar_preco() then
      raise exception 'O preço de % não pode ficar abaixo da tabela (%). Para dar desconto, fale com o gerente.', v_prod.nome,
        case when v_moeda = 'GS' then 'Gs ' || to_char(f.preco, 'FM999G999G999') else 'R$ ' || to_char(f.preco, 'FM999G990D00') end;
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
  update app.pedidos set valor_total = v_total where id = v_ped;
  return v_ped;
end $$;

create or replace function app.venda_balcao(p_caixa uuid, p_cliente uuid, p_moeda app.moeda, p_itens jsonb, p_pagamentos jsonb, p_obs text default null)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare
  c app.caixas; v_ped app.pedidos; v_vend uuid; it jsonb; v_prod app.produtos; v_qtd numeric; v_preco numeric; v_tabela_preco numeric; v_tab text;
  v_total numeric := 0; v_pago numeric; n int := 0;
begin
  c := app._caixa_aberto(p_caixa);
  -- vendedora do pedido: quem está no caixa (se for vendedora), senão a do cliente, senão a padrão da unidade
  select vendedora_id into v_vend from app.usuarios where id = app.uid();
  if v_vend is null and p_cliente is not null then select vendedora_id into v_vend from app.clientes where id = p_cliente; end if;
  if v_vend is null then
    select vd.vendedora_id into v_vend from app.vendedora_depositos vd where vd.deposito_id = c.deposito_id order by vd.padrao desc limit 1;
  end if;
  if v_vend is null then raise exception 'Nenhuma vendedora ligada a esta unidade. Defina em Equipe → Unidades de cada vendedora.'; end if;

  insert into app.pedidos (origem, canal, cliente_id, vendedora_id, data_pedido, moeda, valor_total, status_comercial, deposito_id, observacoes, criado_por)
  values ('manual', 'balcao', p_cliente, v_vend, current_date, p_moeda, 0, 'em_separacao', c.deposito_id,
          nullif(left(trim(coalesce(p_obs, '')), 1000), ''), app.uid())
  returning * into v_ped;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    v_qtd := (it->>'quantidade')::numeric;
    continue when v_qtd is null or v_qtd <= 0;
    select * into v_prod from app.produtos where id = (it->>'produto_id')::uuid and ativo;
    if v_prod.id is null then raise exception 'Produto não encontrado ou inativo.'; end if;
    v_preco := nullif(it->>'preco', '')::numeric; v_tabela_preco := null;
    if p_cliente is not null then
      select f.preco, f.tabela into v_tabela_preco, v_tab from app.preco_final_moeda(p_cliente, v_prod.id, p_moeda) f;
      v_preco := coalesce(v_preco, v_tabela_preco);
    else
      v_tab := case when p_moeda = 'GS' then 'py_normal' else 'br_normal' end;
    end if;
    -- piso: preço da tabela (do cliente, ou a normal da unidade/moeda para cliente avulso)
    if p_cliente is null then
      v_tabela_preco := coalesce(
        (select valor from app.precos z where z.produto_id = v_prod.id and p_moeda = 'GS' and z.vigente_desde <= current_date
            and z.tabela = (select d.prefixo_tabela || '_normal' from app.depositos d where d.id = c.deposito_id and d.prefixo_tabela is not null)
          order by vigente_desde desc limit 1),
        (select valor from app.precos z where z.produto_id = v_prod.id and z.tabela = v_tab and z.vigente_desde <= current_date
          order by vigente_desde desc limit 1));
      v_preco := coalesce(v_preco, v_tabela_preco);
    end if;
    if v_preco is null or v_preco <= 0 then raise exception 'Informe o preço de %: ele não tem preço na tabela.', v_prod.nome; end if;
    if v_tabela_preco is not null and v_preco < v_tabela_preco and not app.pode_baixar_preco() then
      raise exception 'O preço de % não pode ficar abaixo da tabela (%). Para dar desconto, fale com o gerente.', v_prod.nome,
        case when p_moeda = 'GS' then 'Gs ' || to_char(v_tabela_preco, 'FM999G999G999') else 'R$ ' || to_char(v_tabela_preco, 'FM999G990D00') end;
    end if;
    insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
    values (v_ped.id, v_prod.id, v_prod.codigo, v_prod.nome, v_qtd, v_preco, coalesce(v_tab, 'balcao'), c.deposito_id);
    v_total := v_total + v_qtd * v_preco; n := n + 1;
  end loop;
  if n = 0 then raise exception 'Coloque pelo menos um produto na venda.'; end if;
  v_total := round(v_total, 2);
  update app.pedidos set valor_total = v_total where id = v_ped.id;
  select * into v_ped from app.pedidos where id = v_ped.id;

  perform app._entregar_no_caixa(v_ped.id);          -- a mercadoria sai do estoque da unidade
  v_pago := app._receber(c, v_ped, p_pagamentos, 'venda');
  if v_pago > v_total + 0.009 then raise exception 'Pagamento (%) maior que o total da venda (%). Lance só o valor da venda; o troco sai do caixa.', v_pago, v_total; end if;
  if v_pago < v_total - 0.009 and p_cliente is null then
    raise exception 'Falta receber % para fechar a venda. Para vender fiado, escolha o cliente.', v_total - v_pago;
  end if;
  return v_ped.id;
end $$;


update app.usuarios u set permissoes = u.permissoes || '{"preco_abaixo": true}'
 where u.perfil = 'vendedora'
   and exists (select 1 from app.vendedoras v where v.id = u.vendedora_id and (v.nome ilike 'yessica%' or v.nome ilike 'jessica%' or v.nome ilike 'jéssica%'));
