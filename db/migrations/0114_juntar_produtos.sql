-- Juntar produtos duplicados: o estoque do duplicado passa para o que fica (com movimento no histórico),
-- os códigos e kits que apontavam para o duplicado passam a apontar para o que fica,
-- e o código antigo vira apelido (Bling/Shopee continuam encontrando o produto). O duplicado fica inativo.
create or replace function app.juntar_produtos(p_manter uuid, p_remover uuid, p_motivo text) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_rem app.produtos; s record; k record;
begin
  if p_manter = p_remover then raise exception 'Produtos iguais.'; end if;
  select * into v_rem from app.produtos where id = p_remover for update;
  if v_rem.id is null or not exists (select 1 from app.produtos where id = p_manter) then raise exception 'Produto não encontrado.'; end if;
  for s in select deposito_id, quantidade from app.estoque_saldos where produto_id = p_remover and quantidade > 0 loop
    perform app._lancar(s.deposito_id, p_remover, 'ajuste_saida', s.quantidade, 'juntar_produtos', p_manter::text, p_motivo);
    perform app._lancar(s.deposito_id, p_manter, 'ajuste_entrada', s.quantidade, 'juntar_produtos', p_remover::text, p_motivo);
  end loop;
  for k in select kit_id, quantidade from app.kit_componentes where componente_id = p_remover loop
    insert into app.kit_componentes (kit_id, componente_id, quantidade) values (k.kit_id, p_manter, k.quantidade)
      on conflict (kit_id, componente_id) do update set quantidade = app.kit_componentes.quantidade + excluded.quantidade;
    delete from app.kit_componentes where kit_id = k.kit_id and componente_id = p_remover;
  end loop;
  update app.produto_codigos set produto_id = p_manter where produto_id = p_remover;
  update app.produtos set codigo = v_rem.codigo || '-JUNTADO', ativo = false, mostrar_no_site = false where id = p_remover;
  if v_rem.codigo is not null then
    insert into app.produto_codigos (codigo, produto_id) values (v_rem.codigo, p_manter)
      on conflict (codigo) do update set produto_id = excluded.produto_id;
  end if;
end $$;
revoke execute on function app.juntar_produtos(uuid, uuid, text) from public;

do $$
declare a uuid; b uuid;
begin
  -- Lip Gloss Caneta Super Poderes: mesmo código de barras; fica o 2407202688
  select id into a from app.produtos where codigo = '2407202688';
  select id into b from app.produtos where codigo = 'BLING-16689799842';
  if a is not null and b is not null then
    perform app.juntar_produtos(a, b, 'Duplicado: Lip Gloss Caneta (mesmo código de barras)');
  end if;
  -- Kit Cacheamos: são dois kits diferentes; o nome passa a dizer quantos itens
  update app.produtos set nome = 'KIT CAPILAR CACHEAMOS BIO INSTINTO 2 ITENS' where codigo = '2407203244' and nome ilike '%4 ITENS%';
end $$;
