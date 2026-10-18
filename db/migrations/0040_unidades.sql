-- Unidades de venda: CD Foz (site principal) e Loja CDE (site próprio, vende por unidade e por caixa fechada).
-- Os produtos são os mesmos; muda o estoque que o cliente vê, a marca do site, o idioma e a forma de venda.
alter table app.depositos
  add column loja_nome text,
  add column loja_idioma text not null default 'pt' check (loja_idioma in ('pt','es')),
  add column vende_unidade boolean not null default false,       -- cliente escolhe unidade ou caixa fechada
  add column mostra_abastecedor boolean not null default true;   -- cliente vê também o estoque do CD que abastece (com prazo)

update app.depositos set loja_nome = 'Virtual Cosméticos' where codigo = 'cd-foz';
update app.depositos set loja_nome = 'Virtual Cosméticos CDE', loja_idioma = 'es', vende_unidade = true, mostra_abastecedor = false
 where codigo = 'loja-cde';

-- Vitrine pública de uma unidade: "tem estoque" olha só o estoque dela (e o do abastecedor, se ela mostra)
create or replace function app.vitrine_publica_unidade(p_deposito uuid)
returns table (produto_id uuid, codigo text, nome text, marca text, tipo text, foto text, tem_estoque boolean, novidade boolean, unidades_caixa int)
language sql stable security definer set search_path = app, pg_temp as $$
  select p.id, p.codigo, p.nome, p.marca, p.tipo, p.foto,
         app.saldo_disponivel(d.id, p.id) > 0
           or (d.mostra_abastecedor and d.abastecido_por is not null and app.saldo_disponivel(d.abastecido_por, p.id) > 0),
         p.novidade, p.unidades_caixa
    from app.produtos p cross join app.depositos d
   where p.ativo and d.id = p_deposito
   order by p.nome
$$;
grant execute on function app.vitrine_publica_unidade(uuid) to vc_app;

-- Dados públicos das unidades (para o site escolher marca, idioma e forma de venda)
create or replace function app.unidades_loja()
returns table (id uuid, codigo text, nome text, loja_nome text, loja_idioma text, vende_unidade boolean, pais app.pais)
language sql stable security definer set search_path = app, pg_temp as $$
  select id, codigo, nome, coalesce(loja_nome, nome), loja_idioma, vende_unidade, pais from app.depositos where ativo order by tipo, nome
$$;
grant execute on function app.unidades_loja() to vc_app;

-- Unidade do cliente logado no site
create or replace function app.portal_unidade(p_sessao_hash text) returns uuid
language sql stable security definer set search_path = app, pg_temp as $$
  select app.deposito_do_cliente(app.portal_cliente_id(p_sessao_hash))
$$;
grant execute on function app.portal_unidade(text) to vc_app;

-- Vendedora: em quais unidades vende e qual é a padrão (gerente ou dono)
create or replace function app.definir_unidades_vendedora(p_vendedora uuid, p_depositos uuid[], p_padrao uuid)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono define as unidades das vendedoras.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(array_length(p_depositos, 1), 0) = 0 then raise exception 'Escolha pelo menos uma unidade.'; end if;
  if p_padrao is null or not (p_padrao = any(p_depositos)) then raise exception 'A unidade padrão precisa estar entre as marcadas.'; end if;
  delete from app.vendedora_depositos where vendedora_id = p_vendedora and not (deposito_id = any(p_depositos));
  update app.vendedora_depositos set padrao = false where vendedora_id = p_vendedora and padrao and deposito_id <> p_padrao;
  insert into app.vendedora_depositos (vendedora_id, deposito_id, padrao)
  select p_vendedora, d, d = p_padrao from unnest(p_depositos) d
  on conflict (vendedora_id, deposito_id) do update set padrao = excluded.padrao;
end $$;
grant execute on function app.definir_unidades_vendedora(uuid, uuid[], uuid) to vc_app;

create or replace function app.portal_catalogo(p_sessao_hash text)
returns table (produto_id uuid, codigo text, nome text, fornecedor text, moeda app.moeda,
               preco numeric, preco_tabela numeric, desconto_pct numeric, limite_qtd numeric,
               disponibilidade text, disponivel_abastecedor boolean, prazo_abastecimento text,
               ja_comprou boolean, ultima_compra date, destaque text, ordem int)
language sql stable security definer set search_path = app, pg_temp as $$
  with cli as (select app.portal_cliente_id(p_sessao_hash) as id),
       dep as (select d.id, case when d.mostra_abastecedor then d.abastecido_por end as abastecido_por, d.prazo_abastecimento from app.depositos d
                where d.id = app.deposito_do_cliente((select id from cli))),
       hist as (
         select i.produto_id, max(p.data_pedido) as ultima
           from app.pedido_itens i join app.pedidos p on p.id = i.pedido_id
          where p.cliente_id = (select id from cli) and p.status_comercial <> 'cancelado'
          group by 1),
       base as (
         select pr.id as produto_id, pr.codigo, pr.nome, pr.fornecedor, f.moeda, f.preco, f.preco_tabela, f.desconto_pct, f.limite_qtd,
                app.saldo_disponivel((select id from dep), pr.id) as saldo,
                case when (select abastecido_por from dep) is null then 0
                     else app.saldo_disponivel((select abastecido_por from dep), pr.id) end as saldo_abast,
                g.situacao, h.ultima
           from app.produtos pr
           cross join lateral app.preco_final((select id from cli), pr.id) f
           left join app.v_giro g on g.produto_id = pr.id and g.deposito_id = (select id from dep)
           left join hist h on h.produto_id = pr.id
          where pr.ativo and (select id from cli) is not null and f.preco is not null)
  select produto_id, codigo, nome, fornecedor, moeda, preco, preco_tabela, desconto_pct, limite_qtd,
         case when saldo <= 0 then 'indisponivel'
              when saldo < app.param('giro_ultimas_unidades') then 'ultimas'
              else 'disponivel' end,
         saldo_abast > 0,
         (select prazo_abastecimento from dep),
         ultima is not null, ultima,
         case when desconto_pct is not null and saldo + saldo_abast > 0 then 'promocao'
              when ultima is not null and saldo + saldo_abast > 0 then 'recompra'
              when situacao = 'parado' and saldo > 0 then 'sugestao'
              else null end,
         case when saldo + saldo_abast <= 0 then 9
              when desconto_pct is not null then 1
              when ultima is not null then 2
              when situacao = 'parado' then 3
              when saldo <= 0 then 6
              else 5 end
    from base
   order by 16, nome
$$;

create or replace function app.portal_criar_pedido(p_sessao_hash text, p_itens jsonb, p_obs text default null)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_cli app.clientes; v_dep app.depositos; v_ped uuid; it jsonb; v_qtd numeric; f record;
  v_local numeric; v_abast numeric; q_local numeric; q_abast numeric; q_enc numeric; v_enc boolean; v_prod app.produtos; v_total numeric := 0; n int := 0;
begin
  select * into v_cli from app.clientes where id = app.portal_cliente_id(p_sessao_hash);
  if v_cli.id is null then raise exception 'Sessão expirada. Peça um novo link para a sua vendedora.'; end if;
  select * into v_dep from app.depositos where id = app.deposito_do_cliente(v_cli.id);
  -- unidade que vende só o próprio estoque (ex.: loja de CDE): não oferece o estoque do CD que a abastece
  if not v_dep.mostra_abastecedor then v_dep.abastecido_por := null; end if;
  insert into app.pedidos (origem, canal, cliente_id, vendedora_id, data_pedido, moeda, valor_total, status_comercial, deposito_id, observacoes)
  values ('portal', 'portal', v_cli.id, v_cli.vendedora_id, current_date, v_cli.moeda, 0, 'aguardando_aprovacao', v_dep.id,
          nullif(trim(coalesce(p_obs,'')), ''))
  returning id into v_ped;
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    v_qtd := (it->>'quantidade')::numeric;
    continue when v_qtd is null or v_qtd <= 0;
    select * into v_prod from app.produtos where id = (it->>'produto_id')::uuid and ativo;
    if v_prod.id is null then raise exception 'Produto não encontrado.'; end if;
    select * into f from app.preco_final(v_cli.id, v_prod.id);
    if f.preco is null then raise exception 'Produto sem preço na sua tabela.'; end if;
    if f.limite_qtd is not null and v_qtd > f.limite_qtd then
      raise exception 'Promoção de % limitada a % unidades por pedido.', v_prod.nome, f.limite_qtd;
    end if;
    v_local := app.saldo_disponivel(v_dep.id, v_prod.id);
    v_abast := case when v_dep.abastecido_por is null then 0 else app.saldo_disponivel(v_dep.abastecido_por, v_prod.id) end;
    v_enc := coalesce((it->>'encomenda')::boolean, false);
    if v_local + v_abast < v_qtd and not v_enc then
      raise exception 'Quantidade maior que a disponível de % (disponível: %).', v_prod.nome, v_local + v_abast;
    end if;
    q_local := least(v_qtd, v_local);
    q_abast := least(v_qtd - q_local, v_abast);
    q_enc := v_qtd - q_local - q_abast;          -- o que falta vira encomenda (a vendedora confirma o prazo)
    if q_local > 0 then
      insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
      values (v_ped, v_prod.id, v_prod.codigo,
              v_prod.nome || case when f.promocao_id is not null then ' (promoção -' || f.desconto_pct::int || '%)' else '' end,
              q_local, f.preco, f.tabela, v_dep.id);
    end if;
    if q_abast > 0 then
      insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
      values (v_ped, v_prod.id, v_prod.codigo,
              v_prod.nome || case when f.promocao_id is not null then ' (promoção -' || f.desconto_pct::int || '%)' else '' end
                          || ' · vem de ' || (select nome from app.depositos where id = v_dep.abastecido_por)
                          || coalesce(' (' || v_dep.prazo_abastecimento || ')', ''),
              q_abast, f.preco, f.tabela, v_dep.abastecido_por);
    end if;
    if q_enc > 0 then
      insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco, deposito_origem_id)
      values (v_ped, v_prod.id, v_prod.codigo,
              v_prod.nome || case when f.promocao_id is not null then ' (promoção -' || f.desconto_pct::int || '%)' else '' end
                          || ' · ENCOMENDA (sem estoque: confirmar prazo)',
              q_enc, f.preco, f.tabela, v_dep.id);
    end if;
    v_total := v_total + v_qtd * f.preco; n := n + 1;
  end loop;
  if n = 0 then raise exception 'Escolha pelo menos um produto.'; end if;
  update app.pedidos set valor_total = round(v_total, 2) where id = v_ped;
  return v_ped;
end $$;
