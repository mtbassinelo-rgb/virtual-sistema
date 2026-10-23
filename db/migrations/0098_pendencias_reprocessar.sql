-- =====================================================================
-- Migração 0098: pendências de estoque "sem estoque" podem ser baixadas de novo
--
-- Venda de marketplace que chegou quando o sistema não tinha saldo vira
-- pendência ("Saída não lançada: estoque do sistema insuficiente"). Depois
-- que a mercadoria entra, o gerente aperta "Dar baixa agora" e o sistema
-- tenta lançar a saída de cada pendência (kit = componentes). Se ainda faltar
-- estoque, a pendência continua aberta; nada fica pela metade.
--
-- Também liga dois anúncios do Mercado Livre que tinham virado produtos soltos
-- (sem estoque) aos produtos reais, como composição:
--   MLB4753572039 Kit Shampoo + Cond Arruda Maycrene = shampoo + condicionador Arruda
--   MLB47686350   Pomada Fisiofort Gold             = Pomada Fisiofort + Gold Bio Instinto
-- =====================================================================

create or replace function app.reprocessar_pendencias_estoque() returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare pe record; c record; v_ok int := 0; v_falta int := 0;
begin
  if not coalesce(app.pode_gerir(), false) or app.perfil_atual() is null then
    raise exception 'Só gerente ou dono dá baixa nas pendências.' using errcode = 'insufficient_privilege';
  end if;
  for pe in select * from app.estoque_pendencias
             where tipo = 'sem_estoque' and resolvida_em is null and produto_id is not null and deposito_id is not null
             order by em for update loop
    begin
      for c in select * from app.componentes(pe.produto_id, pe.quantidade) loop
        perform app._lancar(pe.deposito_id, c.produto_id, 'saida_venda', c.quantidade, 'pedido',
                            coalesce(pe.pedido_id::text, 'pendencia'), 'Pendência de marketplace baixada depois');
      end loop;
      update app.estoque_pendencias set resolvida_em = now(), resolvida_por = app.uid() where id = pe.id;
      v_ok := v_ok + 1;
    exception when others then
      v_falta := v_falta + 1;  -- ainda sem saldo: desfaz só esta pendência e segue
    end;
  end loop;
  return jsonb_build_object('baixadas', v_ok, 'sem_estoque', v_falta);
end $$;
grant execute on function app.reprocessar_pendencias_estoque() to vc_app;

-- Anúncios do ML que viraram produto solto → composição dos produtos reais
do $$
declare v_kit uuid; v_a uuid; v_b uuid;
begin
  select id into v_kit from app.produtos where codigo = 'MLB4753572039';
  select id into v_a from app.produtos where codigo = '2407203208';  -- SHAMPOO ARRUDA 500ML MAYCRENE
  select id into v_b from app.produtos where codigo = '2407203207';  -- CONDICIONADOR ARRUDA 500ML MAYCRENE
  if v_kit is not null and v_a is not null and v_b is not null
     and not exists (select 1 from app.kit_componentes where kit_id = v_kit)
     and coalesce((select sum(quantidade) from app.estoque_saldos where produto_id = v_kit), 0) = 0 then
    update app.produtos set tipo = 'kit' where id = v_kit;
    insert into app.kit_componentes (kit_id, componente_id, quantidade) values (v_kit, v_a, 1), (v_kit, v_b, 1);
  end if;

  select id into v_kit from app.produtos where codigo = 'MLB47686350';
  select id into v_a from app.produtos where codigo = '2407203250';  -- POMADA FISIOFORT + GOLD BIO INSTINTO 150 G
  if v_kit is not null and v_a is not null
     and not exists (select 1 from app.kit_componentes where kit_id = v_kit)
     and coalesce((select sum(quantidade) from app.estoque_saldos where produto_id = v_kit), 0) = 0 then
    update app.produtos set tipo = 'kit' where id = v_kit;
    insert into app.kit_componentes (kit_id, componente_id, quantidade) values (v_kit, v_a, 1);
  end if;
end $$;
