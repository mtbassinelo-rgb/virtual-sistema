-- Abertura da loja: preço sugerido pela categoria da planilha de preços e limpeza do estoque provisório.
-- A gerência confere na tela "Abertura da loja" e aplica com um clique; nada muda sozinho.
create table app.categorias_preco (
  codigo text primary key, py_normal numeric, py_vip numeric, br_normal numeric, br_vip numeric
);
create table app.regras_categoria (
  ordem serial primary key,
  marca_regex text not null,   -- casa com MARCA + NOME em maiúsculas
  nome_regex text not null,    -- casa com o NOME em maiúsculas
  categoria text not null references app.categorias_preco(codigo)
);
alter table app.categorias_preco enable row level security;
alter table app.regras_categoria enable row level security;
create policy ler on app.categorias_preco for select using (app.uid() is not null);
create policy ler on app.regras_categoria for select using (app.uid() is not null);
grant select on app.categorias_preco, app.regras_categoria to vc_app;

-- PY normal, PY VIP, BR Gold (= br_normal), BR Platinum (= br_vip), da aba Preços de "Distribuidora - Controle Mensal"
insert into app.categorias_preco (codigo, py_normal, py_vip, br_normal, br_vip) values
('RHE-001',7000,6500,4.78,3.59),('RHE-002',11000,10500,9.58,7.19),('RHE-003',11000,10500,7.98,5.99),('RHE-004',7000,6500,4.78,3.59),
('RHE-005',8000,7500,5.10,3.83),('RHE-006',7000,6500,4.78,3.59),('RHE-007',15000,14000,10.22,7.67),('RHE-008',7000,6500,4.78,3.59),
('RHE-009',8000,7500,4.78,3.59),('RHE-010',11000,10500,8.62,6.47),('RHE-011',17000,16000,13.42,10.07),('RHE-012',11000,10500,7.98,5.99),
('RHE-013',33000,31500,27.82,20.87),('RHE-014',35000,34000,31.82,23.87),
('SOU-001',10000,8500,5.16,3.87),('SOU-002',12000,9000,4.98,3.73),('SOU-003',15000,13000,8.53,6.40),('SOU-004',null,null,7.73,5.80),
('SOU-005',15000,13000,9.16,6.87),('SOU-006',15000,13000,7.29,5.47),('SOU-007',20000,17000,12.27,9.20),('SOU-008',20000,17500,11.11,8.33),
('SOU-009',15000,13000,7.73,5.80),('SOU-010',11000,9000,6.04,4.53),('SOU-011',20000,18000,10.49,7.87),('SOU-012',17000,16000,10.13,7.60),
('SOU-013',12000,10000,6.49,4.87),('SOU-033',null,null,6.49,4.87),('SOU-014',15000,13000,8.98,6.73),('SOU-015',27000,25000,20.09,15.07),
('SOU-016',35000,30000,22.58,16.93),('SOU-017',20000,18000,14.58,10.93),('SOU-018',40000,37000,35.38,26.53),('SOU-019',13000,11000,10.49,7.87),
('SOU-020',11000,10000,9.24,6.93),('SOU-021',20000,18000,12.98,9.73),('SOU-022',15000,13000,12.27,9.20),('SOU-023',20000,19000,14.76,11.07),
('SOU-024',17000,16000,10.49,7.87),('SOU-025',15000,13000,12.98,9.73),('SOU-026',15000,13000,12.27,9.20),('SOU-027',10000,9500,7.64,5.73),
('SOU-028',17000,16000,14.22,10.67),('SOU-029',10000,9500,6.04,4.53),('SOU-030',17000,15000,12.18,9.13),('SOU-031',17000,16500,13.16,9.87),
('SOU-032',15000,10000,8.53,6.40),
('MAY-001',33000,33000,36.27,27.20),('MAY-002',37000,35000,36.27,27.20),('MAY-003',12000,11500,10.31,7.73),('MAY-004',12000,11500,10.31,7.73),
('MAY-005',11000,9000,6.76,5.07),('MAY-006',14000,13500,13.87,10.40),('MAY-007',15000,13500,10.31,7.73),('MAY-008',7000,6000,6.76,5.07),
('MAY-009',11000,10000,10.31,7.73),('MAY-010',11000,10000,10.31,7.73),('MAY-011',11000,10000,6.76,5.07),('MAY-012',13000,12000,10.31,7.73),
('MAY-013',16000,15500,13.87,10.40),('MAY-014',null,null,31.64,23.73),('MAY-015',null,null,19.20,14.40),
('NAX-001',28000,26000,22.17,16.63),('NAX-002',10000,9000,6.61,4.96),('NAX-003',12000,11000,11.72,8.79),('NAX-004',15000,13000,13.10,9.83),('NAX-005',15000,13000,12.53,9.40),
('BIO-001',6000,5500,4.41,3.31),('BIO-002',18000,15000,14.56,10.92),('BIO-003',37000,35000,28.50,21.37),('BIO-004',35000,34000,32.59,24.44),
('BIO-005',37000,35000,34.47,25.85),('BIO-006',11000,10000,8.59,6.44),('BIO-007',null,null,18.93,14.20),('BIO-008',18000,17000,14.56,10.92),
('BIO-009',12000,10000,7.70,5.77),('BIO-010',15000,14000,10.88,8.16),('BIO-011',20000,16000,11.29,8.47),('BIO-012',18000,17000,14.36,10.77),
('BIO-013',16000,15000,13.37,10.03),('BIO-014',11000,10000,6.40,4.80),('BIO-015',11000,10000,9.19,6.89),('BIO-016',null,null,13.17,9.88),
('BIO-017',null,null,5.03,3.77),('BIO-018',28000,27000,22.52,16.89),('BIO-019',22000,20000,20.27,15.20),
('FAS-001',17000,16000,15.36,11.52),('FAS-002',18000,17000,17.51,13.13),('FAS-003',25000,24000,26.84,20.13),('FAS-004',16000,15000,15.29,11.47),
('FAS-005',20000,19000,19.86,14.89),('FAS-006',null,null,19.86,14.89),
('FAR-001',10000,9500,8.32,6.24),('FAR-002',12000,11500,10.19,7.64),('CBB-001',null,null,8.89,6.67),
('PHA-001',15000,14000,11.27,8.45),('PHA-002',15000,14000,14.24,10.68),('PHA-003',45000,40000,37.78,28.33),('PHA-004',17000,16000,14.81,11.11),
('PHA-005',12000,11000,10.03,7.52),('PHA-006',30000,28000,25.48,19.11),('PHA-007',14000,13500,11.27,8.45),('PHA-008',20000,19000,18.38,13.79),
('PHA-009',17000,16000,13.42,10.07),('PHA-010',12000,11000,11.27,8.45),('PHA-011',8000,7000,5.94,4.45),('PHA-012',10000,9000,9.49,7.12),
('LUA-001',7500,6000,6.22,4.67),('LUA-002',3300,3000,2.84,2.13),('LUA-003',5500,5000,5.51,4.13),('LUA-004',8000,7000,7.29,5.47),('LUA-005',12000,10000,11.63,8.72),
('SUP-001',8000,7500,8.18,6.13),('SUP-002',6000,5500,5.67,4.25),('SUP-003',6000,5500,4.80,3.60),('SUP-004',8000,7500,5.67,4.25),
('SUP-005',8000,7500,7.45,5.59),('SUP-006',8000,7500,6.22,4.67),('SUP-007',8000,7500,5.67,4.25),('SUP-008',8000,7500,5.67,4.25),
('SUP-009',17000,16000,10.13,7.60),('SUP-010',10000,9500,9.19,6.89),('SUP-011',2000,1800,1.39,1.04),('SUP-012',20000,19000,16.34,12.25),
('SUP-013',10000,9000,6.56,4.92),('SUP-014',12000,11000,10.93,8.20),('SUP-015',17000,16000,12.78,9.59),('SUP-016',10000,9000,6.56,4.92),
('SUP-017',17000,16000,14.52,10.89),('SUP-018',15000,14000,10.12,7.59),('SUP-019',20000,18000,14.54,10.91),('SUP-020',15000,14000,12.75,9.56),
('SEX-001',17000,15000,11.79,8.84),('SEX-002',20000,17000,16.00,12.00),('SEX-003',17000,15000,10.33,7.75),('SEX-004',null,null,4.96,3.72),('SEX-005',null,null,10.12,7.59),
('NEL-001',12000,11000,9.80,7.35),('NEL-002',11500,10500,9.32,6.99),('NEL-003',12500,11500,10.92,8.19),('NEL-004',14000,12000,10.92,8.19),
('MAG-001',null,null,25.67,19.25),('MAG-002',null,null,41.58,31.19),('MAG-003',null,null,58.70,44.03),
('ZAP-001',null,null,49.78,37.33),('ZAP-002',null,null,68.27,51.20),('ZAP-003',null,null,58.84,44.13),('ZAP-004',null,null,101.16,75.87),
('ZAP-005',null,null,58.84,44.13),('ZAP-006',null,null,100.27,75.20),('ZAP-007',null,null,35.56,26.67),('ZAP-008',null,null,61.69,46.27),
('ZAP-009',null,null,44.44,33.33),('ZAP-010',null,null,62.22,46.67),('ZAP-011',null,null,82.13,61.60),('ZAP-012',null,null,43.56,32.67),
('ZAP-013',null,null,23.29,17.47),('ZAP-014',null,null,23.47,17.60),('ZAP-015',null,null,33.24,24.93),
('BON-001',null,null,58.67,44.00),('BON-002',null,null,30.22,22.67),('BON-003',null,null,33.78,25.33),('BON-004',null,null,33.78,25.33),
('BON-005',null,null,117.33,88.00),('BON-006',null,null,46.22,34.67),('BON-007',null,null,58.67,44.00),('BON-008',null,null,28.44,21.33),
('BON-009',null,null,16.00,12.00),('BON-010',null,null,23.11,17.33),('BON-011',null,null,37.33,28.00),('BON-012',null,null,28.44,21.33),
('BON-013',null,null,23.11,17.33),('BON-014',null,null,23.11,17.33),('BON-015',null,null,33.78,25.33),('BON-016',null,null,90.67,68.00),('BON-017',null,null,33.78,25.33),
('PAP-001',null,null,33.60,25.20),('PAP-002',null,null,33.60,25.20),('PAP-003',null,null,49.96,37.47),('PAP-004',null,null,62.76,47.07),('PAP-005',null,null,11.20,8.40),
('HEN-001',null,null,16.00,12.00),
('CAP-001',15000,13000,12.80,9.60),('CAP-002',15000,13000,12.18,9.13),('CAP-003',12000,10000,9.76,7.32);

insert into app.regras_categoria (marca_regex, nome_regex, categoria) values
-- Rhenuks
('RHEN+UKS','KIT CAPILAR|KIT .*(SHAMPOO|CONDICIONADOR)|LISO THERAP|MEU LISO','RHE-014'),
('RHEN+UKS','SKIN ?CARE|SERUM|S[ÉE]RUM','RHE-013'),
('RHEN+UKS','SEBO DE CARNEIRO','RHE-001'),('RHEN+UKS','ESFOLIANTE','RHE-002'),('RHEN+UKS','PIMENTA NEGRA','RHE-004'),
('RHEN+UKS','T[ÔO]NICO|MICELAR','RHE-005'),('RHEN+UKS','[ÍI]NTIMO','RHE-006'),('RHEN+UKS','SPLASH','RHE-007'),
('RHEN+UKS','MOUSSE','RHE-011'),('RHEN+UKS','SABONETE L[ÍI]QUIDO','RHE-012'),('RHEN+UKS','PROTETOR T[ÉE]RMICO|SPRAY','RHE-010'),
('RHEN+UKS','BUMBUM|MICONA','RHE-009'),('RHEN+UKS','^GEL |GEL ','RHE-008'),('RHEN+UKS','HIDRATANTE','RHE-003'),
-- Soul / Babasoul
('SOUL','KIT.*(SOS|SILICONE)','SOU-016'),('SOUL','KIT GLOW','SOU-018'),('SOUL','KIT CAPILAR|KIT ','SOU-015'),
('SOUL','GEL SEXY','SOU-010'),('SOUL','PERFUME DE CALCINHA','SOU-029'),('SOUL','DESODORANTE [ÍI]NTIMO','SOU-031'),
('SOUL','SABONETE [ÍI]NTIMO','SOU-001'),('SOUL','SABONETE FACIAL','SOU-002'),('SOUL','SABONETE CORPORAL','SOU-003'),
('SOUL','MICELAR|T[ÔO]NICO','SOU-004'),('SOUL','BABAMALLOW','SOU-007'),('SOUL','GEL HIDRATANTE.*280|GEL HID.*280','SOU-008'),
('SOUL','GEL HIDRATANTE|GEL HID','SOU-009'),('SOUL','GEL MASSAGEADOR','SOU-033'),('SOUL','GELATINA','SOU-011'),('SOUL','MOUSSE','SOU-012'),
('SOUL','ESFOLIANTE.*250','SOU-014'),('SOUL','ESFOLIANTE','SOU-013'),('SOUL','SPLASH','SOU-017'),
('SOUL','REPARADOR.*30','SOU-020'),('SOUL','REPARADOR','SOU-019'),('SOUL','CAPS|SOUL BELLA','SOU-021'),('SOUL','PROTETOR','SOU-022'),
('SOUL','SELVAGEM','SOU-023'),('SOUL','PERFUME CAPILAR|HAIR SPLASH','SOU-024'),('SOUL','CERA','SOU-025'),('SOUL','GELEIA','SOU-026'),
('SOUL','LIP GLOSS','SOU-027'),('SOUL','OIL SERUM','SOU-028'),('SOUL','LEAVE|PERFECT LISS|SPRAY FINALIZADOR','SOU-030'),
('SOUL','DESEMBARA','SOU-032'),('SOUL','HID.*190|HIDRATANTE.*190','SOU-006'),('SOUL','HID|HIDRATANTE','SOU-005'),
-- Maycrene
('MAYCRENE','CRONOGRAMA','MAY-014'),('MAYCRENE','M[ÁA]SCARA.*1 ?KG','MAY-015'),('MAYCRENE','KIT.*MATIZ','MAY-002'),('MAYCRENE','^KIT|KIT DE','MAY-001'),
('MAYCRENE','REPARADOR.*30','MAY-005'),('MAYCRENE','REPARADOR','MAY-006'),('MAYCRENE','ATIVADOR','MAY-007'),('MAYCRENE','SABONETE FACIAL','MAY-008'),
('MAYCRENE','[ÓO]LEO.*ROSA MOSQUETA','MAY-009'),('MAYCRENE','PEPINO','MAY-010'),('MAYCRENE','SERUM|S[ÉE]RUM','MAY-012'),
('MAYCRENE','ESFOLIANTE','MAY-013'),('MAYCRENE','SEBO|P[ÉE]S','MAY-011'),('MAYCRENE','CREME HIDRATANTE.*500','MAY-003'),('MAYCRENE','CREME HIDRATANTE','MAY-004'),
-- Naxos
('NAXOS','KIT','NAX-001'),('NAXOS','CUT[ÍI]CULA','NAX-002'),('NAXOS','P[ÉE]S','NAX-003'),('NAXOS','LO[ÇC][ÃA]O|HIDRATANTE','NAX-005'),('NAXOS','CREME','NAX-004'),
-- Bio Instinto
('BIO INST|BEBEL','SKIN ?CARE|KIT FACIAL','BIO-005'),('BIO INST|BEBEL','KIT CABELO E CORPO|KIDS.*KIT|KIT KIDS|KIT CAPILAR.*KIDS|INFANTIL','BIO-004'),
('BIO INST|BEBEL','PODOX','BIO-018'),('BIO INST|BEBEL','KIT .*4 ITENS','BIO-003'),('BIO INST|BEBEL','KIT .*2 ITENS','BIO-002'),
('BIO INST|BEBEL','LO[ÇC][ÃA]O MILAGROSA','BIO-001'),('BIO INST|BEBEL','DESODORANTE [ÍI]NTIMO|PERFUME [ÍI]NTIMO','BIO-014'),
('BIO INST|BEBEL','GEL BEIJ|GEL SEXY|MIX GLOW','BIO-011'),('BIO INST|BEBEL','REDUTOR|LIPO','BIO-008'),
('BIO INST|BEBEL','POMADA.*(PREMIUM|GOLD)','BIO-010'),('BIO INST|BEBEL','POMADA|GEL MASSAGEADOR|GEL DESODORANTE MASSAGEADOR','BIO-009'),
('BIO INST|BEBEL','MOUSSE','BIO-013'),('BIO INST|BEBEL','NATUR[ÍI]SSIMO','BIO-017'),('BIO INST|BEBEL','SPLASH','BIO-006'),
('BIO INST|BEBEL','[ÓO]LEO.*50 ?ML','BIO-012'),('BIO INST|BEBEL','[ÓO]LEO|SERUM|S[ÉE]RUM','BIO-019'),('BIO INST|BEBEL','CREME DESODORANTE','BIO-015'),
-- Fashion
('FASHION','SEBO DE CARNEIRO TRADICIONAL','FAS-001'),('FASHION','SEBO','FAS-002'),('FASHION','REPARADOR','FAS-003'),('FASHION','ESFOLIANTE|EXFOLIANTE','FAS-004'),
('FASHION','MAMONA','FAS-005'),('FASHION','LEITE SILICONIZADO','FAS-006'),
('FARMAX','R[ÍI]CINO','FAR-001'),('FARMAX','ROSA MOSQUETA','FAR-002'),('CASTANHA DA [ÍI]NDIA','CASTANHA','CBB-001'),
-- Phallebeauty
('PH[ÁA]LLE','KIT [ÍI]NTIMO','PHA-003'),('PH[ÁA]LLE','CHARLOTTE','PHA-008'),('PH[ÁA]LLE','ESFOLIANTE|EXFOLIANTE','PHA-007'),('PH[ÁA]LLE','FIXADOR','PHA-004'),
('PH[ÁA]LLE','CLAREADOR','PHA-006'),('PH[ÁA]LLE','MOUSSE','PHA-009'),('PH[ÁA]LLE','SERUM|S[ÉE]RUM','PHA-010'),('PH[ÁA]LLE','ARGILA','PHA-011'),
('PH[ÁA]LLE','P[ÓO] ','PHA-012'),('PH[ÁA]LLE','ROSA MOSQUETA','PHA-002'),('PH[ÁA]LLE','SABONETE','PHA-005'),('PH[ÁA]LLE','GEL','PHA-001'),
-- Lua e Neve (unidades; box fica de fora)
('LUA ?& ?NEVE|LUA E NEVE','CANETA','LUA-001'),('LUA ?& ?NEVE|LUA E NEVE','LIP BALM','LUA-002'),('LUA ?& ?NEVE|LUA E NEVE','PICOL','LUA-003'),
('LUA ?& ?NEVE|LUA E NEVE','BLUSH','LUA-004'),('LUA ?& ?NEVE|LUA E NEVE','BASE','LUA-005'),
-- Super Poderes
('SUPER PODERES','LIP OIL','SUP-001'),('SUPER PODERES','CANETA','SUP-002'),('SUPER PODERES','CAKE GLOSS','SUP-003'),('SUPER PODERES','UMEDECIDO','SUP-004'),
('SUPER PODERES','BABASUPER','SUP-006'),('SUPER PODERES','LEN[ÇC]O','SUP-005'),('SUPER PODERES','MICELAR','SUP-007'),('SUPER PODERES','T[ÔO]NICO','SUP-008'),
('SUPER PODERES','FIXADOR','SUP-009'),('SUPER PODERES','PALETA','SUP-010'),('SUPER PODERES','M[ÁA]SCARA','SUP-011'),('SUPER PODERES','[ÓO]LEO DE BANHO','SUP-012'),
('SUPER PODERES','INTELIGENTE','SUP-014'),('SUPER PODERES','BLINDAGEM','SUP-018'),('SUPER PODERES','SABONETE','SUP-013'),('SUPER PODERES','MOUSSE','SUP-015'),
('SUPER PODERES','PERFUME CAPILAR','SUP-016'),('SUPER PODERES','DESODORANTE','SUP-017'),('SUPER PODERES','ESCOVA','SUP-019'),('SUPER PODERES','SPLASH','SUP-020'),
-- Sexy Fantasy
('FANTASY','PHERO','SEX-001'),('FANTASY|SEXY FANTA','GARGANTA','SEX-002'),('FANTASY','C[ÁA]PSULA','SEX-004'),('FANTASY','GOTAS','SEX-005'),('FANTASY','^GEL (?!.*2 ?G\y)','SEX-003'),
-- Nelo
('NELO','HIDRATANTE','NEL-001'),('NELO','SABONETE','NEL-002'),('NELO','ESFOLIANTE','NEL-003'),('NELO','SPLASH','NEL-004'),
-- Magic Color
('MAGIC COLOR','100 ?ML','MAG-001'),('MAGIC COLOR','300 ?ML','MAG-002'),('MAGIC COLOR','500 ?ML','MAG-003'),
-- Zap
('ZAP','ALISAMENTO.*PRETO.*480','ZAP-001'),('ZAP','ALISAMENTO.*PRETO.*1 ?L','ZAP-002'),
('ZAP','ALISAMENTO.*VERDE.*480','ZAP-003'),('ZAP','ALISAMENTO.*VERDE','ZAP-004'),('ZAP','ALISAMENTO.*AZUL.*480','ZAP-005'),('ZAP','(ALISAMENTO|ALL TIME).*AZUL|BLUE','ZAP-006'),
('ZAP','60 SEG','ZAP-007'),('ZAP','BLINTOX','ZAP-008'),('ZAP','ZTOX.*MATIZ','ZAP-010'),('ZAP','ZTOX','ZAP-009'),('ZAP','[ÚU]NICA','ZAP-011'),
('ZAP','VERNIZ','ZAP-012'),('ZAP','SOS','ZAP-014'),('ZAP','KIT .*(SHAMPOO|CONDICIONADOR)','ZAP-015'),('ZAP','M[ÁA]SCARA ME LEVA','ZAP-013'),
-- Bonequinha / Maria Escandalosa / Arfanzi
('BONEQUINHA|ESCANDALOSA|ARFANZI','HIALUR|HIALOLISO','BON-016'),('BONEQUINHA|ESCANDALOSA|ARFANZI','QUERO BRILHO','BON-017'),
('BONEQUINHA|ESCANDALOSA','(KIT|ALISAMENTO).*JAPONES.*300','BON-008'),('BONEQUINHA|ESCANDALOSA','(KIT|ALISAMENTO).*JAPONES','BON-007'),('BONEQUINHA|ESCANDALOSA','BOTOX WHITE','BON-009'),
('BONEQUINHA|ESCANDALOSA','MTOX.*WHITE|MTOX WHITE','BON-003'),('BONEQUINHA|ESCANDALOSA','VIOLET','BON-004'),('BONEQUINHA|ESCANDALOSA','BLACK.*250','BON-010'),
('BONEQUINHA|ESCANDALOSA','BLACK','BON-011'),('BONEQUINHA|ESCANDALOSA','VERNIZ','BON-012'),('BONEQUINHA|ESCANDALOSA','SOS NO CHUVEIRO','BON-013'),
('BONEQUINHA|ESCANDALOSA','RED','BON-014'),('BONEQUINHA|ESCANDALOSA','RESGATE','BON-015'),
('BONEQUINHA','300','BON-002'),('BONEQUINHA','1 ?L|1000','BON-001'),('ESCANDALOSA','300','BON-006'),('ESCANDALOSA','1 ?L|1000','BON-005'),
-- Papel para mecha, henna, Cap Life
('PAPEL','200 FOLHAS','PAP-001'),('PAPEL','120 FOLHAS','PAP-002'),('PAPEL','180 FOLHAS','PAP-003'),('PAPEL','1 ?KG','PAP-004'),('PAPEL','30 FOLHAS','PAP-005'),
('HENNA','HENNA','HEN-001'),('CAP LIFE','MOUSSE','CAP-001'),('CAP LIFE','GELATINA','CAP-002'),('CAP LIFE','HIDRATANTE','CAP-003');

-- Produtos ativos sem nenhum preço e a categoria sugerida (a primeira regra que casa)
create or replace function app.sugestoes_preco()
returns table (produto_id uuid, codigo text, nome text, marca text, categoria text,
               py_normal numeric, py_vip numeric, br_normal numeric, br_vip numeric)
language sql stable security definer set search_path = app, pg_temp as $$
  select p.id, p.codigo, p.nome, p.marca, c.codigo, c.py_normal, c.py_vip, c.br_normal, c.br_vip
    from app.produtos p
    left join lateral (select r.categoria from app.regras_categoria r
                        where upper(coalesce(p.marca,'') || ' ' || p.nome) ~ r.marca_regex and upper(p.nome) ~ r.nome_regex
                        order by r.ordem limit 1) r on true
    left join app.categorias_preco c on c.codigo = r.categoria
   where app.perfil_atual() in ('gerente','dono')
     and p.ativo and p.tipo = 'simples'
     and not exists (select 1 from app.precos z where z.produto_id = p.id)
     and upper(p.nome) !~ '^BOX |^EXPOSITOR|ETIQUETA|CAIXA DE PAPEL|CARRETINHA|^(KIT )?[0-9]+ '
   order by c.codigo nulls last, p.nome
$$;

-- Aplica o preço da categoria sugerida aos produtos escolhidos (só os que continuam sem preço)
create or replace function app.aplicar_sugestoes_preco(p_ids uuid[]) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_linhas jsonb;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono altera preços.' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('codigo', s.codigo, 'tabela', t.tab, 'valor', t.v)), '[]') into v_linhas
    from app.sugestoes_preco() s
    cross join lateral (values ('py_normal', s.py_normal), ('py_vip', s.py_vip), ('br_normal', s.br_normal), ('br_vip', s.br_vip)) t(tab, v)
   where s.produto_id = any(p_ids) and s.categoria is not null and t.v is not null;
  return coalesce((app.importar_precos(v_linhas)->>'alterados')::int, 0);
end $$;

-- Estoque provisório de 240 peças que nenhuma contagem ou importação confirmou
create or replace function app.estoque_provisorio()
returns table (produto_id uuid, deposito_id uuid, codigo text, nome text, saldo numeric)
language sql stable security definer set search_path = app, pg_temp as $$
  select s.produto_id, s.deposito_id, p.codigo, p.nome, s.quantidade
    from app.estoque_saldos s join app.produtos p on p.id = s.produto_id
   where app.perfil_atual() in ('gerente','dono')
     and s.quantidade = 240
     and (select m.observacao from app.estoque_movimentos m
           where m.produto_id = s.produto_id and m.deposito_id = s.deposito_id order by m.em desc limit 1) ilike 'estoque inicial provis%'
   order by p.nome
$$;

create or replace function app.zerar_estoque_provisorio(p_ids uuid[]) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare r record; n int := 0;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono ajusta estoque.' using errcode = 'insufficient_privilege';
  end if;
  for r in select * from app.estoque_provisorio() where produto_id = any(p_ids) loop
    perform app.ajustar_estoque(r.deposito_id, r.produto_id, 0, 'Abertura da loja: estoque provisório de 240 zerado até a contagem');
    n := n + 1;
  end loop;
  return n;
end $$;

grant execute on function app.sugestoes_preco(), app.aplicar_sugestoes_preco(uuid[]), app.estoque_provisorio(),
  app.zerar_estoque_provisorio(uuid[]) to vc_app;
