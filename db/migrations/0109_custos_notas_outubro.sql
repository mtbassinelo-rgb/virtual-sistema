-- =====================================================================
-- Migração 0109: custos por unidade atualizados pelas notas de outubro/2026
-- (comparação da planilha "Valores pagos em productos VC" com as notas; autorizado pelo dono em 24/10/2026).
-- Valores sem frete (o frete é somado à parte). Kits montados e anúncios de marketplace ficam de fora.
--   Rhenuks  kits capilares (Desliza Uau, Meu Liso, Frizz/Liso Therap, Banho Brilhante) 14,40 · For Men 3 em 1 3,78
--   Phallebeauty óleo rosa mosqueta 30 ml 6,99 · sabonete antiacne 30 ml 6,99
--   Fashion  sebo relaxante 9,05 · sebo ureia 9,68 · sebo esfoliante 9,57 · reparador de pontas argan 14,80
--   Farmax   óleo de rícino 100 ml 10,21 · óleo rosa mosqueta 100 ml 5,93 (com ST, NF 8169555)
--   Sexy Fantasy perfume Phero 5,70 · Bio Instinto spray condicionante selante 10 benefícios 5,49
--   Soul     esfoliante Bumbum Perfeito 300 g 4,70
--   Mary Life spray condicionante Uso Eterno 20 benefícios 130 ml (2407203001) 9,52
-- =====================================================================
create temporary table _custos_out (id uuid, custo numeric) on commit drop;

insert into _custos_out
select p.id, r.custo
  from app.produtos p
  join lateral (
    select case
      when p.codigo = '2407203011' then 3.78
      when p.codigo = '2407203016' then 10.21
      when p.codigo = '2407202667' then 5.93
      when p.codigo = '2407202815' then 4.70
      when p.codigo = '2407203001' then 9.52
      when m like '%RHENUKS%' and n like '%KIT%' and n ~ '(DESLIZA|MEU LISO|FRIZZ THERAP|LISO THERAP|BANHO BRILHANTE)' then 14.40
      when m like '%RHENUKS%' and n like '%FOR MEN%' then 3.78
      when m like '%PHALLE%' and n like '%ROSA MOSQUETA%' and n ~ '\m30 ?ML\M' then 6.99
      when m like '%PHALLE%' and n like '%ANTIACNE%' then 6.99
      when m like '%FASHION%' and n like '%SEBO%' and n like '%RELAXANTE%' then 9.05
      when m like '%FASHION%' and n like '%SEBO%' and n like '%UREIA%' then 9.68
      when m like '%FASHION%' and n like '%SEBO%' and n like '%ESFOLIANTE%' then 9.57
      when m like '%FASHION%' and n like '%REPARADOR%' and n like '%ARGAN%' then 14.80
      when (m like '%FANTASY%' or n like '%FANTASY%') and n like '%PHERO%' then 5.70
      when (m like '%BIO INSTINTO%' or n like '%BIO INSTINTO%') and n like '%SELANTE%' and n like '%10 BENEF%' then 5.49
    end as custo
      from (select upper(coalesce(app.nome_normal(coalesce(p.marca, '') || ' ' || coalesce(p.fornecedor, '')), '')) as m, upper(coalesce(app.nome_normal(p.nome), '')) as n) x
  ) r on true
 where r.custo is not null
   and not p.marketplace
   and not exists (select 1 from app.kit_componentes k where k.kit_id = p.id);

update app.produtos p
   set custo_unitario_brl = c.custo, custo_origem = 'Notas de outubro/2026 (autorizado 24/10/2026)', custo_atualizado_em = now()
  from _custos_out c
 where c.id = p.id and p.custo_unitario_brl is distinct from c.custo;
