-- Caixa diário por unidade (CD Foz e Loja CDE): alguém abre o caixa com o fundo de troco, registra as vendas
-- de balcão (pedido + baixa no estoque + forma de pagamento) e os recebimentos de pedidos de clientes,
-- lança sangrias, reforços e despesas, e fecha contando o dinheiro. A diferença fica registrada.

insert into app.canais (codigo, nome, marketplace) values ('balcao', 'Venda no balcão (caixa)', false)
  on conflict (codigo) do nothing;

create table app.caixas (
  id            uuid primary key default gen_random_uuid(),
  deposito_id   uuid not null references app.depositos(id),
  status        text not null default 'aberto' check (status in ('aberto','fechado')),
  aberto_por    uuid not null references app.usuarios(id),
  aberto_em     timestamptz not null default now(),
  fundo_gs      numeric(14,2) not null default 0 check (fundo_gs >= 0),
  fundo_brl     numeric(14,2) not null default 0 check (fundo_brl >= 0),
  fechado_por   uuid references app.usuarios(id),
  fechado_em    timestamptz,
  contado_gs    numeric(14,2),            -- dinheiro em espécie contado no fechamento
  contado_brl   numeric(14,2),
  esperado_gs   numeric(14,2),            -- fundo + entradas em espécie − saídas em espécie
  esperado_brl  numeric(14,2),
  observacao    text,
  constraint fechado_completo check (status = 'aberto' or (fechado_por is not null and fechado_em is not null))
);
create unique index caixas_um_aberto on app.caixas (deposito_id) where status = 'aberto';
create index on app.caixas (deposito_id, aberto_em desc);

create table app.caixa_movimentos (
  id           bigserial primary key,
  caixa_id     uuid not null references app.caixas(id),
  tipo         text not null check (tipo in ('venda','recebimento','reforco','sangria','despesa')),
  moeda        app.moeda not null,
  modalidade   app.modalidade_pagamento not null default 'efetivo',
  valor        numeric(14,2) not null check (valor > 0),
  pedido_id    uuid references app.pedidos(id),
  pagamento_id uuid references app.pagamentos(id),
  descricao    text,
  usuario_id   uuid references app.usuarios(id),
  em           timestamptz not null default now()
);
create index on app.caixa_movimentos (caixa_id, em);
create index on app.caixa_movimentos (pedido_id);

alter table app.caixas enable row level security;
alter table app.caixa_movimentos enable row level security;
-- leitura: quem pode operar o caixa daquela unidade; escrita só pelas funções abaixo
create or replace function app.pode_caixa(p_deposito uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select app.uid() is not null and (
         app.perfil_atual() in ('gerente','dono')
      or exists (select 1 from app.deposito_responsaveis where deposito_id = p_deposito and usuario_id = app.uid())
      or exists (select 1 from app.vendedora_depositos vd join app.usuarios u on u.vendedora_id = vd.vendedora_id
                  where u.id = app.uid() and vd.deposito_id = p_deposito))
$$;
create policy ler on app.caixas for select using (app.pode_caixa(deposito_id));
create policy ler on app.caixa_movimentos for select using (exists (select 1 from app.caixas c where c.id = caixa_id and app.pode_caixa(c.deposito_id)));
grant select on app.caixas, app.caixa_movimentos to vc_app;
grant execute on function app.pode_caixa(uuid) to vc_app;
create trigger auditar after insert or update or delete on app.caixas for each row execute function app.auditar('id');
create trigger auditar after insert or update or delete on app.caixa_movimentos for each row execute function app.auditar('id');

create or replace function app._caixa_aberto(p_caixa uuid) returns app.caixas
language plpgsql security definer set search_path = app, pg_temp as $$
declare c app.caixas;
begin
  select * into c from app.caixas where id = p_caixa for update;
  if c.id is null then raise exception 'Caixa não encontrado.'; end if;
  if c.status <> 'aberto' then raise exception 'Este caixa já foi fechado. Abra o caixa do dia.'; end if;
  if not app.pode_caixa(c.deposito_id) then
    raise exception 'Você não opera o caixa desta unidade.' using errcode = 'insufficient_privilege';
  end if;
  return c;
end $$;

create or replace function app.abrir_caixa(p_deposito uuid, p_fundo_gs numeric, p_fundo_brl numeric) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare v uuid;
begin
  if not app.pode_caixa(p_deposito) then
    raise exception 'Você não opera o caixa desta unidade.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from app.caixas where deposito_id = p_deposito and status = 'aberto') then
    raise exception 'Já existe um caixa aberto nesta unidade. Feche-o antes de abrir outro.';
  end if;
  insert into app.caixas (deposito_id, aberto_por, fundo_gs, fundo_brl)
  values (p_deposito, app.uid(), coalesce(p_fundo_gs, 0), coalesce(p_fundo_brl, 0)) returning id into v;
  return v;
end $$;

-- Pagamentos recebidos no caixa: [{"modalidade":"efetivo","valor":50000}]. Viram pagamento do pedido (para o
-- gerente conferir) e movimento do caixa. Devolve o total recebido.
create or replace function app._receber(c app.caixas, p_pedido app.pedidos, p_pagamentos jsonb, p_tipo text) returns numeric
language plpgsql security definer set search_path = app, pg_temp as $$
declare pg jsonb; v numeric; v_mod app.modalidade_pagamento; v_pag uuid; total numeric := 0;
begin
  for pg in select * from jsonb_array_elements(coalesce(p_pagamentos, '[]')) loop
    v := round((pg->>'valor')::numeric, 2);
    continue when v is null or v <= 0;
    v_mod := coalesce(nullif(pg->>'modalidade', ''), 'efetivo')::app.modalidade_pagamento;
    insert into app.pagamentos (pedido_id, valor, data, modalidade, observacao, registrado_por)
    values (p_pedido.id, v, current_date, v_mod, 'Recebido no caixa de ' || (select nome from app.depositos where id = c.deposito_id), app.uid())
    returning id into v_pag;
    insert into app.caixa_movimentos (caixa_id, tipo, moeda, modalidade, valor, pedido_id, pagamento_id, usuario_id)
    values (c.id, p_tipo, p_pedido.moeda, v_mod, v, p_pedido.id, v_pag, app.uid());
    total := total + v;
  end loop;
  return total;
end $$;

-- Entrega o pedido pelo caixa: vai para "entregue" e a mercadoria sai do estoque da unidade (se ainda não saiu).
create or replace function app._entregar_no_caixa(p_pedido uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare s text;
begin
  select status_comercial::text into s from app.pedidos where id = p_pedido;
  if s = 'aguardando_cliente' then
    update app.pedidos set status_comercial = 'em_separacao' where id = p_pedido; s := 'em_separacao';
  end if;
  if s in ('aguardando_aprovacao','em_separacao','enviado','aguardando_retirada') then
    update app.pedidos set status_comercial = 'entregue', entregue_em = current_date,
           enviado_em = coalesce(enviado_em, current_date) where id = p_pedido;
  end if;
end $$;

-- Venda no balcão: cria o pedido da unidade, baixa o estoque e registra as formas de pagamento.
-- p_itens: [{"produto_id":"...","quantidade":3,"preco":12000}] (preço opcional: sem ele vale a tabela do cliente,
-- ou a tabela normal da moeda para cliente avulso). Pagamento menor que o total só com cliente identificado (fica devendo).
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
    v_preco := nullif(it->>'preco', '')::numeric;
    if p_cliente is not null then
      select f.preco, f.tabela into v_tabela_preco, v_tab from app.preco_final_moeda(p_cliente, v_prod.id, p_moeda) f;
      v_preco := coalesce(v_preco, v_tabela_preco);
    else
      v_tab := case when p_moeda = 'GS' then 'py_normal' else 'br_normal' end;
      if v_preco is null then
        select valor into v_preco from app.precos where produto_id = v_prod.id and tabela = v_tab and vigente_desde <= current_date
         order by vigente_desde desc limit 1;
      end if;
    end if;
    if v_preco is null or v_preco <= 0 then raise exception 'Informe o preço de %: ele não tem preço na tabela.', v_prod.nome; end if;
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

-- Pedido de cliente (site, vendedora) pago ou retirado no caixa: registra o pagamento e, se marcar, entrega e baixa o estoque.
create or replace function app.receber_pedido_caixa(p_caixa uuid, p_pedido uuid, p_pagamentos jsonb, p_entregar boolean)
returns numeric language plpgsql security definer set search_path = app, pg_temp as $$
declare c app.caixas; v_ped app.pedidos; v numeric;
begin
  c := app._caixa_aberto(p_caixa);
  select * into v_ped from app.pedidos where id = p_pedido;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if v_ped.status_comercial = 'cancelado' then raise exception 'Pedido cancelado.'; end if;
  if v_ped.deposito_id is distinct from c.deposito_id then
    raise exception 'Este pedido sai de outra unidade (%). Receba no caixa dela.', (select nome from app.depositos where id = v_ped.deposito_id);
  end if;
  v := app._receber(c, v_ped, p_pagamentos, 'recebimento');
  if p_entregar then perform app._entregar_no_caixa(p_pedido); end if;
  if v = 0 and not p_entregar then raise exception 'Informe o valor recebido ou marque para entregar o pedido.'; end if;
  return v;
end $$;

-- Reforço (entra troco), sangria (retirada para o cofre/banco) e despesa paga com o dinheiro do caixa
create or replace function app.movimento_caixa(p_caixa uuid, p_tipo text, p_moeda app.moeda, p_valor numeric, p_descricao text)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare c app.caixas;
begin
  c := app._caixa_aberto(p_caixa);
  if p_tipo not in ('reforco','sangria','despesa') then raise exception 'Tipo de movimento inválido.'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor.'; end if;
  if p_tipo in ('sangria','despesa') and coalesce(trim(p_descricao), '') = '' then raise exception 'Diga o motivo (ex.: depósito no banco, compra de material).'; end if;
  insert into app.caixa_movimentos (caixa_id, tipo, moeda, modalidade, valor, descricao, usuario_id)
  values (c.id, p_tipo, p_moeda, 'efetivo', round(p_valor, 2), nullif(trim(p_descricao), ''), app.uid());
end $$;

-- Dinheiro em espécie que deveria estar na gaveta
create or replace function app.caixa_esperado(p_caixa uuid, p_moeda app.moeda) returns numeric
language sql stable security definer set search_path = app, pg_temp as $$
  select case when p_moeda = 'GS' then c.fundo_gs else c.fundo_brl end
       + coalesce((select sum(case when m.tipo in ('venda','recebimento','reforco') then m.valor else -m.valor end)
                     from app.caixa_movimentos m where m.caixa_id = c.id and m.moeda = p_moeda and m.modalidade = 'efetivo'), 0)
    from app.caixas c where c.id = p_caixa
$$;

create or replace function app.fechar_caixa(p_caixa uuid, p_contado_gs numeric, p_contado_brl numeric, p_obs text)
returns jsonb language plpgsql security definer set search_path = app, pg_temp as $$
declare c app.caixas; eg numeric; eb numeric;
begin
  c := app._caixa_aberto(p_caixa);
  if p_contado_gs is null or p_contado_brl is null then raise exception 'Conte o dinheiro da gaveta (Gs e R$) para fechar.'; end if;
  eg := app.caixa_esperado(c.id, 'GS'); eb := app.caixa_esperado(c.id, 'BRL');
  if (abs(p_contado_gs - eg) > 0.009 or abs(p_contado_brl - eb) > 0.009) and coalesce(trim(p_obs), '') = '' then
    raise exception 'O dinheiro contado não bate com o esperado (Gs %, R$ %). Explique a diferença na observação.', eg, eb;
  end if;
  update app.caixas set status = 'fechado', fechado_por = app.uid(), fechado_em = now(),
         contado_gs = p_contado_gs, contado_brl = p_contado_brl, esperado_gs = eg, esperado_brl = eb,
         observacao = nullif(trim(coalesce(p_obs, '')), '')
   where id = c.id;
  return jsonb_build_object('esperado_gs', eg, 'esperado_brl', eb, 'diferenca_gs', p_contado_gs - eg, 'diferenca_brl', p_contado_brl - eb);
end $$;

grant execute on function app.abrir_caixa(uuid, numeric, numeric), app.venda_balcao(uuid, uuid, app.moeda, jsonb, jsonb, text),
  app.receber_pedido_caixa(uuid, uuid, jsonb, boolean), app.movimento_caixa(uuid, text, app.moeda, numeric, text),
  app.caixa_esperado(uuid, app.moeda), app.fechar_caixa(uuid, numeric, numeric, text) to vc_app;
revoke execute on function app._caixa_aberto(uuid), app._receber(app.caixas, app.pedidos, jsonb, text), app._entregar_no_caixa(uuid) from public;

-- Inventário (contagem) de uma unidade: grava o saldo contado de vários produtos de uma vez.
-- Gerente, dono ou responsável pelo depósito. Devolve quantos produtos mudaram.
create or replace function app.registrar_inventario(p_deposito uuid, p_linhas jsonb) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare r jsonb; v_prod app.produtos; v_cont numeric; v_atual numeric; v_dif numeric; n int := 0;
begin
  if not app.pode_operar_deposito(p_deposito) then
    raise exception 'Só gerente, dono ou responsável pela unidade registra inventário.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_array_length(coalesce(p_linhas, '[]')) > 2000 then raise exception 'No máximo 2000 produtos por vez.'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_linhas, '[]')) loop
    v_cont := nullif(r->>'contado', '')::numeric;
    continue when v_cont is null;
    if v_cont < 0 then raise exception 'Quantidade contada não pode ser negativa.'; end if;
    select * into v_prod from app.produtos where id = (r->>'produto_id')::uuid;
    continue when v_prod.id is null or v_prod.tipo = 'kit';
    select quantidade into v_atual from app.estoque_saldos where deposito_id = p_deposito and produto_id = v_prod.id;
    v_dif := v_cont - coalesce(v_atual, 0);
    if v_dif > 0 then perform app._lancar(p_deposito, v_prod.id, 'ajuste_entrada', v_dif, 'inventario', null, 'Inventário (contagem)');
    elsif v_dif < 0 then perform app._lancar(p_deposito, v_prod.id, 'ajuste_saida', -v_dif, 'inventario', null, 'Inventário (contagem)');
    end if;
    if v_dif <> 0 then n := n + 1; end if;
  end loop;
  return n;
end $$;
grant execute on function app.registrar_inventario(uuid, jsonb) to vc_app;
