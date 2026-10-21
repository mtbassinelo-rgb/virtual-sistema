-- =====================================================================
-- Frete pelas notas fiscais: a cada NF-e registrada com a marca e a quantidade de produtos,
-- o frete por produto da marca vira a média das últimas notas (frete total ÷ produtos).
-- Sem notas, continua o valor informado (0,35 padrão; Maycrene 0,80).
-- =====================================================================
alter table app.compras
  add column marca text check (length(marca) <= 80),
  add column unidades int check (unidades between 1 and 1000000),
  add column nfe text check (length(nfe) <= 60);

insert into app.parametros (chave, valor, descricao) values
  ('frete_media_notas', 5, 'Frete por marca: média das últimas N notas fiscais com quantidade de produtos')
on conflict (chave) do nothing;

-- Média por marca (últimas N notas com marca e quantidade)
create or replace function app.frete_medio_notas()
returns table (marca text, notas int, unidades bigint, frete_total numeric, frete_unidade numeric, ultima date)
language sql stable security definer set search_path = app, pg_temp as $$
  select x.marca, count(*)::int, sum(x.unidades), sum(x.frete), round(sum(x.frete) / nullif(sum(x.unidades), 0), 4), max(x.data)
    from (select c.*, row_number() over (partition by c.marca order by c.data desc, c.criado_em desc) as ord
            from app.compras c where c.marca is not null and c.unidades is not null) x
   where x.ord <= greatest(1, coalesce(app.param('frete_media_notas'), 5))::int
   group by x.marca
$$;

create or replace function app.atualizar_frete_marca_por_notas() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare m text; f record;
begin
  for m in select distinct v from unnest(array[case when tg_op <> 'INSERT' then old.marca end, case when tg_op <> 'DELETE' then new.marca end]) v where v is not null loop
    select * into f from app.frete_medio_notas() x where x.marca = m;
    if f.frete_unidade is not null then
      insert into app.frete_marca (marca, frete_unidade_brl, observacao)
      values (m, f.frete_unidade, format('Média de %s nota(s) fiscal(is), %s produtos', f.notas, f.unidades))
      on conflict (marca) do update set frete_unidade_brl = excluded.frete_unidade_brl, observacao = excluded.observacao, atualizado_em = now();
    end if;
  end loop;
  return null;
end $$;
create trigger frete_por_notas after insert or update or delete on app.compras for each row execute function app.atualizar_frete_marca_por_notas();

drop function app.registrar_compra(uuid, date, numeric, numeric, numeric, text);
create or replace function app.registrar_compra(p_fornecedor uuid, p_data date, p_valor numeric, p_frete numeric, p_cambio numeric, p_observacao text,
  p_marca text default null, p_unidades int default null, p_nfe text default null)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id uuid;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono registra compras.'; end if;
  if p_data is null or p_data > current_date + 1 then raise exception 'Data da compra inválida.'; end if;
  if p_unidades is not null and nullif(trim(p_marca), '') is null then raise exception 'Para calcular o frete por produto, informe a marca da nota.'; end if;
  insert into app.compras (fornecedor_id, data, valor_produtos, frete, cambio, observacao, criado_por, marca, unidades, nfe)
  values (p_fornecedor, p_data, p_valor, coalesce(p_frete, 0), p_cambio, nullif(trim(coalesce(p_observacao, '')), ''), app.uid(),
          nullif(trim(p_marca), ''), p_unidades, nullif(trim(p_nfe), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.registrar_compra(uuid, date, numeric, numeric, numeric, text, text, int, text), app.frete_medio_notas() from public;
grant execute on function app.registrar_compra(uuid, date, numeric, numeric, numeric, text, text, int, text), app.frete_medio_notas() to vc_app;
