-- Marcas padronizadas e sempre em MAIÚSCULAS: "MAYCRENE", "Maycrene" e "maycrene " viram uma só. Vale para o que já existe e para
-- tudo que entrar depois (cadastro, planilha ou importação do Bling). Produtos sem marca ganham a marca
-- quando o nome dela aparece no nome do produto.
create table app.marcas_padrao (
  chave text primary key,          -- forma comparável: maiúsculas, sem acento, espaços simples
  nome  text not null,             -- como a marca aparece no sistema e na loja
  achar_no_nome text               -- regex (em maiúsculas, sem acento) para descobrir a marca pelo nome do produto
);
alter table app.marcas_padrao enable row level security;
create policy ler on app.marcas_padrao for select using (app.uid() is not null);
grant select on app.marcas_padrao to vc_app;

create or replace function app.chave_marca(p text) returns text
language sql immutable as $$
  select nullif(regexp_replace(upper(translate(trim(replace(coalesce(p, ''), '&', ' E ')),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')), '\s+', ' ', 'g'), '')
$$;

insert into app.marcas_padrao (chave, nome, achar_no_nome) values
  ('ARFANZI', 'ARFANZI', '\yARFANZI\y'),
  ('BIO INSTINTO', 'BIO INSTINTO', '\yBIO INSTINTO\y'),
  ('BONEQUINHA', 'BONEQUINHA JAPONESA', null),
  ('BONEQUINHA JAPONESA', 'BONEQUINHA JAPONESA', '\yBONEQUINHA JAPONESA\y'),
  ('FARMAX', 'FARMAX', '\yFARMAX\y'),
  ('FASHION', 'FASHION', '\y- FASHION\y|\yFASHION$'),
  ('LEITE DE ROSAS', 'LEITE DE ROSAS', '\yLEITE DE ROSAS\y'),
  ('LUA E NEVE', 'LUA E NEVE', '\yLUA ?E ?NEVE\y'),
  ('MAGIC COLOR', 'MAGIC COLOR', '\yMAGIC (COLOR|3D)\y'),
  ('MAKIAJ', 'MAKIAJ', '\yMAKIAJ\y'),
  ('MARIA ESCANDALOSA', 'MARIA ESCANDALOSA', '\yMARIA ESCANDALOSA\y'),
  ('MARY LIFE', 'MARY LIFE', '\yMARY LIFE\y'),
  ('MARY LIFE / BIO INSTINTO', 'MARY LIFE', null),
  ('MAYCRENE', 'MAYCRENE', '\yMAYCRENE\y'),
  ('NAXOS', 'NAXOS', '\yNAXOS\y'),
  ('NELO', 'NELO', '\yNELO\y'),
  ('PHALLE BEAUTY', 'PHALLEBEAUTY', null),
  ('PHALLEBEAUTY', 'PHALLEBEAUTY', '\yPHALLE ?BEAUTY\y'),
  ('REAL LOVE', 'REAL LOVE', '\yREAL LOVE\y'),
  ('RHENUKS', 'RHENUKS', '\yRHENU?N?KS\y'),
  ('RHENUNKS', 'RHENUKS', null),
  ('SALON PROFESIONAL', 'SALON PROFESIONAL', '\ySALON PROFESIONAL\y'),
  ('SEXY FANTASY', 'SEXY FANTASY', '\y(SEXY FANTASY|FANTASY SEXY)\y'),
  ('SHINE''S', 'SHINE''S', '\ySHINE''?S\y'),
  ('SOUL', 'SOUL', '\y(SOUL|BABASOUL)\y'),
  ('SUPER PODERES', 'SUPER PODERES', '\ySUPER PODERES\y'),
  ('ZAP', 'ZAP', '\yZAP\y');

create or replace function app.trg_marca_padrao() returns trigger
language plpgsql set search_path = app, pg_temp as $$
declare v text;
begin
  if new.marca is not null then
    new.marca := nullif(regexp_replace(trim(new.marca), '\s+', ' ', 'g'), '');
    select nome into v from app.marcas_padrao where chave = app.chave_marca(new.marca);
    new.marca := coalesce(v, upper(new.marca));
  end if;
  return new;
end $$;
create trigger marca_padrao before insert or update of marca on app.produtos
  for each row execute function app.trg_marca_padrao();

-- O que já existe: junta as variações e tira "marcas" que são material de embalagem
update app.produtos set marca = null where app.chave_marca(marca) in ('ETIQUETA MARKTPLACE', 'PAPELAO');
update app.produtos set marca = marca where marca is not null;   -- passa pelo gatilho

-- Sem marca: procura o nome da marca no nome do produto (primeira regra que bater, Mary Life antes de Bio Instinto)
update app.produtos p set marca = (
    select mp.nome from app.marcas_padrao mp
     where mp.achar_no_nome is not null and app.chave_marca(p.nome) ~ mp.achar_no_nome
     order by (mp.chave = 'MARY LIFE') desc, length(mp.chave) desc limit 1)
 where p.marca is null
   and exists (select 1 from app.marcas_padrao mp where mp.achar_no_nome is not null and app.chave_marca(p.nome) ~ mp.achar_no_nome);
