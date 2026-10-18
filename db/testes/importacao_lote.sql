-- Importação em lote do Bling sem duplicar, modo "só estoque", e produtos procurados sem estoque.
\set QUIET on
reset role;
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set DL '00000000-0000-0000-0000-00000000ac10'
\set PX '00000000-0000-0000-0000-00000000ac01'

insert into app.depositos (id, codigo, nome, pais, tipo) values (:'DL', 'teste-lote', 'Depósito Lote', 'BR', 'cd');
-- produto que já existia aqui, sem ID do Bling, com nome escrito diferente (acento e espaços)
insert into app.produtos (id, codigo, nome) values (:'PX', 'LOTE-ANTIGO', 'Máscara  Argan Lote 500G');

\echo '== Cadastro e estoque: repetidos do Bling viram um produto só =='
select teste.como(:'GERENTE');
select set_config('teste.r1', app.importar_bling($$[
  {"bling_id": 9100001, "codigo": "LT-1", "nome": "Gel Lote 250 g", "estoque": 59},
  {"bling_id": 9100002, "codigo": "LT-2", "nome": "GEL LOTE 250 G", "estoque": 0},
  {"bling_id": 9100003, "codigo": "",     "nome": "Gel  Lote 250 g", "estoque": 1},
  {"bling_id": 9100004, "codigo": "LT-4", "nome": "Mascara Argan Lote 500g", "estoque": 7},
  {"bling_id": 9100005, "codigo": "LT-5", "nome": "Shampoo Lote Zerado", "estoque": 0}
]$$::jsonb, :'DL', null, 'teste', 'completo')::text, false);
reset role;
select teste.ok((select count(*) from app.produtos where app.nome_normal(nome) = 'gel lote 250 g') = 1,
  'Três cadastros com a mesma descrição viram UM produto');
select teste.ok((select s.quantidade from app.estoque_saldos s join app.produtos p on p.id = s.produto_id
                  where s.deposito_id = :'DL' and app.nome_normal(p.nome) = 'gel lote 250 g') = 60,
  'O estoque dos cadastros repetidos é somado (59 + 0 + 1)');
select teste.ok(exists (select 1 from app.produto_codigos where codigo = 'LT-2'),
  'O código do cadastro repetido continua reconhecido (Shopee, ML)');
select teste.ok((select bling_produto_id from app.produtos where id = :'PX') = 9100004
                and (select count(*) from app.produtos where app.nome_normal(nome) = 'mascara argan lote 500g') = 1,
  'Produto que já existia é reconhecido pela descrição (sem acento, espaços) e não é duplicado');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'DL' and produto_id = :'PX') = 7,
  'Estoque do produto reconhecido entra no depósito escolhido');
select teste.ok(coalesce((select s.quantidade from app.estoque_saldos s join app.produtos p on p.id = s.produto_id
                  where s.deposito_id = :'DL' and p.codigo = 'LT-5'), 0) = 0,
  'Estoque 0 fica 0 (aparece Esgotado)');
select teste.ok((current_setting('teste.r1')::jsonb->>'juntados')::int = 2, 'Resumo conta os cadastros juntados');

\echo '== Importar de novo não duplica =='
select teste.como(:'GERENTE');
select app.importar_bling($$[
  {"bling_id": 9100001, "codigo": "LT-1", "nome": "Gel Lote 250 g", "estoque": 59},
  {"bling_id": 9100002, "codigo": "LT-2", "nome": "GEL LOTE 250 G", "estoque": 0},
  {"bling_id": 9100004, "codigo": "LT-4", "nome": "Mascara Argan Lote 500g", "estoque": 7}
]$$::jsonb, :'DL', null, 'teste', 'completo');
reset role;
select teste.ok((select count(*) from app.produtos where codigo like 'LT-%' or id = :'PX'
                  or app.nome_normal(nome) = 'gel lote 250 g') = 3, 'Reimportar a mesma planilha não cria produto novo');

\echo '== Só estoque =='
select teste.como(:'GERENTE');
select set_config('teste.r2', app.importar_bling($$[
  {"bling_id": 9100004, "codigo": "LT-4", "nome": "Outro Nome Qualquer", "estoque": 3},
  {"bling_id": 9100099, "codigo": "LT-99", "nome": "Produto Que Não Existe Aqui", "estoque": 50}
]$$::jsonb, :'DL', null, 'teste', 'estoque')::text, false);
reset role;
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'DL' and produto_id = :'PX') = 3,
  'Só estoque: atualiza a quantidade');
select teste.ok((select nome from app.produtos where id = :'PX') = 'Mascara Argan Lote 500g', 'Só estoque: não muda o cadastro');
select teste.ok(not exists (select 1 from app.produtos where codigo = 'LT-99'), 'Só estoque: não cria produto');
select teste.ok((current_setting('teste.r2')::jsonb->>'nao_encontrados')::int = 1, 'Só estoque: lista o que ficou de fora');
select teste.como(:'GERENTE');
select teste.falha($$select app.importar_bling('[{"bling_id":1,"nome":"x","estoque":1}]', null, null, 't', 'estoque')$$,
  'depósito', 'Só estoque exige depósito');
select teste.como(:'KEILA');
select teste.falha($$select app.importar_bling('[{"bling_id":1,"nome":"x","estoque":1}]', null, null, 't', 'completo')$$,
  'gerente', 'Vendedora não importa');
reset role;

\echo '== Procurados sem estoque =='
set role vc_app;
select teste.ok(app.registrar_procura_site(:'PX', 24, 'Maria Salão', '+55 45 99999-0000', null, null), 'Visitante registra que quer o produto');
select teste.ok(not app.registrar_procura_site(:'PX', 24, 'Maria Salão', '5545999990000', null, null), 'O mesmo pedido no mesmo dia não conta duas vezes');
select teste.falha($$select app.registrar_procura_site('00000000-0000-0000-0000-00000000ac01', 1, '', '', null, null)$$,
  'WhatsApp', 'Visitante precisa informar nome e WhatsApp');
reset role;
select teste.como(:'KEILA');
set role vc_app;
insert into app.procuras (descricao, quantidade, origem, criado_por) values ('Matizador 1 litro marca nova', 12, 'vendedora', app.uid());
select teste.ok((select count(*) from app.procuras) = 1, 'Vendedora vê só o que ela registrou');
select teste.falha($$insert into app.procuras (descricao, origem, criado_por) values ('x', 'site', app.uid())$$,
  null, 'Vendedora não registra como se fosse o site');
update app.procuras set visto_em = now();
select teste.ok((select count(*) from app.procuras where visto_em is not null) = 0, 'Vendedora não marca como visto');
reset role;
select teste.ok((select count(*) from app.procuras where visto_em is not null) = 0, 'Nada foi marcado pela vendedora');
select teste.como(:'GERENTE');
set role vc_app;
select teste.ok((select pedidos from app.v_procuras_resumo where produto_id = :'PX') = 1
                and (select quantidade from app.v_procuras_resumo where produto_id = :'PX') = 24,
  'Gerente vê o resumo por produto');
select teste.ok((select novos from app.v_procuras_resumo where produto is not null and produto_id is null) = 1,
  'Produto não cadastrado também aparece no resumo');
update app.procuras set visto_em = now(), visto_por = app.uid() where produto_id = :'PX';
select teste.ok((select novos from app.v_procuras_resumo where produto_id = :'PX') = 0, 'Gerente marca como visto');
reset role;

\echo '== Kits capilares por linha =='
insert into app.produtos (codigo, nome, marca) values
  ('KT-SH1', 'SHAMPOO TESTELINHA 500ML MARCATESTE', 'MarcaTeste'),
  ('KT-CO1', 'CONDICIONADOR TESTELINHA 500ML MARCATESTE', 'MarcaTeste'),
  ('KT-MA1', 'MÁSCARA TESTELINHA 500G MARCATESTE', 'MarcaTeste'),
  ('KT-MA1K','MASCARA TESTELINHA 1KG MARCATESTE', 'MarcaTeste'),
  ('KT-SH2', 'SHAMPOO MATIZADOR TESTE 400ML MARCATESTE', 'MarcaTeste'),
  ('KT-CO2', 'CONDICIONADOR MATIZADOR TESTE 400ML MARCATESTE', 'MarcaTeste'),
  ('KT-MA2', 'MASCARA MATIZADOR TESTE 400G MARCATESTE', 'MarcaTeste'),
  ('KT-SH3', 'SHAMPOO SOZINHO 500ML MARCATESTE', 'MarcaTeste');
select teste.como(:'GERENTE');
set role vc_app;
select teste.ok((select count(*) from app.sugerir_kits_capilares('MarcaTeste')) = 2, 'Acha as linhas com shampoo, condicionador e máscara');
select teste.ok((select mascara from app.sugerir_kits_capilares('MarcaTeste') where linha = 'testelinha') like '%500G%',
  'Com duas máscaras, usa a de 500 g');
select teste.ok((select matizador from app.sugerir_kits_capilares('MarcaTeste') where linha = 'matizador teste'), 'Reconhece a linha matizadora');
select teste.ok(app.criar_kits_capilares('MarcaTeste', array['testelinha','matizador teste'],
  '{"normal":{"py_normal":33000,"py_vip":33000,"br_normal":36.27,"br_vip":27.2,"custo":20.4},"matizador":{"py_normal":37000,"py_vip":35000}}') = 2,
  'Cria os dois kits');
select teste.ok((select count(*) from app.kit_componentes k join app.produtos p on p.id = k.kit_id where p.codigo = 'KIT-KT-SH1') = 3, 'Kit com os 3 produtos');
select teste.ok((select valor from app.precos pr join app.produtos p on p.id = pr.produto_id where p.codigo = 'KIT-KT-SH2' and tabela = 'py_normal') = 37000,
  'Kit matizador com o preço de matizador');
select teste.ok((select valor from app.precos pr join app.produtos p on p.id = pr.produto_id where p.codigo = 'KIT-KT-SH1' and tabela = 'py_normal') = 33000,
  'Kit normal com o preço normal');
select teste.ok(not exists (select 1 from app.vitrine_publica() where codigo in ('KT-SH1','KT-CO1','KT-MA1','KT-SH2','KT-CO2','KT-MA2'))
  and exists (select 1 from app.vitrine_publica() where codigo = 'KIT-KT-SH1')
  and exists (select 1 from app.vitrine_publica() where codigo = 'KT-MA1K')
  and exists (select 1 from app.vitrine_publica() where codigo = 'KT-SH3'),
  'No site: o kit aparece, os soltos do kit não; o que não entrou em kit continua');
select teste.ok((select ativo from app.produtos where codigo = 'KT-SH1'), 'O solto continua ativo no sistema');
select teste.ok(app.criar_kits_capilares('MarcaTeste', array['testelinha'], '{}') = 0, 'Rodar de novo não duplica o kit');
select teste.ok(app.definir_mostrar_no_site(array[(select id from app.produtos where codigo = 'KT-SH1')], true) = 1, 'Gerente muda “Mostrar no site”');
select teste.ok(exists (select 1 from app.vitrine_publica() where codigo = 'KT-SH1'), 'O solto volta a aparecer no site');
select teste.como(:'KEILA');
select teste.falha($$select app.criar_kits_capilares('MarcaTeste', array['testelinha'], '{}')$$, 'gerente', 'Vendedora não cria kits');
reset role;
\echo 'Testes de importação em lote e procuras passaram.'
