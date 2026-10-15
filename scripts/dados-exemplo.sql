-- Dados para o AMBIENTE DE TESTE (nunca rodar em produção).
-- Vendedoras e produtos reais; clientes e pedidos são fictícios, marcados como exemplo.

insert into app.vendedoras (nome, pais, moeda, whatsapp) values
  ('Keila', 'PY', 'GS', null), ('Yessica', 'PY', 'GS', null), ('Crislaine', 'BR', 'BRL', null)
on conflict do nothing;

-- Keila e Yessica vendem do CD de Foz; Yessica também da loja de CDE
insert into app.vendedora_depositos (vendedora_id, deposito_id, padrao)
select v.id, d.id, d.codigo = 'cd-foz'
  from app.vendedoras v, app.depositos d
 where (v.nome in ('Keila','Crislaine') and d.codigo = 'cd-foz')
    or (v.nome = 'Yessica')
on conflict do nothing;

-- Produtos e preços do Paraguai (aba Preços da planilha master)
insert into app.produtos (codigo, nome, fornecedor) values
  ('RHE-001','Sebo de Carneiro','Rhenuks'), ('RHE-002','Esfoliantes','Rhenuks'), ('RHE-003','Hidratante Corporal','Rhenuks'),
  ('RHE-004','Pimenta Negra','Rhenuks'), ('RHE-005','Tônico y Agua','Rhenuks'), ('RHE-006','Jabón Íntimo','Rhenuks'),
  ('RHE-007','Body Splash','Rhenuks'), ('RHE-008','Geles Massageadores','Rhenuks'), ('RHE-009','Bumbum y Miconase','Rhenuks'),
  ('RHE-010','Protetor Térmico','Rhenuks'), ('RHE-011','Mousse','Rhenuks')
on conflict (codigo) do nothing;

insert into app.precos (produto_id, tabela, valor, vigente_desde)
select p.id, t.tabela, t.valor, date '2026-01-01'
  from (values
    ('RHE-001',7000,6500),('RHE-002',11000,10500),('RHE-003',11000,10500),('RHE-004',7000,6500),('RHE-005',8000,7500),
    ('RHE-006',7000,6500),('RHE-007',15000,14000),('RHE-008',7000,6500),('RHE-009',8000,7500),('RHE-010',11000,10500),
    ('RHE-011',17000,16000)) as x(codigo, normal, vip)
  join app.produtos p on p.codigo = x.codigo
  cross join lateral (values ('py_normal', x.normal), ('py_vip', x.vip)) as t(tabela, valor)
on conflict do nothing;

-- Estoque inicial de exemplo
insert into app.estoque_movimentos (deposito_id, produto_id, tipo, quantidade, referencia_tipo, referencia_id, observacao)
select d.id, p.id, 'entrada_compra', 120, 'compra', 'EXEMPLO', 'Estoque de exemplo do ambiente de teste'
  from app.depositos d, app.produtos p where d.codigo = 'cd-foz';

-- Clientes e pedidos fictícios
insert into app.clientes (nome, whatsapp, cidade, categoria_preco, vendedora_id, observacoes)
select x.nome, x.whats, x.cidade, x.cat::app.categoria_preco, v.id, 'Cliente de exemplo'
  from (values ('Salão Exemplo A','595981111111','Ciudad del Este','vip','Keila'),
               ('Loja Exemplo B','595982222222','Hernandarias','normal','Keila'),
               ('Revenda Exemplo C','595983333333','Minga Guazú','normal','Yessica')) as x(nome, whats, cidade, cat, vend)
  join app.vendedoras v on v.nome = x.vend;

insert into app.pedidos (origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total, previsao_envio, observacoes)
select 'manual', c.id, c.vendedora_id, current_date - x.dias, 'GS', x.valor, current_date - x.dias + 2, 'Pedido de exemplo'
  from (values ('Salão Exemplo A', 12, 4200000), ('Salão Exemplo A', 3, 2600000),
               ('Loja Exemplo B', 5, 1500000), ('Revenda Exemplo C', 1, 900000)) as x(cliente, dias, valor)
  join app.clientes c on c.nome = x.cliente;
