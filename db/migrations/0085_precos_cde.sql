-- =====================================================================
-- Preço próprio da unidade (ex.: Loja CDE): tabelas "CDE · Normal" e "CDE · VIP".
-- Cliente da unidade paga a tabela da unidade quando o produto tem preço nela; sem preço lá, vale a do Paraguai
-- (nada fica sem preço). A regra "VIP só para locais" por marca continua valendo, aplicada à tabela da unidade.
-- =====================================================================
insert into app.tabelas_preco (codigo, nome, moeda, pais) values
  ('cde_normal', 'CDE · Normal', 'GS', 'PY'),
  ('cde_vip', 'CDE · VIP', 'GS', 'PY')
on conflict (codigo) do nothing;

alter table app.depositos add column prefixo_tabela text check (prefixo_tabela ~ '^[a-z]{2,10}$');
comment on column app.depositos.prefixo_tabela is 'Tabelas próprias da unidade: <prefixo>_normal e <prefixo>_vip no lugar de py_normal/py_vip.';
update app.depositos set prefixo_tabela = 'cde' where codigo = 'loja-cde';

create or replace function app.tabela_efetiva(p_cliente uuid, p_produto uuid, p_tabela text) returns text
language plpgsql stable security definer set search_path = app, pg_temp as $$
declare v_base text; v_pref text; v_prop text;
begin
  v_base := case
    when p_tabela like 'py\_%' and exists (select 1 from app.produtos p where p.id = p_produto and app.retirada_foz_marca(coalesce(nullif(trim(p.marca), ''), 'Sem marca')))
      then case when (select cliente_local from app.clientes where id = p_cliente) then 'py_vip' else 'py_normal' end
    else p_tabela end;
  if v_base like 'py\_%' and p_cliente is not null then
    select d.prefixo_tabela into v_pref from app.depositos d where d.id = app.deposito_do_cliente(p_cliente);
    if v_pref is not null then
      v_prop := v_pref || substr(v_base, 3);
      if exists (select 1 from app.precos where produto_id = p_produto and tabela = v_prop and vigente_desde <= current_date) then
        return v_prop;
      end if;
    end if;
  end if;
  return v_base;
end $$;
grant execute on function app.tabela_efetiva(uuid, uuid, text) to vc_app;
