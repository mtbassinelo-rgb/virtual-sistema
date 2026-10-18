-- Kits capilares por linha (shampoo + condicionador + máscara da mesma marca e linha).
-- Os produtos soltos continuam no sistema (estoque, pedidos da vendedora), mas podem sair do site:
-- no site aparece o kit. O gerente liga ou desliga "Mostrar no site" em cada produto.

alter table app.produtos add column mostrar_no_site boolean not null default true;

create or replace function app.vitrine_publica()
returns table (produto_id uuid, codigo text, nome text, marca text, tipo text, foto text, tem_estoque boolean, novidade boolean, unidades_caixa int)
language sql stable security definer set search_path = app, pg_temp as $$
  select p.id, p.codigo, p.nome, p.marca, p.tipo, p.foto,
         exists (select 1 from app.depositos d where d.ativo and app.saldo_disponivel(d.id, p.id) > 0),
         p.novidade, p.unidades_caixa
    from app.produtos p
   where p.ativo and p.mostrar_no_site
   order by p.nome
$$;

create or replace function app.definir_mostrar_no_site(p_produtos uuid[], p_mostrar boolean) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare n int;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono altera produtos.' using errcode = 'insufficient_privilege';
  end if;
  update app.produtos set mostrar_no_site = p_mostrar where id = any(p_produtos) and mostrar_no_site <> p_mostrar;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function app.definir_mostrar_no_site(uuid[], boolean) to vc_app;

-- Tipo e linha de um produto capilar pelo nome: "SHAMPOO MATIZADOR PLATINUM 500ML MAYCRENE" → (shampoo, matizador platinum)
create or replace function app.linha_capilar(p_nome text, p_marca text)
returns table (tipo text, linha text)
language sql immutable set search_path = app, pg_temp as $$
  with n as (select app.nome_normal(p_nome) as s, app.nome_normal(p_marca) as m),
       t as (select (regexp_match(s, '^(shampoo|condicionador|mascara)\s+(.*)$')) as r, m from n)
  select r[1],
         nullif(trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           ' ' || r[2] || ' ',
           ' ' || coalesce(m, '#') || ' ', ' ', 'g'),               -- tira a marca
           '\m\d+([.,]\d+)?\s*(ml|g|kg|l)\M', ' ', 'g'),            -- tira o tamanho
           '^\s*(hidratante|cabelo)\s+', ' '),                       -- "máscara hidratante óleo de abacate", "shampoo cabelo afro"
           '[^a-z0-9 ]', ' ', 'g'),
           '\s+', ' ', 'g')), '')
    from t where r is not null
$$;

-- Trios encontrados na marca (um por linha; com duas máscaras, fica a menor: 500 g antes de 1 kg)
create or replace function app.sugerir_kits_capilares(p_marca text)
returns table (linha text, matizador boolean,
               shampoo_id uuid, shampoo text, condicionador_id uuid, condicionador text, mascara_id uuid, mascara text,
               kit_id uuid, kit text)
language sql stable security definer set search_path = app, pg_temp as $$
  with c as (
    select p.id, p.nome, l.tipo, l.linha,
           row_number() over (partition by l.tipo, l.linha
                              order by (app.nome_normal(p.nome) ~ '\m1\s*(kg|l)\M'), p.ativo desc, p.nome) as ordem
      from app.produtos p cross join lateral app.linha_capilar(p.nome, p_marca) l
     where p.tipo = 'simples' and l.linha is not null
       and (app.nome_normal(p.marca) = app.nome_normal(p_marca) or app.nome_normal(p.nome) like '%' || app.nome_normal(p_marca) || '%')),
  trio as (
    select linha,
           max(id::text) filter (where tipo = 'shampoo')::uuid as sh, max(nome) filter (where tipo = 'shampoo') as shn,
           max(id::text) filter (where tipo = 'condicionador')::uuid as co, max(nome) filter (where tipo = 'condicionador') as con,
           max(id::text) filter (where tipo = 'mascara')::uuid as ma, max(nome) filter (where tipo = 'mascara') as man
      from c where ordem = 1 group by linha)
  select t.linha, t.linha like '%matiz%', t.sh, t.shn, t.co, t.con, t.ma, t.man, k.id, k.nome
    from trio t
    left join lateral (
      select kp.id, kp.nome from app.produtos kp
       where kp.tipo = 'kit'
         and exists (select 1 from app.kit_componentes x where x.kit_id = kp.id and x.componente_id = t.sh)
         and exists (select 1 from app.kit_componentes x where x.kit_id = kp.id and x.componente_id = t.co)
         and exists (select 1 from app.kit_componentes x where x.kit_id = kp.id and x.componente_id = t.ma)
       limit 1) k on true
   where t.sh is not null and t.co is not null and t.ma is not null
   order by t.linha like '%matiz%', t.linha
$$;
grant execute on function app.sugerir_kits_capilares(text) to vc_app;

-- Cria os kits das linhas escolhidas.
-- p_precos: {"normal": {"py_normal": 33000, "py_vip": 33000, "br_normal": 36.27, "br_vip": 27.20, "custo": 20.40},
--            "matizador": {...}}
-- Os produtos soltos saem do site (continuam no sistema); o kit aparece no site.
create or replace function app.criar_kits_capilares(p_marca text, p_linhas text[], p_precos jsonb, p_esconder_soltos boolean default true)
returns int language plpgsql security definer set search_path = app, pg_temp as $$
declare s record; v_kit uuid; v_cod text; v_nome text; v_pr jsonb; v_tab text; n int := 0;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono cria kits.' using errcode = 'insufficient_privilege';
  end if;
  for s in select * from app.sugerir_kits_capilares(p_marca) where linha = any(p_linhas) loop
    if s.kit_id is null then
      v_cod := 'KIT-' || (select codigo from app.produtos where id = s.shampoo_id);
      if exists (select 1 from app.produtos where codigo = v_cod) then
        v_cod := 'KIT-' || upper(left(regexp_replace(app.nome_normal(p_marca), '[^a-z]', '', 'g'), 3)) || '-' ||
                 upper(regexp_replace(s.linha, '[^a-z0-9]+', '-', 'g'));
      end if;
      -- nome da linha como está no shampoo (com acentos): "SHAMPOO ÓLEO DE ABACATE 500ML MAYCRENE" → "Óleo de Abacate"
      v_nome := regexp_replace(regexp_replace(regexp_replace(s.shampoo, '^\s*shampoo\s+(cabelo\s+|de\s+)?', '', 'i'),
                  '\m\d+([.,]\d+)?\s*(ml|g|kg|l)\M', ' ', 'gi'), '[-\s]*' || p_marca || '\s*', ' ', 'gi');
      v_nome := regexp_replace(' ' || initcap(trim(regexp_replace(v_nome, '\s+', ' ', 'g'))) || ' ', ' (De|Da|Do|Das|Dos|E) ', ' \1 ', 'g');
      v_nome := regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(v_nome,
                  ' De ', ' de ', 'g'), ' Da ', ' da ', 'g'), ' Do ', ' do ', 'g'), ' E ', ' e ', 'g'), ' Dos ', ' dos ', 'g');
      v_nome := 'Kit ' || initcap(p_marca) || ' ' || trim(v_nome) || ' (Shampoo + Condicionador + Máscara)';
      v_pr := coalesce(p_precos -> case when s.matizador then 'matizador' else 'normal' end, '{}');
      insert into app.produtos (codigo, nome, marca, custo, unidade, ativo, mostrar_no_site)
      values (v_cod, v_nome, initcap(p_marca), nullif(v_pr->>'custo', '')::numeric, 'KIT', true, true)
      returning id into v_kit;
      perform app.definir_kit(v_kit, jsonb_build_array(
        jsonb_build_object('produto_id', s.shampoo_id, 'quantidade', 1),
        jsonb_build_object('produto_id', s.condicionador_id, 'quantidade', 1),
        jsonb_build_object('produto_id', s.mascara_id, 'quantidade', 1)));
      foreach v_tab in array array['py_normal','py_vip','br_normal','br_vip'] loop
        if nullif(v_pr->>v_tab, '') is not null then
          insert into app.precos (produto_id, tabela, valor, vigente_desde, definido_por)
          values (v_kit, v_tab, (v_pr->>v_tab)::numeric, current_date, app.uid())
          on conflict (produto_id, tabela, vigente_desde) do update set valor = excluded.valor;
        end if;
      end loop;
      n := n + 1;
    end if;
    if p_esconder_soltos then
      update app.produtos set mostrar_no_site = false
       where id in (s.shampoo_id, s.condicionador_id, s.mascara_id) and mostrar_no_site;
    end if;
  end loop;
  return n;
end $$;
grant execute on function app.criar_kits_capilares(text, text[], jsonb, boolean) to vc_app;
