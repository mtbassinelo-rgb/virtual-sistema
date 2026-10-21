-- =====================================================================
-- Frete de compra padrão: R$ 0,35 por unidade (média informada pelo dono em 20/10/2026).
-- Ordem: frete do próprio produto → kit (soma dos componentes) → frete da marca → padrão.
-- As marcas passam a usar 0,35; o frete por produto que veio da aba Clientes VIP (ex.: Maycrene 0,80) continua.
-- =====================================================================
insert into app.parametros (chave, valor, descricao) values
  ('frete_padrao_brl', 0.35, 'Frete de compra por unidade (R$) quando o produto e a marca não têm frete próprio')
on conflict (chave) do nothing;

update app.frete_marca set frete_unidade_brl = 0.35, observacao = 'Média informada pelo dono, 20/10/2026', atualizado_em = now()
 where frete_unidade_brl <> 0.35;

create or replace function app.frete_produto(p_produto uuid) returns numeric
language plpgsql stable security definer set search_path = app, pg_temp as $$
declare v numeric; v_tipo text; v_marca text; n int;
begin
  select frete_unidade_brl, tipo, marca into v, v_tipo, v_marca from app.produtos where id = p_produto;
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
  return coalesce(v, app.param('frete_padrao_brl'));
end $$;
