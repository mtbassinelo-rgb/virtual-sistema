-- =====================================================================
-- Frete de compra padrão: R$ 0,35 por unidade (média informada pelo dono em 20/10/2026).
-- Ordem: frete do próprio produto → kit (soma dos componentes) → frete da marca → padrão.
-- As marcas passam a usar 0,35, menos Maycrene (0,80 por produto). Kit = frete por produto × quantidade de produtos
-- (pelos componentes cadastrados; sem componentes, pelo nome: "3 ITENS" ou "Shampoo + Condicionador + Máscara").
-- =====================================================================
insert into app.parametros (chave, valor, descricao) values
  ('frete_padrao_brl', 0.35, 'Frete de compra por unidade (R$) quando o produto e a marca não têm frete próprio')
on conflict (chave) do nothing;

update app.frete_marca set frete_unidade_brl = case when marca ilike '%MAYCRENE%' then 0.80 else 0.35 end,
       observacao = 'Média informada pelo dono, 20/10/2026', atualizado_em = now();

-- Quantos produtos um kit tem, pelo nome (1 se não der para saber)
create or replace function app.itens_pelo_nome(p_nome text) returns int
language sql immutable as $$
  select greatest(1, coalesce(
    (regexp_match(upper(p_nome), '(\d+)\s*(ITENS|ITEMS|PRODUTOS|PECAS|PEÇAS|PASSOS)'))[1]::int,
    case when p_nome like '%+%' then array_length(string_to_array(p_nome, '+'), 1) end,
    1))
$$;

create or replace function app.frete_produto(p_produto uuid) returns numeric
language plpgsql stable security definer set search_path = app, pg_temp as $$
declare v numeric; v_tipo text; v_marca text; v_nome text; n int;
begin
  select frete_unidade_brl, tipo, marca, nome into v, v_tipo, v_marca, v_nome from app.produtos where id = p_produto;
  if not found then return null; end if;
  if v is not null then return v; end if;
  if v_tipo = 'kit' then
    select count(*) into n from app.kit_componentes where kit_id = p_produto;
    if n > 0 then
      select sum(k.quantidade * app.frete_produto(k.componente_id)) into v from app.kit_componentes k where k.kit_id = p_produto;
      return v;
    end if;
  end if;
  select frete_unidade_brl into v from app.frete_marca where marca = v_marca;
  v := coalesce(v, app.param('frete_padrao_brl'));
  -- kit sem componentes cadastrados: frete por produto × produtos do kit
  if v_tipo = 'kit' or v_nome ~* '^\s*kit\y' then v := v * app.itens_pelo_nome(v_nome); end if;
  return v;
end $$;
