-- =====================================================================
-- Migração 0108: custo real dos body splash e esfoliantes da Soul (informado pelo dono em 24/10/2026)
--   Body splash (qualquer)      R$ 7,85 por unidade
--   Esfoliante 100 g (qualquer) R$ 3,30 por unidade
--   Esfoliante 250 g (qualquer) R$ 4,70 por unidade
-- O frete continua sendo somado à parte (frete da marca / padrão), como nos demais produtos.
-- Inclui os produtos da Soul cadastrados sem marca (linha Lumina, Babasoul, Bumbum Perfeito).
-- Kits e anúncios de marketplace ficam de fora (o custo deles vem dos componentes).
-- =====================================================================
with soul as (
  select p.id, upper(app.nome_normal(p.nome)) as n
    from app.produtos p
   where p.tipo <> 'kit' and not p.marketplace
     and (upper(coalesce(p.marca, '')) like '%SOUL%' or upper(p.nome) like '%SOUL%'
          or upper(p.nome) like '%LUMINA%' or upper(p.nome) like '%BUMBUM PERFEITO%')
), novo as (
  select id,
         case when n like '%BODY SPLASH%' then 7.85
              when n ~ '(ESFOLIANTE|EXFOLIANTE)' and n ~ '\m100 ?G\M' then 3.30
              when n ~ '(ESFOLIANTE|EXFOLIANTE)' and n ~ '\m250 ?G\M' then 4.70
         end as custo
    from soul
)
update app.produtos p
   set custo_unitario_brl = n.custo, custo_origem = 'Dono 24/10/2026 (Soul: splash 7,85 / esfoliante 100g 3,30 / 250g 4,70)',
       custo_atualizado_em = now()
  from novo n
 where n.id = p.id and n.custo is not null and p.custo_unitario_brl is distinct from n.custo;
