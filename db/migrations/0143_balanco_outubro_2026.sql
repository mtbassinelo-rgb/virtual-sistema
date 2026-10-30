-- =====================================================================
-- Balanço de outubro/2026: compras, contas a pagar e custos fixos passados pelo Mateus em 30/10.
-- Só roda em produção (onde já há pedidos de outubro). Não duplica: pula o que já existe
-- (mesma categoria, fornecedor parecido e valor até 3% de diferença, na mesma data/vencimento ou no mesmo mês).
-- Não mexe em estoque nem em produtos.
-- =====================================================================

create function pg_temp.forn(p_padrao text, p_nome text) returns uuid language plpgsql as $$
declare v uuid;
begin
  select id into v from app.fornecedores where nome ilike p_padrao order by ativo desc, criado_em limit 1;
  if v is null then
    insert into app.fornecedores (nome) values (p_nome) on conflict (nome) do nothing;
    select id into v from app.fornecedores where nome = p_nome;
  end if;
  return v;
end $$;

-- compra (registro de compra, sem estoque); pula se já houver compra do fornecedor com total parecido perto da data
create function pg_temp.compra(p_padrao text, p_nome text, p_data date, p_prod numeric, p_frete numeric, p_status text, p_obs text) returns void language plpgsql as $$
declare v_f uuid := pg_temp.forn(p_padrao, p_nome);
begin
  if exists (select 1 from app.compras c where c.fornecedor_id = v_f and c.criado_em < now() and abs(c.data - p_data) <= 20
               and abs(c.total - (p_prod + p_frete)) <= 0.03 * (p_prod + p_frete)) then return; end if;
  insert into app.compras (fornecedor_id, data, valor_produtos, frete, status, deposito_id, observacao)
  values (v_f, p_data, p_prod, p_frete, p_status, (select id from app.depositos where codigo = 'cd-foz'), p_obs);
end $$;

-- conta a pagar (paga ou a vencer); pula se já existir parecida (cada conta antiga só serve para um lançamento)
create temp table usados (id uuid primary key) on commit drop;
create function pg_temp.conta(p_cat text, p_desc text, p_forn text, p_padrao text, p_moeda app.moeda, p_valor numeric,
  p_venc date, p_pago date, p_dep text, p_obs text default null, p_janela int default 5) returns void language plpgsql as $$
declare v_id uuid;
begin
  select d.id into v_id from app.despesas d
   where d.categoria = p_cat and d.moeda = p_moeda and d.criado_em < now()
     and not exists (select 1 from usados u where u.id = d.id)
     and (coalesce(d.fornecedor, '') ilike p_padrao or d.descricao ilike p_padrao)
     and abs(d.valor - p_valor) <= 0.03 * p_valor
     and (abs(coalesce(d.vencimento, d.pago_em) - p_venc) <= p_janela or abs(coalesce(d.pago_em, d.vencimento) - coalesce(p_pago, p_venc)) <= p_janela)
   order by abs(coalesce(d.vencimento, d.pago_em) - p_venc), abs(d.valor - p_valor)
   limit 1;
  if v_id is not null then
    insert into usados values (v_id);
    -- já existe: só completa o pagamento se agora está pago
    if p_pago is not null then update app.despesas set pago_em = p_pago, valor_pago = valor where id = v_id and pago_em is null; end if;
    return;
  end if;
  insert into app.despesas (categoria, descricao, fornecedor, moeda, valor, competencia, vencimento, pago_em, valor_pago, deposito_id, observacao)
  values (p_cat, p_desc, p_forn, p_moeda, p_valor, date_trunc('month', coalesce(p_pago, p_venc))::date, p_venc, p_pago,
          case when p_pago is not null then p_valor end, (select id from app.depositos where codigo = p_dep),
          coalesce(p_obs, 'Lançado pelo balanço de outubro/2026 (informado pelo Mateus em 30/10).'));
end $$;

-- custo fixo do mês: se já há a conta do mês (ex.: recorrente) sem pagar, marca como paga com o valor informado
create function pg_temp.fixo(p_cat text, p_desc text, p_forn text, p_padrao text, p_moeda app.moeda, p_valor numeric, p_dep text) returns void language plpgsql as $$
declare v_id uuid;
begin
  if exists (select 1 from app.despesas d where d.categoria = p_cat and d.competencia = date '2026-10-01' and d.moeda = p_moeda
               and (coalesce(d.fornecedor, '') ilike p_padrao or d.descricao ilike p_padrao) and d.valor = p_valor) then
    update app.despesas d set pago_em = coalesce(d.pago_em, date '2026-10-30'), valor_pago = coalesce(d.valor_pago, d.valor)
     where d.categoria = p_cat and d.competencia = date '2026-10-01' and d.moeda = p_moeda
       and (coalesce(d.fornecedor, '') ilike p_padrao or d.descricao ilike p_padrao) and d.valor = p_valor;
    return;
  end if;
  select d.id into v_id from app.despesas d where d.categoria = p_cat and d.competencia = date '2026-10-01' and d.pago_em is null
     and (coalesce(d.fornecedor, '') ilike p_padrao or d.descricao ilike p_padrao) order by d.criado_em limit 1;
  if v_id is not null then
    update app.despesas set moeda = p_moeda, valor = p_valor, pago_em = date '2026-10-30', valor_pago = p_valor,
           observacao = left(coalesce(observacao || ' · ', '') || 'Valor pago informado pelo Mateus em 30/10.', 500) where id = v_id;
    return;
  end if;
  insert into app.despesas (categoria, descricao, fornecedor, moeda, valor, competencia, vencimento, pago_em, valor_pago, deposito_id, observacao)
  values (p_cat, p_desc, p_forn, p_moeda, p_valor, date '2026-10-01', date '2026-10-30', date '2026-10-30', p_valor,
          (select id from app.depositos where codigo = p_dep), 'Lançado pelo balanço de outubro/2026 (informado pelo Mateus em 30/10).');
end $$;

do $$
begin
  if not exists (select 1 from app.pedidos where data_pedido between date '2026-10-22' and date '2026-10-31') then return; end if;

  -- ---------- Compras de outubro ----------
  perform pg_temp.compra('%rhenuks%', 'Rhenuks', '2026-10-05', 7717.68, 743.90, 'recebida', 'Balanço out/2026');
  perform pg_temp.compra('%rhenuks%', 'Rhenuks', '2026-10-20', 8661.60, 828.93, 'recebida', 'Balanço out/2026');
  perform pg_temp.compra('%bio%instinto%', 'Bio Instinto', '2026-10-05', 8084.16, 0, 'recebida', 'Balanço out/2026');
  perform pg_temp.compra('%bio%instinto%', 'Bio Instinto', '2026-10-14', 12606.72, 0, 'recebida', 'Balanço out/2026 · pedido 2145060');
  perform pg_temp.compra('%soul%', 'Comercial Soul', '2026-10-08', 16189.80, 0, 'recebida', 'Balanço out/2026');
  perform pg_temp.compra('%maycrene%', 'Maycrene', '2026-10-15', 35333.00, 4257.99, 'recebida', 'Balanço out/2026 · data a confirmar');
  perform pg_temp.compra('%fonte%beleza%', 'Fonte da Beleza', '2026-10-13', 29569.20, 0, 'recebida', 'Balanço out/2026');
  perform pg_temp.compra('%fonte%beleza%', 'Fonte da Beleza', '2026-10-20', 2112.00, 0, 'recebida', 'Balanço out/2026 · hennas');
  perform pg_temp.compra('%phal%', 'Phalle Beauty', '2026-10-15', 9287.16, 0, 'recebida', 'Balanço out/2026');
  perform pg_temp.compra('%makiaj%', 'Makiaj', '2026-10-22', 3973.00, 0, 'recebida', 'Balanço out/2026');
  perform pg_temp.compra('%real%love%', 'Real Love', '2026-10-15', 9579.80, 90.00, 'recebida', 'Balanço out/2026 · data a confirmar');
  perform pg_temp.compra('%fashion%', 'Fashion', '2026-10-30', 8909.00, 240.00, 'recebida', 'Balanço out/2026 · chegou 30/10');
  perform pg_temp.compra('%farmax%', 'Farmax', '2026-10-20', 4451.73, 0, 'recebida', 'Balanço out/2026');
  perform pg_temp.compra('%farmax%', 'Farmax', '2026-10-27', 2315.84, 0, 'recebida', 'Balanço out/2026');

  -- ---------- Compras pagas em outubro (saída de caixa) ----------
  perform pg_temp.conta('mercadoria', 'Compra Rhenuks 05/10 (com frete)', 'Rhenuks', '%rhenuks%', 'BRL', 8461.58, '2026-10-05', '2026-10-05', 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Rhenuks 20/10 (com frete)', 'Rhenuks', '%rhenuks%', 'BRL', 9490.53, '2026-10-20', '2026-10-20', 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Bio Instinto 05/10', 'Bio Instinto', '%bio%instinto%', 'BRL', 8084.16, '2026-10-05', '2026-10-05', 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Soul 08/10', 'Comercial Soul', '%soul%', 'BRL', 16189.80, '2026-10-08', '2026-10-08', 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Maycrene (com frete)', 'Maycrene', '%maycrene%', 'BRL', 39590.99, '2026-10-15', '2026-10-15', 'cd-foz', 'Balanço out/2026 · data do pagamento a confirmar.', 31);
  perform pg_temp.conta('mercadoria', 'Compra Fonte da Beleza 13/10', 'Fonte da Beleza', '%fonte%beleza%', 'BRL', 29569.20, '2026-10-13', '2026-10-13', 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Fonte da Beleza 20/10 (hennas)', 'Fonte da Beleza', '%fonte%beleza%', 'BRL', 2112.00, '2026-10-20', '2026-10-20', 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Phalle 15/10', 'Phalle Beauty', '%phal%', 'BRL', 9287.16, '2026-10-15', '2026-10-15', 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Makiaj 22/10', 'Makiaj', '%makiaj%', 'BRL', 3973.00, '2026-10-22', '2026-10-22', 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Real Love (com frete)', 'Real Love', '%real%love%', 'BRL', 9669.80, '2026-10-15', '2026-10-15', 'cd-foz', 'Balanço out/2026 · data do pagamento a confirmar.', 31);
  perform pg_temp.conta('transportadora', 'Frete Fashion', 'Fashion', '%fashion%', 'BRL', 240.00, '2026-10-30', '2026-10-30', 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra à vista 30/10 (chega em novembro)', 'A confirmar', '%compra à vista 30/10%', 'BRL', 8786.30, '2026-10-30', '2026-10-30', 'cd-foz', 'Balanço out/2026 · fornecedor a confirmar.', 1);

  -- ---------- Compras anteriores pagas em outubro ----------
  perform pg_temp.conta('mercadoria', 'Boleto Zap (compra anterior)', 'Zap', '%zap%', 'BRL', 1946.00, '2026-10-15', '2026-10-15', 'cd-foz', 'Balanço out/2026 · data do pagamento a confirmar.', 31);
  perform pg_temp.conta('mercadoria', 'Boleto Naxos (compra anterior)', 'Naxos', '%naxos%', 'BRL', 1648.20, '2026-10-13', '2026-10-13', 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Boleto Naxos (compra anterior)', 'Naxos', '%naxos%', 'BRL', 1648.20, '2026-10-21', '2026-10-21', 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Adeus de 23/09 (com frete)', 'Adeus', '%adeus%', 'BRL', 4340.00, '2026-10-01', '2026-10-01', 'cd-foz', 'Balanço out/2026 · compra de 23/09; confirmar se foi paga em outubro.', 31);

  -- ---------- Transportadora (frete de Soul, Bio, Fonte da Beleza e Phalle) ----------
  perform pg_temp.conta('transportadora', 'Frete transportadora (Soul, Bio, Fonte, Phalle)', 'Transportadora', '%transportadora%', 'BRL', 1503.91, '2026-10-05', '2026-10-05', 'cd-foz');
  perform pg_temp.conta('transportadora', 'Frete transportadora (Soul, Bio, Fonte, Phalle)', 'Transportadora', '%transportadora%', 'BRL', 8176.52, '2026-10-05', '2026-10-05', 'cd-foz');
  perform pg_temp.conta('transportadora', 'Frete transportadora (Soul, Bio, Fonte, Phalle)', 'Transportadora', '%transportadora%', 'BRL', 474.08, '2026-10-19', '2026-10-19', 'cd-foz');
  perform pg_temp.conta('transportadora', 'Frete transportadora (Soul, Bio, Fonte, Phalle)', 'Transportadora', '%transportadora%', 'BRL', 608.98, '2026-10-19', '2026-10-19', 'cd-foz');
  perform pg_temp.conta('transportadora', 'Frete transportadora (Soul, Bio, Fonte, Phalle)', 'Transportadora', '%transportadora%', 'BRL', 1315.45, '2026-10-26', '2026-10-26', 'cd-foz');
  perform pg_temp.conta('transportadora', 'Frete transportadora (Soul, Bio, Fonte, Phalle)', 'Transportadora', '%transportadora%', 'BRL', 1188.59, '2026-10-26', '2026-10-26', 'cd-foz');
  perform pg_temp.conta('transportadora', 'Frete transportadora (emissão 26/10)', 'Transportadora', '%transportadora%', 'BRL', 608.63, '2026-11-02', null, 'cd-foz');

  -- ---------- A vencer ----------
  -- Bio já estava lançada com vencimento 29/10; Mateus informou que paga em 03/11
  update app.despesas set vencimento = date '2026-11-03'
   where categoria = 'mercadoria' and pago_em is null and valor = 12606.72 and (fornecedor ilike '%bio%' or descricao ilike '%bio%');
  perform pg_temp.conta('mercadoria', 'Compra Bio Instinto - pedido 2145060', 'Bio Instinto', '%bio%', 'BRL', 12606.72, '2026-11-03', null, 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Boleto Naxos (compra anterior)', 'Naxos', '%naxos%', 'BRL', 1648.20, '2026-11-03', null, 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Boleto Zap (compra anterior)', 'Zap', '%zap%', 'BRL', 1946.00, '2026-11-11', null, 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Fashion - parcela 1/2', 'Fashion', '%fashion%', 'BRL', 4454.50, '2026-11-20', null, 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Fashion - parcela 2/2', 'Fashion', '%fashion%', 'BRL', 4454.50, '2026-12-05', null, 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Farmax 20/10 - parcela 1/5', 'Farmax', '%farmax%', 'BRL', 890.37, '2026-11-03', null, 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Farmax 20/10 - parcela 2/5', 'Farmax', '%farmax%', 'BRL', 890.34, '2026-11-10', null, 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Farmax 20/10 - parcela 3/5', 'Farmax', '%farmax%', 'BRL', 890.34, '2026-11-17', null, 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Farmax 20/10 - parcela 4/5', 'Farmax', '%farmax%', 'BRL', 890.34, '2026-11-24', null, 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Farmax 20/10 - parcela 5/5', 'Farmax', '%farmax%', 'BRL', 890.34, '2026-12-01', null, 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Farmax 27/10 - parcela 1/5', 'Farmax', '%farmax%', 'BRL', 463.20, '2026-11-26', null, 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Farmax 27/10 - parcela 2/5', 'Farmax', '%farmax%', 'BRL', 463.16, '2026-12-11', null, 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Farmax 27/10 - parcela 3/5', 'Farmax', '%farmax%', 'BRL', 463.16, '2026-12-28', null, 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Farmax 27/10 - parcela 4/5', 'Farmax', '%farmax%', 'BRL', 463.16, '2027-01-11', null, 'cd-foz');
  perform pg_temp.conta('mercadoria', 'Compra Farmax 27/10 - parcela 5/5', 'Farmax', '%farmax%', 'BRL', 463.16, '2027-01-25', null, 'cd-foz');

  -- ---------- Insumos e custos fixos pagos em outubro ----------
  perform pg_temp.conta('outros', 'Papel para mecha (insumo)', 'Papel para mecha', '%papel%mecha%', 'BRL', 1000.00, '2026-10-27', '2026-10-27', 'cd-foz');
  perform pg_temp.fixo('aluguel', 'Aluguel CDE', 'Aluguel CDE', '%cde%', 'GS', 1200000, 'loja-cde');
  perform pg_temp.fixo('aluguel', 'Aluguel Foz', 'Aluguel Foz', '%foz%', 'BRL', 5000, 'cd-foz');
  perform pg_temp.fixo('salarios', 'Salário Crislaine', 'Crislaine', '%crislaine%', 'BRL', 2700, 'cd-foz');
  perform pg_temp.fixo('salarios', 'Salário Keila (1º pagamento)', 'Keila', '%keila%', 'GS', 3044000, null);
  perform pg_temp.fixo('salarios', 'Salário Keila (2º pagamento)', 'Keila', '%keila%2º%', 'GS', 3000000, null);
  perform pg_temp.fixo('salarios', 'Salário Yessica (1º pagamento)', 'Yessica', '%yessica%', 'GS', 3044000, 'loja-cde');
  perform pg_temp.fixo('salarios', 'Salário Yessica (2º pagamento)', 'Yessica', '%yessica%2º%', 'GS', 1265000, 'loja-cde');
end $$;
