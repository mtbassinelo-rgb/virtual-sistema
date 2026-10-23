-- =====================================================================
-- Migração 0101: RH (funcionários, salário, comissão, férias, aniversários)
-- e calendário comercial do Brasil e do Paraguai com dicas de vendas
--
-- RH: só gerente e dono veem e editam (salário é dado sensível).
-- Calendário: toda a equipe vê; gerente e dono cadastram eventos e dicas.
-- =====================================================================

create table if not exists app.funcionarios (
  id                 uuid primary key default gen_random_uuid(),
  nome               text not null check (length(trim(nome)) > 1),
  cargo              text,
  pais               app.pais not null default 'BR',
  deposito_id        uuid references app.depositos(id) on delete set null,   -- unidade onde trabalha
  usuario_id         uuid references app.usuarios(id) on delete set null,    -- acesso ao sistema (se tiver)
  vendedora_id       uuid references app.vendedoras(id) on delete set null,  -- liga às regras de comissão
  documento          text,
  whatsapp           text,
  email              text,
  endereco           text,
  data_nascimento    date,
  data_admissao      date not null,
  data_desligamento  date,
  motivo_desligamento text,
  tipo_contrato      text not null default 'clt'
                     check (tipo_contrato in ('clt','experiencia','mei','autonomo','ips','contrato','estagio','informal','outro')),
  jornada            text,
  salario            numeric(14,2) check (salario is null or salario >= 0),
  moeda              app.moeda not null default 'BRL',
  dia_pagamento      int check (dia_pagamento between 1 and 31),
  comissao           text,            -- regra combinada (para quem não é vendedora com regra cadastrada)
  beneficios         text,            -- vale-transporte, alimentação, plano etc.
  dados_pagamento    text,            -- PIX / conta para o salário
  contato_emergencia text,
  observacoes        text,
  ferias_anteriores  int not null default 0 check (ferias_anteriores >= 0),  -- dias já tirados antes de usar o sistema
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  check (data_desligamento is null or data_desligamento >= data_admissao)
);
alter table app.funcionarios enable row level security;
drop policy if exists gerir on app.funcionarios;
create policy gerir on app.funcionarios for all using (app.pode_gerir()) with check (app.pode_gerir());
grant select, insert, update, delete on app.funcionarios to vc_app;
drop trigger if exists auditar on app.funcionarios;
create trigger auditar after insert or update or delete on app.funcionarios for each row execute function app.auditar('id');

create table if not exists app.funcionario_ferias (
  id              uuid primary key default gen_random_uuid(),
  funcionario_id  uuid not null references app.funcionarios(id) on delete cascade,
  inicio          date not null,
  fim             date not null,
  dias            int generated always as (fim - inicio + 1) stored,
  observacao      text,
  criado_por      uuid references app.usuarios(id) default app.uid(),
  criado_em       timestamptz not null default now(),
  check (fim >= inicio)
);
create index if not exists funcionario_ferias_func on app.funcionario_ferias (funcionario_id, inicio);
alter table app.funcionario_ferias enable row level security;
drop policy if exists gerir on app.funcionario_ferias;
create policy gerir on app.funcionario_ferias for all using (app.pode_gerir()) with check (app.pode_gerir());
grant select, insert, update, delete on app.funcionario_ferias to vc_app;
drop trigger if exists auditar on app.funcionario_ferias;
create trigger auditar after insert or update or delete on app.funcionario_ferias for each row execute function app.auditar('id');

-- Dias de férias por ano trabalhado:
--   Brasil (CLT): 30 dias.
--   Paraguai (Código do Trabalho): 12 dias até 5 anos, 18 dias de 5 a 10 anos, 30 dias acima de 10 anos.
create or replace function app.dias_ferias_ano(p_pais app.pais, p_anos int) returns int
language sql immutable as $$
  select case when p_pais = 'BR' then 30
              when p_anos <= 5 then 12
              when p_anos <= 10 then 18
              else 30 end
$$;

-- Situação de cada funcionário: tempo de casa, saldo de férias, prazos e aniversários
create or replace view app.v_rh_funcionarios with (security_invoker = true) as
with base as (
  select f.*,
         coalesce(f.data_desligamento, current_date) as ate,
         (f.ferias_anteriores + (select coalesce(sum(x.dias), 0) from app.funcionario_ferias x where x.funcionario_id = f.id))::int as dias_marcados,
         (f.ferias_anteriores + (select coalesce(sum(x.dias), 0) from app.funcionario_ferias x where x.funcionario_id = f.id and x.inicio <= current_date))::int as dias_gozados,
         (select min(x.inicio) from app.funcionario_ferias x where x.funcionario_id = f.id and x.inicio > current_date) as proximas_ferias,
         exists (select 1 from app.funcionario_ferias x where x.funcionario_id = f.id and current_date between x.inicio and x.fim) as de_ferias
    from app.funcionarios f
), anos as (
  select b.*, extract(year from age(b.ate, b.data_admissao))::int as anos_casa,
         (select coalesce(sum(app.dias_ferias_ano(b.pais, n)), 0) from generate_series(1, extract(year from age(b.ate, b.data_admissao))::int) n)::int as dias_adquiridos
    from base b
), periodo as (
  -- período mais antigo ainda não tirado por completo: adquirido em admissão + n anos, deve ser tirado em até 12 meses
  select a.*,
         (select min(n) from generate_series(1, greatest(a.anos_casa, 1)) n
           where (select coalesce(sum(app.dias_ferias_ano(a.pais, k)), 0) from generate_series(1, n) k) > a.dias_marcados) as periodo_pendente
    from anos a
)
select p.id, p.nome, p.cargo, p.pais, p.deposito_id, p.usuario_id, p.vendedora_id, p.documento, p.whatsapp, p.email,
       p.data_nascimento, p.data_admissao, p.data_desligamento, p.tipo_contrato, p.jornada, p.salario, p.moeda, p.dia_pagamento,
       p.comissao, p.beneficios, p.observacoes, p.ferias_anteriores,
       p.data_desligamento is null as ativo,
       p.anos_casa,
       (p.ate - p.data_admissao) as dias_casa,
       case when p.data_nascimento is not null then extract(year from age(current_date, p.data_nascimento))::int end as idade,
       case when p.data_nascimento is not null then
         (p.data_nascimento + make_interval(years => extract(year from age(current_date - 1, p.data_nascimento))::int + 1))::date end as proximo_aniversario,
       (p.data_admissao + make_interval(years => extract(year from age(current_date - 1, p.data_admissao))::int + 1))::date as proximo_aniversario_casa,
       app.dias_ferias_ano(p.pais, greatest(p.anos_casa, 1)) as dias_ferias_ano,
       p.dias_adquiridos, p.dias_marcados, p.dias_gozados,
       p.dias_adquiridos - p.dias_marcados as saldo_ferias,
       p.proximas_ferias, p.de_ferias,
       case when p.periodo_pendente is not null and p.periodo_pendente <= p.anos_casa
            then (p.data_admissao + make_interval(years => p.periodo_pendente + 1) - interval '1 day')::date end as ferias_limite,
       (p.data_admissao + make_interval(years => greatest(p.anos_casa, 0) + 1))::date as proximo_periodo_em,
       case when p.pais = 'BR' then p.data_admissao + 89 else p.data_admissao + 29 end as fim_experiencia
  from periodo p;
grant select on app.v_rh_funcionarios to vc_app;

-- ---------------------------------------------------------------------
-- Calendário comercial
-- ---------------------------------------------------------------------
create table if not exists app.datas_comerciais (
  id           uuid primary key default gen_random_uuid(),
  pais         text not null check (pais in ('BR','PY','AMBOS')),
  nome         text not null,
  tipo         text not null check (tipo in ('feriado','comemorativa','evento')),
  mes          int check (mes between 1 and 12),      -- data que se repete todo ano
  dia          int check (dia between 1 and 31),
  data         date,                                   -- data de um ano específico (datas móveis e eventos)
  dica         text,
  produtos     text,                                   -- o que oferecer
  antecedencia int not null default 15,                -- quantos dias antes começar a campanha
  ativo        boolean not null default true,
  criado_por   uuid references app.usuarios(id) default app.uid(),
  criado_em    timestamptz not null default now(),
  check ((data is not null) or (mes is not null and dia is not null))
);
create unique index if not exists datas_comerciais_unica on app.datas_comerciais (pais, nome, coalesce(data, make_date(2000, mes, dia)));
alter table app.datas_comerciais enable row level security;
drop policy if exists ler on app.datas_comerciais;
create policy ler on app.datas_comerciais for select using (app.uid() is not null);
drop policy if exists gerir on app.datas_comerciais;
create policy gerir on app.datas_comerciais for all using (app.pode_gerir()) with check (app.pode_gerir());
grant select, insert, update, delete on app.datas_comerciais to vc_app;

-- Ocorrências num intervalo (datas fixas viram a data do ano; móveis/eventos aparecem na própria data)
create or replace function app.calendario_comercial(p_de date, p_ate date)
returns table (id uuid, quando date, pais text, nome text, tipo text, dica text, produtos text, antecedencia int, fixa boolean)
language sql stable security invoker set search_path = app, pg_temp as $$
  select d.id, d.data, d.pais, d.nome, d.tipo, d.dica, d.produtos, d.antecedencia, false
    from app.datas_comerciais d where d.ativo and d.data between p_de and p_ate
  union all
  select d.id, make_date(y, d.mes, least(d.dia, extract(day from (make_date(y, d.mes, 1) + interval '1 month - 1 day'))::int)),
         d.pais, d.nome, d.tipo, d.dica, d.produtos, d.antecedencia, true
    from app.datas_comerciais d
    cross join generate_series(extract(year from p_de)::int, extract(year from p_ate)::int) y
   where d.ativo and d.data is null
     and make_date(y, d.mes, least(d.dia, extract(day from (make_date(y, d.mes, 1) + interval '1 month - 1 day'))::int)) between p_de and p_ate
$$;
grant execute on function app.calendario_comercial(date, date) to vc_app;

-- Datas iniciais (gerente e dono podem editar, desativar e acrescentar)
insert into app.datas_comerciais (pais, nome, tipo, mes, dia, data, antecedencia, dica, produtos) values
-- Ambos os países
('AMBOS','Ano Novo / Año Nuevo','feriado',1,1,null,20,'Começo de ano: clientes repõem estoque depois do Natal. Ofereça kits de reposição e condições para o primeiro pedido do ano.','Kits de reposição, linha de cuidados diários'),
('PY','Día de los Enamorados (San Valentín)','comemorativa',2,14,null,15,'No Paraguai os namorados comemoram em 14 de fevereiro. Kits presenteáveis, perfumes e maquiagem vendem bem. Monte combos "para ela" e "para ele".','Perfumes, body splash, maquiagem, kits presente, linha íntima'),
('AMBOS','Dia Internacional da Mulher','comemorativa',3,8,null,15,'Campanha de autocuidado: skin care, cabelo e maquiagem. Sugira às revendedoras montar cestas para empresas e grupos.','Skin care, maquiagem, kits capilares, perfumes'),
('AMBOS','Dia do Trabalhador / Día del Trabajador','feriado',5,1,null,7,'Feriado nos dois países: antecipe entregas e avise os clientes do expediente.',null),
('AMBOS','Halloween','comemorativa',10,31,null,15,'Maquiagem artística, glitter e cores fortes. Bom para lojas de maquiagem e salões.','Maquiagem, glitter, sombras coloridas, demaquilantes'),
('AMBOS','Natal / Navidad','feriado',12,25,null,45,'A maior data do ano. Kits presente, embalagens prontas e perfumes. Clientes compram estoque de novembro até o dia 20: garanta mercadoria e prazos de entrega.','Kits presente, perfumes, body splash, maquiagem, kits capilares'),
('AMBOS','Réveillon / Fin de Año','comemorativa',12,31,null,20,'Cabelo, unhas e maquiagem para as festas: salões trabalham dobrado. Ofereça progressivas, matizadores e glitter.','Progressivas, matizadores, máscaras, maquiagem, glitter'),
-- Brasil: feriados
('BR','Tiradentes','feriado',4,21,null,5,'Feriado nacional: confira entregas e expediente.',null),
('BR','Independência do Brasil','feriado',9,7,null,5,'Feriado nacional: confira entregas e expediente.',null),
('BR','Nossa Senhora Aparecida / Dia das Crianças','feriado',10,12,null,20,'Feriado e Dia das Crianças: linha infantil (shampoo kids, body splash infantil) e kits mãe e filha.','Linha kids, body splash infantil, kits mãe e filha'),
('BR','Finados','feriado',11,2,null,5,'Feriado nacional: confira entregas e expediente.',null),
('BR','Proclamação da República','feriado',11,15,null,5,'Feriado nacional, perto da Black Friday: programe a campanha antes.',null),
('BR','Dia da Consciência Negra','feriado',11,20,null,15,'Feriado nacional. Boa data para destacar linhas para cabelos cacheados, crespos e pele negra.','Linha cacheados e crespos, cremes de pentear, maquiagem para pele negra'),
-- Brasil: datas comerciais fixas
('BR','Dia do Consumidor','comemorativa',3,15,null,10,'"Black Friday do primeiro semestre": desconto por quantidade ou frete grátis por um dia.','Produtos com estoque parado, kits'),
('BR','Aniversário de Foz do Iguaçu','comemorativa',6,10,null,10,'Data local: ação para clientes de Foz (retirada no CD, brinde).',null),
('BR','Dia dos Namorados','comemorativa',6,12,null,20,'Segunda melhor data do primeiro semestre no Brasil. Perfumes, kits casal, linha íntima e maquiagem.','Perfumes, body splash, kits casal, linha íntima, sensuais'),
('BR','Festa Junina','evento',6,24,null,20,'Mês de festas: maquiagem e cabelo para arraiás, glitter, tranças.','Maquiagem, glitter, finalizadores'),
('BR','Dia do Amigo','comemorativa',7,20,null,10,'Campanha "compre 2, presenteie 1": miniaturas e kits pequenos.','Miniaturas, body splash, kits pequenos'),
('BR','Dia dos Avós','comemorativa',7,26,null,10,'Cuidados para pele madura e cabelos brancos (matizadores).','Hidratantes, matizadores, cremes antissinais'),
('BR','Dia da Beleza','comemorativa',9,9,null,15,'Data perfeita para salões e lojas de cosméticos: promoções de linhas profissionais e kits salão.','Linha profissional, progressivas, kits salão'),
('BR','Dia do Cliente','comemorativa',9,15,null,10,'Agradeça os clientes: brinde acima de um valor, cupom para o próximo pedido, mensagem pelo WhatsApp.',null),
('BR','Dia do Professor','comemorativa',10,15,null,10,'Kits pequenos para presentear professoras.','Kits pequenos, sabonetes, hidratantes'),
-- Brasil: datas móveis 2026 e 2027
('BR','Carnaval','feriado',null,null,'2026-02-16',30,'Maquiagem, glitter, protetor e finalizadores. Salões lotados antes do carnaval.','Glitter, maquiagem, finalizadores, protetor térmico'),
('BR','Carnaval','feriado',null,null,'2027-02-08',30,'Maquiagem, glitter, protetor e finalizadores. Salões lotados antes do carnaval.','Glitter, maquiagem, finalizadores, protetor térmico'),
('BR','Sexta-feira Santa','feriado',null,null,'2026-04-03',5,'Feriado nacional: confira entregas e expediente.',null),
('BR','Sexta-feira Santa','feriado',null,null,'2027-03-26',5,'Feriado nacional: confira entregas e expediente.',null),
('AMBOS','Páscoa / Pascua','comemorativa',null,null,'2026-04-05',20,'Kits presente com chocolate + cosmético, body splash e sabonetes. Combine com revendedoras para cestas.','Kits presente, sabonetes, body splash'),
('AMBOS','Páscoa / Pascua','comemorativa',null,null,'2027-03-28',20,'Kits presente com chocolate + cosmético, body splash e sabonetes. Combine com revendedoras para cestas.','Kits presente, sabonetes, body splash'),
('BR','Dia das Mães','comemorativa',null,null,'2026-05-10',30,'A maior data do primeiro semestre no Brasil. Kits presente, perfumes, skin care e cabelo. Comece a vender para lojistas 30 dias antes.','Kits presente, perfumes, skin care, kits capilares'),
('BR','Dia das Mães','comemorativa',null,null,'2027-05-09',30,'A maior data do primeiro semestre no Brasil. Kits presente, perfumes, skin care e cabelo. Comece a vender para lojistas 30 dias antes.','Kits presente, perfumes, skin care, kits capilares'),
('BR','Corpus Christi','feriado',null,null,'2026-06-04',5,'Ponto facultativo/feriado em muitas cidades: confira entregas.',null),
('BR','Corpus Christi','feriado',null,null,'2027-05-27',5,'Ponto facultativo/feriado em muitas cidades: confira entregas.',null),
('BR','Dia dos Pais','comemorativa',null,null,'2026-08-09',20,'Linha masculina: shampoo 3 em 1, barba, perfumes e kits For Men.','Linha masculina, For Men, perfumes, barba'),
('BR','Dia dos Pais','comemorativa',null,null,'2027-08-08',20,'Linha masculina: shampoo 3 em 1, barba, perfumes e kits For Men.','Linha masculina, For Men, perfumes, barba'),
('AMBOS','Black Friday','comemorativa',null,null,'2026-11-27',30,'Planeje com antecedência: escolha produtos com margem e estoque, kits exclusivos e desconto por quantidade. Shopee e ML também.','Kits, estoque parado, mais vendidos'),
('AMBOS','Black Friday','comemorativa',null,null,'2027-11-26',30,'Planeje com antecedência: escolha produtos com margem e estoque, kits exclusivos e desconto por quantidade. Shopee e ML também.','Kits, estoque parado, mais vendidos'),
('AMBOS','Cyber Monday','comemorativa',null,null,'2026-11-30',7,'Estenda a Black Friday no online (site, Shopee e ML).',null),
('AMBOS','Cyber Monday','comemorativa',null,null,'2027-11-29',7,'Estenda a Black Friday no online (site, Shopee e ML).',null),
-- Paraguai: feriados
('PY','Aniversário de Ciudad del Este','comemorativa',2,3,null,10,'Data local da loja CDE: ação especial para clientes de CDE.',null),
('PY','Día de la Mujer Paraguaya','comemorativa',2,24,null,10,'Data muito lembrada no Paraguai: homenagem às clientes, kits de autocuidado.','Skin care, perfumes, kits'),
('PY','Día de los Héroes','feriado',3,1,null,5,'Feriado nacional (pode ser trasladado para segunda): confira entregas e expediente.',null),
('PY','Día del Maestro','comemorativa',4,30,null,10,'Kits pequenos para presentear professoras.','Kits pequenos, sabonetes, hidratantes'),
('PY','Independencia (14 de mayo)','feriado',5,14,null,5,'Feriado nacional: confira entregas e expediente.',null),
('PY','Independencia / Día de la Madre','feriado',5,15,null,30,'No Paraguai o Dia das Mães é fixo em 15 de maio (e feriado). É a maior data do semestre: kits presente, perfumes, skin care.','Kits presente, perfumes, skin care, kits capilares'),
('PY','Paz del Chaco','feriado',6,12,null,5,'Feriado nacional (pode ser trasladado): confira entregas e expediente.',null),
('PY','Noche de San Juan','evento',6,23,null,15,'Festas de San Juan: maquiagem e cabelo para as festas.','Maquiagem, glitter, finalizadores'),
('PY','Día del Amigo','comemorativa',7,30,null,10,'Data forte no Paraguai: miniaturas, body splash e kits pequenos para presentear amigas.','Miniaturas, body splash, kits pequenos'),
('PY','Fundación de Asunción','feriado',8,15,null,5,'Feriado nacional: confira entregas e expediente.',null),
('PY','Día del Niño','comemorativa',8,16,null,15,'Linha infantil e kits mãe e filha.','Linha kids, body splash infantil'),
('PY','Día de la Juventud / Primavera','comemorativa',9,21,null,15,'Primavera e Dia da Juventude: maquiagem colorida, body splash, cuidados para pele jovem (acne).','Maquiagem, body splash, sabonete antiacne, skin care'),
('PY','Victoria de Boquerón','feriado',9,29,null,5,'Feriado nacional (pode ser trasladado): confira entregas e expediente.',null),
('PY','Virgen de Caacupé','feriado',12,8,null,7,'Feriado nacional, começo forte das vendas de fim de ano: estoque reforçado.',null),
-- Paraguai: datas móveis 2026 e 2027
('PY','Jueves y Viernes Santo','feriado',null,null,'2026-04-02',7,'Semana Santa: feriado de quinta e sexta. Antecipe entregas e avise os clientes.',null),
('PY','Jueves y Viernes Santo','feriado',null,null,'2027-03-25',7,'Semana Santa: feriado de quinta e sexta. Antecipe entregas e avise os clientes.',null),
('PY','Día del Padre','comemorativa',null,null,'2026-06-14',20,'No Paraguai é o segundo domingo de junho. Linha masculina e kits For Men.','Linha masculina, For Men, perfumes, barba'),
('PY','Día del Padre','comemorativa',null,null,'2027-06-13',20,'No Paraguai é o segundo domingo de junho. Linha masculina e kits For Men.','Linha masculina, For Men, perfumes, barba')
on conflict do nothing;
