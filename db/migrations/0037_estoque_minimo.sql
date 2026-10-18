-- Estoque mínimo por produto: a equipe define e o relatório mostra o que está abaixo, com quanto comprar.
alter table app.produtos add column estoque_minimo int check (estoque_minimo >= 0);

create or replace function app.definir_estoque_minimo(p_linhas jsonb) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare r jsonb; n int := 0; v int;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono define estoque mínimo.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_array_length(p_linhas) > 1000 then raise exception 'No máximo 1000 produtos por vez.'; end if;
  for r in select * from jsonb_array_elements(p_linhas) loop
    v := nullif(r->>'minimo', '')::int;
    if v is not null and (v < 0 or v > 1000000) then raise exception 'Estoque mínimo precisa ser entre 0 e 1.000.000.'; end if;
    update app.produtos set estoque_minimo = v where id = (r->>'id')::uuid and estoque_minimo is distinct from v;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
grant execute on function app.definir_estoque_minimo(jsonb) to vc_app;

-- Produtos ativos com saldo (somando os depósitos ativos) no mínimo ou abaixo dele.
create or replace view app.v_abaixo_minimo with (security_invoker = true) as
select p.id as produto_id, p.codigo, p.nome as produto, p.marca, p.fornecedor, p.unidades_caixa, p.estoque_minimo,
       coalesce(s.saldo, 0) as saldo,
       greatest(p.estoque_minimo - coalesce(s.saldo, 0), 0) as faltam,
       coalesce((select sum(c.quantidade) from app.pedido_itens i join app.pedidos pe on pe.id = i.pedido_id
                  cross join lateral app.componentes(i.produto_id, i.quantidade) c
                 where c.produto_id = p.id and pe.status_comercial in ('enviado','entregue')
                   and pe.data_pedido > current_date - 30), 0) as vendido_30
  from app.produtos p
  left join lateral (select sum(es.quantidade) as saldo from app.estoque_saldos es
                       join app.depositos d on d.id = es.deposito_id and d.ativo
                      where es.produto_id = p.id) s on true
 where p.ativo and p.estoque_minimo is not null and coalesce(s.saldo, 0) <= p.estoque_minimo;
grant select on app.v_abaixo_minimo to vc_app;
