create temp table pk on commit drop as
with marcas as (
  select distinct w from app.produtos, regexp_split_to_table(lower(coalesce(marca,'')), '[^a-z0-9]+') w
   where w <> '' and w not in ('leite','rosas','de','e','lua','neve','magic','color','real','love','super','poderes','fonte','da','beleza','salon','sexy','fantasy','maria','bonequinha','japonesa')
  union select unnest(array['mary','life','bio','instinto','phalle','beauty','phallebeauty','soul','babasoul','rhenuks','rheunks','rhenunks'])
)
select p.id, p.codigo, p.nome, p.marca, p.ativo, p.foto, p.tipo::text as tipo, p.gtin, p.unidades_caixa, p.estoque_minimo, p.grupo, p.variante,
       coalesce((select sum(s.quantidade) from app.estoque_saldos s where s.produto_id = p.id), 0) as est,
       exists (select 1 from app.kit_componentes k where k.componente_id = p.id) as componente,
       (select string_agg(distinct w, ' ' order by w) from regexp_split_to_table(
          regexp_replace(regexp_replace(app.nome_normal(p.nome), '(\d)\s+(ml|g|kg|l|gr)\M', '\1\2', 'g'), '[^a-z0-9]+', ' ', 'g'), ' ') w
         where w not in ('', 'de','da','do','das','dos','e','com','para','p','c','o','a','em','-') and w not in (select w from marcas)) as k
  from app.produtos p where p.tipo::text <> 'kit';
create temp table dup on commit drop as
  select x.* from pk x where x.k in (select k from pk group by k having count(*) > 1 and count(*) filter (where est > 0) >= 1 and count(*) filter (where est <= 0) >= 1);
