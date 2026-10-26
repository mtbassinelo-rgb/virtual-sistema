-- Cake Gloss Super Poderes: o "BOX" é a caixa com 24 unidades (no Bling custa 24x a unidade).
-- O estoque do BOX (em caixas) passa para a unidade (x24) e o BOX vira kit de 24 unidades:
-- se vender um BOX pela Shopee/Bling, saem 24 unidades. Sai da lista de produtos ativos (sem duplicar).
do $$
declare par text[]; v_box uuid; v_un uuid; s record;
begin
  foreach par slice 1 in array array[['BOXCGFN','2407202696'],['BOXCGPC','2407202689'],['BOXCGRV','2407202695']] loop
    select id into v_box from app.produtos where codigo = par[1];
    select id into v_un from app.produtos where codigo = par[2];
    continue when v_box is null or v_un is null;
    for s in select deposito_id, quantidade from app.estoque_saldos where produto_id = v_box and quantidade > 0 loop
      perform app._lancar(s.deposito_id, v_box, 'ajuste_saida', s.quantidade, 'juntar_produtos', v_un::text, 'BOX de 24 vira unidades');
      perform app._lancar(s.deposito_id, v_un, 'ajuste_entrada', s.quantidade * 24, 'juntar_produtos', v_box::text, 'BOX de 24 vira unidades');
    end loop;
    update app.produtos set tipo = 'kit', ativo = false, mostrar_no_site = false where id = v_box;
    delete from app.kit_componentes where kit_id = v_box;
    insert into app.kit_componentes (kit_id, componente_id, quantidade) values (v_box, v_un, 24);
  end loop;
end $$;
