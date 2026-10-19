-- Bio Instinto e Mary Life são a mesma fábrica: viram uma marca só no sistema e na loja.
insert into app.marcas_padrao (chave, nome, achar_no_nome)
values ('BIO INSTINTO E MARY LIFE', 'BIO INSTINTO E MARY LIFE', '\y(MARY ?LIFE|BIO ?INSTINTO)\y')
on conflict (chave) do update set nome = excluded.nome, achar_no_nome = excluded.achar_no_nome;

update app.marcas_padrao set nome = 'BIO INSTINTO E MARY LIFE', achar_no_nome = null
 where chave in ('BIO INSTINTO', 'MARY LIFE', 'MARY LIFE / BIO INSTINTO', 'BIOINSTINTO', 'MARYLIFE');
insert into app.marcas_padrao (chave, nome) values ('BIOINSTINTO', 'BIO INSTINTO E MARY LIFE'), ('MARYLIFE', 'BIO INSTINTO E MARY LIFE')
on conflict (chave) do nothing;

-- produtos que já existem (o gatilho marca_padrao troca para o nome novo)
update app.produtos set marca = marca
 where app.chave_marca(marca) in ('BIO INSTINTO', 'MARY LIFE', 'MARY LIFE / BIO INSTINTO', 'BIOINSTINTO', 'MARYLIFE');
update app.produtos p set marca = 'BIO INSTINTO E MARY LIFE'
 where p.marca is null and app.chave_marca(p.nome) ~ '\y(MARY ?LIFE|BIO ?INSTINTO)\y';

-- regras de desconto por quantidade que citavam uma das duas
update app.descontos_quantidade set marca = 'BIO INSTINTO E MARY LIFE'
 where app.chave_marca(marca) in ('BIO INSTINTO', 'MARY LIFE', 'MARY LIFE / BIO INSTINTO');
