-- Troca de produto/fragrância mais simples: a vendedora combina com o cliente e troca direto
-- na lista de itens do pedido. O print da conversa passa a ser opcional.
alter table app.pedido_trocas alter column arquivo drop not null, alter column mime drop not null, alter column sha256 drop not null;

create or replace function app.trocar_item_pedido(p_item uuid, p_produto uuid, p_quantidade numeric,
  p_arquivo text, p_nome text, p_mime text, p_tamanho int, p_sha text, p_obs text default null) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare it app.pedido_itens; v_ped app.pedidos; v_prod app.produtos; f record; v_q numeric; v_id uuid;
begin
  select * into it from app.pedido_itens where id = p_item;
  if it.id is null then raise exception 'Item não encontrado (talvez já tenha sido trocado ou removido).'; end if;
  v_ped := app._pedido_editavel_itens(it.pedido_id);
  if not (app.pode_escrever() and app.ve_pedido(v_ped.vendedora_id)) then
    raise exception 'Só a vendedora do pedido ou a gerência troca produtos.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_prod from app.produtos where id = p_produto;
  if v_prod.id is null then raise exception 'Produto substituto não encontrado.'; end if;
  if not v_prod.ativo then raise exception 'O produto % está inativo.', v_prod.nome; end if;
  if v_prod.id = it.produto_id then raise exception 'Escolha um produto diferente do atual.'; end if;
  v_q := coalesce(p_quantidade, it.quantidade);
  if v_q <= 0 then raise exception 'Quantidade inválida.'; end if;
  select * into f from app.preco_final_moeda(v_ped.cliente_id, v_prod.id, v_ped.moeda);
  if f.preco is null then
    raise exception 'O produto % não tem preço na tabela deste cliente.', v_prod.nome;
  end if;

  insert into app.pedido_trocas (pedido_id, item_id, produto_antes, descricao_antes, quantidade_antes, preco_antes,
                                 produto_depois, descricao_depois, quantidade, preco_depois,
                                 arquivo, nome_original, mime, tamanho, sha256, observacao, feito_por)
  values (it.pedido_id, it.id, it.produto_id, it.descricao, it.quantidade, it.preco_unitario,
          v_prod.id, v_prod.nome, v_q, f.preco, nullif(p_arquivo, ''), nullif(p_nome, ''), nullif(p_mime, ''), nullif(p_tamanho, 0), nullif(p_sha, ''), nullif(trim(p_obs), ''), app.uid())
  returning id into v_id;

  update app.pedido_itens
     set produto_id = v_prod.id, codigo = v_prod.codigo, descricao = v_prod.nome,
         quantidade = v_q, quantidade_pedida = v_q, preco_unitario = f.preco, tabela_preco = f.tabela, desconto = 0
   where id = it.id;
  perform app._recalcular_total_pedido(it.pedido_id);
  return v_id;
end $$;
