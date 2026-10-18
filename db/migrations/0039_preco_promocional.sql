-- Preço promocional digitado direto na lista de produtos (gerente e dono) e desfazer de preço.
-- O preço vira uma promoção aprovada do país (desconto sobre a tabela normal), que a loja já destaca.

create or replace function app.definir_preco_promocional(p_produto uuid, p_pais app.pais, p_preco numeric, p_dias int default 30)
returns numeric language plpgsql security definer set search_path = app, pg_temp as $$
declare v_base numeric; v_pct numeric;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono define preço promocional.' using errcode = 'insufficient_privilege';
  end if;
  update app.promocoes set status = 'encerrada'
   where produto_id = p_produto and pais = p_pais and status in ('proposta','aprovada') and fim >= current_date;
  if p_preco is null then return null; end if;
  select valor into v_base from app.precos
   where produto_id = p_produto and tabela = case when p_pais = 'PY' then 'py_normal' else 'br_normal' end
     and vigente_desde <= current_date order by vigente_desde desc limit 1;
  if v_base is null then raise exception 'Defina primeiro o preço normal (%) para poder colocar preço promocional.', case when p_pais = 'PY' then 'PY Normal' else 'BR Gold' end; end if;
  if p_preco <= 0 or p_preco >= v_base then
    raise exception 'O preço promocional precisa ser menor que o normal (%).', v_base;
  end if;
  v_pct := round((1 - p_preco / v_base) * 100, 2);
  if v_pct < 0.01 then raise exception 'Desconto pequeno demais.'; end if;
  insert into app.promocoes (produto_id, pais, desconto_pct, inicio, fim, motivo, status, criada_por, decidida_por, decidida_em)
  values (p_produto, p_pais, v_pct, current_date, current_date + greatest(coalesce(p_dias, 30), 1), 'Preço promocional pela lista de produtos',
          'aprovada', app.uid(), app.uid(), now());
  return v_pct;
end $$;
grant execute on function app.definir_preco_promocional(uuid, app.pais, numeric, int) to vc_app;

-- Desfazer: tira o preço lançado hoje e volta a valer o anterior
create or replace function app.remover_preco_de_hoje(p_produto uuid, p_tabela text) returns boolean
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono altera preços.' using errcode = 'insufficient_privilege';
  end if;
  delete from app.precos where produto_id = p_produto and tabela = p_tabela and vigente_desde = current_date;
  return found;
end $$;
grant execute on function app.remover_preco_de_hoje(uuid, text) to vc_app;
