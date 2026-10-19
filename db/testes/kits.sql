-- Testes de kits e de pedidos de marketplace vindos do Bling. Rodar depois dos outros testes.
\set QUIET on
reset role;
\set GERENTE '00000000-0000-0000-0000-000000000002'
select id as cd from app.depositos where codigo = 'cd-foz' \gset
select id as cde from app.depositos where codigo = 'loja-cde' \gset
insert into app.produtos (id, codigo, nome, fornecedor) values
  ('00000000-0000-0000-0000-00000000aa01','SOU-SH','Shampoo Platinum','Soul'),
  ('00000000-0000-0000-0000-00000000aa02','SOU-CO','Condicionador Platinum','Soul'),
  ('00000000-0000-0000-0000-00000000aa03','SOU-MA','Máscara Platinum','Soul');
insert into app.produtos (id, codigo, nome, fornecedor, tipo) values
  ('00000000-0000-0000-0000-00000000aa10','KIT-PLAT','Kit Platinum','Soul','kit');
insert into app.kit_componentes values
  ('00000000-0000-0000-0000-00000000aa10','00000000-0000-0000-0000-00000000aa01',1),
  ('00000000-0000-0000-0000-00000000aa10','00000000-0000-0000-0000-00000000aa02',1),
  ('00000000-0000-0000-0000-00000000aa10','00000000-0000-0000-0000-00000000aa03',1);
insert into app.precos (produto_id, tabela, valor, vigente_desde) values
  ('00000000-0000-0000-0000-00000000aa10','py_normal',120000,current_date - 1),('00000000-0000-0000-0000-00000000aa10','py_vip',110000,current_date - 1);
insert into app.estoque_movimentos (deposito_id, produto_id, tipo, quantidade, referencia_tipo, referencia_id) values
  (:'cd','00000000-0000-0000-0000-00000000aa01','entrada_compra',50,'compra','t'),
  (:'cd','00000000-0000-0000-0000-00000000aa02','entrada_compra',40,'compra','t'),
  (:'cd','00000000-0000-0000-0000-00000000aa03','entrada_compra',8,'compra','t');

\echo '== Kits =='
select teste.ok(app.saldo_disponivel(:'cd','00000000-0000-0000-0000-00000000aa10') = 8, 'Kit disponível = componente que acaba primeiro (8 máscaras)');
select teste.falha(format($$insert into app.estoque_movimentos (deposito_id, produto_id, tipo, quantidade) values (%L,'00000000-0000-0000-0000-00000000aa10','entrada_compra',5)$$, :'cd'),
  'não tem estoque próprio', 'Kit não recebe entrada de estoque');
select teste.falha($$insert into app.kit_componentes values ('00000000-0000-0000-0000-00000000aa01','00000000-0000-0000-0000-00000000aa02',1)$$,
  'tipo kit', 'Produto simples não tem componentes');

-- Pedido interno com 5 kits: ao enviar, saem 5 de cada componente
insert into app.pedidos (id, origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total, deposito_id)
  values ('00000000-0000-0000-0000-00000000dd01','manual','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1', current_date, 'GS', 550000, :'cd');
insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario)
  values ('00000000-0000-0000-0000-00000000dd01','00000000-0000-0000-0000-00000000aa10','KIT-PLAT','Kit Platinum',5,110000);
update app.pedidos set status_comercial = 'enviado' where id = '00000000-0000-0000-0000-00000000dd01';
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-00000000aa01') = 45
  and (select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-00000000aa02') = 35
  and (select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-00000000aa03') = 3,
  '5 kits enviados tiram 5 shampoos, 5 condicionadores e 5 máscaras');
select teste.ok(app.saldo_disponivel(:'cd','00000000-0000-0000-0000-00000000aa10') = 3, 'Sobram 3 kits disponíveis');
select teste.ok((select vendido_janela from app.v_giro where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-00000000aa03') = 5,
  'Giro conta a venda do kit em cada componente');

\echo '== Marketplace pelo Bling =='
update app.canais set bling_loja_id = 2001 where codigo = 'shopee';
update app.canais set bling_loja_id = 2002 where codigo = 'mercado_livre';
insert into app.bling_situacoes values (12, 'Cancelado', 'cancelado'), (9, 'Atendido', 'atendido');
insert into app.produto_codigos values ('ANUNCIO-KIT-123', '00000000-0000-0000-0000-00000000aa10');
set role vc_sync;
select teste.como('');
\set SH1 '{"id": 80001, "numero": 5001, "numeroLoja": "SHP-998877", "data": "2026-10-15", "total": 389.90, "loja": {"id": 2001}, "contato": {"id": 1, "nome": "Consumidor"}, "vendedor": {"id": 0}, "situacao": {"id": 9}, "itens": [{"codigo": "ANUNCIO-KIT-123", "descricao": "Kit Platinum", "quantidade": 2, "valor": 159.95}, {"codigo": "SOU-SH", "descricao": "Shampoo Platinum", "quantidade": 1, "valor": 70}, {"codigo": "XYZ-NAO-EXISTE", "descricao": "Brinde", "quantidade": 1, "valor": 0}]}'
select teste.ok(app.bling_upsert_pedido(:'SH1') = 'criado', 'Pedido da Shopee entra pelo Bling');
select teste.ok(app.bling_upsert_pedido(:'SH1') = 'sem_mudanca', 'Ler de novo não duplica nem baixa duas vezes');
reset role;
select id as psh from app.pedidos where bling_id = 80001 \gset
select teste.ok((select canal from app.pedidos where id = :'psh') = 'shopee'
  and (select n.nome from app.pedidos p join app.vendedoras n on n.id = p.vendedora_id where p.id = :'psh') = 'Marketplace'
  and (select moeda from app.pedidos where id = :'psh') = 'BRL'
  and (select numero_externo from app.pedidos where id = :'psh') = 'SHP-998877',
  'Canal Shopee, responsável Marketplace, em reais e com o nº do pedido na Shopee');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-00000000aa01') = 42,
  'Saem 2 shampoos dos kits + 1 avulso (45 - 3 = 42)');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-00000000aa03') = 1,
  'Saem 2 máscaras dos kits (3 - 2 = 1)');
select teste.ok((select count(*) from app.estoque_pendencias where pedido_id = :'psh' and tipo = 'sku_desconhecido' and codigo = 'XYZ-NAO-EXISTE') = 1,
  'Código sem cadastro vira pendência para cadastrar');

set role vc_sync;
\set ML1 '{"id": 80002, "numero": 5002, "numeroLoja": "ML-2000", "data": "2026-10-15", "total": 800, "loja": {"id": 2002}, "contato": {"id": 2}, "vendedor": {"id": 0}, "situacao": {"id": 9}, "itens": [{"codigo": "KIT-PLAT", "quantidade": 4, "valor": 200}]}'
select teste.ok(app.bling_upsert_pedido(:'ML1') = 'criado', 'Pedido do Mercado Livre entra mesmo sem estoque suficiente no sistema');
reset role;
select id as pml from app.pedidos where bling_id = 80002 \gset
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-00000000aa03') = 1,
  'Máscara sem estoque suficiente não fica negativa');
select teste.ok((select count(*) from app.estoque_pendencias where pedido_id = :'pml' and tipo = 'sem_estoque') = 1,
  'A falta vira pendência de estoque para conferir');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-00000000aa01') = 38,
  'Os componentes com estoque saem normalmente (42 - 4 = 38)');

set role vc_sync;
select teste.ok(app.bling_upsert_pedido(jsonb_set(:'SH1'::jsonb, '{situacao,id}', '12')) = 'atualizado', 'Cancelamento no Bling é lido');
reset role;
select teste.ok((select status_comercial from app.pedidos where id = :'psh') = 'cancelado', 'Pedido fica cancelado no sistema');
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-00000000aa01') = 41
  and (select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-00000000aa03') = 3,
  'Mercadoria do pedido cancelado volta ao estoque');
set role vc_sync;
select app.bling_upsert_pedido(jsonb_set(jsonb_set(:'SH1'::jsonb, '{situacao,id}', '12'), '{total}', '389.91'));
reset role;
select teste.ok((select quantidade from app.estoque_saldos where deposito_id = :'cd' and produto_id = '00000000-0000-0000-0000-00000000aa01') = 41,
  'Cancelamento lido de novo não devolve duas vezes');

set role vc_app;
select teste.como('00000000-0000-0000-0000-000000000003');
select teste.ok((select count(*) from app.estoque_pendencias) = 0, 'Vendedora não vê pendências de estoque');
select teste.como(:'GERENTE');
select teste.ok((select count(*) from app.estoque_pendencias where resolvida_em is null) >= 2, 'Gerente vê as pendências');
reset role;
\echo '== Testes de kits e marketplace passaram =='

\echo '== Marcas padronizadas =='
reset role;
insert into app.produtos (codigo, nome, marca) values ('T-MARCA-1', 'Shampoo Teste', '  MAYCRENE ');
select teste.ok((select marca from app.produtos where codigo = 'T-MARCA-1') = 'MAYCRENE', 'Espaços somem e a marca fica em maiúsculas');
update app.produtos set marca = 'phállebeauty' where codigo = 'T-MARCA-1';
select teste.ok((select marca from app.produtos where codigo = 'T-MARCA-1') = 'PHALLEBEAUTY', 'Acento e caixa não criam marca nova');
update app.produtos set marca = 'Marca Nova Qualquer' where codigo = 'T-MARCA-1';
select teste.ok((select marca from app.produtos where codigo = 'T-MARCA-1') = 'MARCA NOVA QUALQUER', 'Marca nova também fica em maiúsculas');
update app.produtos set marca = 'Mary Life' where codigo = 'T-MARCA-1';
select teste.ok((select marca from app.produtos where codigo = 'T-MARCA-1') = 'BIO INSTINTO E MARY LIFE', 'Mary Life vira a marca unificada');
update app.produtos set marca = 'Bio Instinto' where codigo = 'T-MARCA-1';
select teste.ok((select marca from app.produtos where codigo = 'T-MARCA-1') = 'BIO INSTINTO E MARY LIFE', 'Bio Instinto vira a marca unificada');
delete from app.produtos where codigo = 'T-MARCA-1';

\echo '== Unidades: loja de CDE vê só o próprio estoque =='
reset role;
select id as cde from app.depositos where codigo = 'loja-cde' \gset
select teste.ok(not (select tem_estoque from app.vitrine_publica_unidade(:'cde') where produto_id = '00000000-0000-0000-0000-0000000000b2'),
  'Produto só no CD Foz aparece sem estoque no site de CDE');
update app.depositos set mostra_abastecedor = true where id = :'cde';
select teste.ok((select tem_estoque from app.vitrine_publica_unidade(:'cde') where produto_id = '00000000-0000-0000-0000-0000000000b2'),
  'Se a unidade mostrar o CD que a abastece, o produto aparece com estoque');
update app.depositos set mostra_abastecedor = false where id = :'cde';
select teste.ok((select vende_unidade and loja_idioma = 'es' from app.unidades_loja() where codigo = 'loja-cde'), 'CDE vende por unidade e o site abre em espanhol');
set role vc_app;
select teste.como('00000000-0000-0000-0000-000000000003');
select teste.falha(format($$select app.definir_unidades_vendedora('00000000-0000-0000-0000-0000000000a1', array[%L::uuid], %L)$$, :'cde', :'cde'),
  'Só gerente', 'Vendedora não muda as próprias unidades');
reset role;
