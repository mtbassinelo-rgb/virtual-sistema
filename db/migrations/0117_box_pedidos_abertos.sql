-- Pedidos abertos que ainda apontam para o BOX de Cake Gloss (agora kit de 24) passam para a unidade,
-- com a mesma quantidade e preço: cada unidade pedida sai como 1 unidade (e não 24).
-- (0115 já tinha rodado antes desse ajuste entrar nele.)
do $$
declare par text[]; v_box uuid; v_un uuid; v_nome text; r record;
begin
  foreach par slice 1 in array array[['BOXCGFN','2407202696'],['BOXCGPC','2407202689'],['BOXCGRV','2407202695']] loop
    select id into v_box from app.produtos where codigo = par[1];
    select id, nome into v_un, v_nome from app.produtos where codigo = par[2];
    continue when v_box is null or v_un is null;
    for r in select i.id, i.pedido_id from app.pedido_itens i join app.pedidos p on p.id = i.pedido_id
              where i.produto_id = v_box and not coalesce(p.estoque_baixado, false)
                and p.status_comercial::text in ('aguardando_cliente','aguardando_aprovacao','em_separacao') loop
      update app.pedido_itens set produto_id = v_un, codigo = par[2], descricao = v_nome where id = r.id;
    end loop;
  end loop;
end $$;
