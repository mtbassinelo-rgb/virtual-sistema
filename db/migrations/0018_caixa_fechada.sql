-- Venda em caixa fechada: quantas peças vêm na caixa. O preço das tabelas continua sendo por unidade;
-- o site mostra o preço da caixa (unidade × peças) e o da unidade.

alter table app.produtos add column unidades_caixa int check (unidades_caixa between 1 and 1000);

-- Real Love vem em caixas de uma dúzia
update app.produtos set unidades_caixa = 12 where unidades_caixa is null and (nome ilike '%real love%' or marca ilike '%real love%');

create or replace function app.definir_caixas(p_linhas jsonb) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare r jsonb; n int := 0; v int;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono altera produtos.' using errcode = 'insufficient_privilege';
  end if;
  for r in select * from jsonb_array_elements(p_linhas) loop
    v := nullif(r->>'unidades','')::int;
    if v is not null and (v < 1 or v > 1000) then raise exception 'Peças por caixa de % precisa ser entre 1 e 1000.', r->>'codigo'; end if;
    update app.produtos set unidades_caixa = v where codigo = trim(r->>'codigo') and unidades_caixa is distinct from v;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
grant execute on function app.definir_caixas(jsonb) to vc_app;

drop function app.vitrine_publica();
create function app.vitrine_publica()
returns table (produto_id uuid, codigo text, nome text, marca text, tipo text, foto text, tem_estoque boolean, novidade boolean, unidades_caixa int)
language sql stable security definer set search_path = app, pg_temp as $$
  select p.id, p.codigo, p.nome, p.marca, p.tipo, p.foto,
         exists (select 1 from app.depositos d where d.ativo and app.saldo_disponivel(d.id, p.id) > 0),
         p.novidade, p.unidades_caixa
    from app.produtos p
   where p.ativo
   order by p.nome
$$;
grant execute on function app.vitrine_publica() to vc_app;
