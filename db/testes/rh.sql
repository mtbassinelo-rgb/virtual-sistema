-- Testes do RH (salário só para gestão; cálculo de férias) e do calendário comercial.
\set QUIET on
reset role;
\set KEILA    '00000000-0000-0000-0000-000000000003'
\set GERENTE  '00000000-0000-0000-0000-000000000002'
\echo '== RH =='
set role vc_app;
select teste.como(:'GERENTE');
insert into app.funcionarios (id, nome, pais, data_admissao, salario) values
  ('00000000-0000-0000-0000-00000000f001', 'Ana Brasil', 'BR', current_date - interval '3 years' - interval '10 days', 2500),
  ('00000000-0000-0000-0000-00000000f002', 'Rosa Paraguai', 'PY', current_date - interval '6 years' - interval '10 days', 3500000);
insert into app.funcionario_ferias (funcionario_id, inicio, fim) values ('00000000-0000-0000-0000-00000000f001', current_date - 700, current_date - 671);
select teste.ok((select saldo_ferias from app.v_rh_funcionarios where id = '00000000-0000-0000-0000-00000000f001') = 60,
  'Brasil: 3 anos = 90 dias, 30 tirados, saldo 60');
select teste.ok((select ferias_limite < current_date from app.v_rh_funcionarios where id = '00000000-0000-0000-0000-00000000f001'),
  'Brasil: segundo período não tirado em 12 meses aparece como vencido');
select teste.ok((select dias_adquiridos from app.v_rh_funcionarios where id = '00000000-0000-0000-0000-00000000f002') = 78,
  'Paraguai: 5 anos x 12 dias + 1 ano x 18 dias = 78');
select teste.como(:'KEILA');
select teste.ok((select count(*) from app.funcionarios) = 0, 'Vendedora não vê salários nem fichas');
select teste.falha($$insert into app.funcionarios (nome, data_admissao) values ('X', current_date)$$, 'row-level security', 'Vendedora não cadastra funcionário');
\echo '== Calendário =='
select teste.ok((select count(*) from app.calendario_comercial(make_date(2026, 5, 1), make_date(2026, 5, 31)) where nome like '%Mães%' or nome like '%Madre%') = 2,
  'Maio de 2026 tem Dia das Mães do Brasil (10) e do Paraguai (15)');
select teste.falha($$insert into app.datas_comerciais (pais, nome, tipo, mes, dia) values ('BR','X','evento',1,1)$$, 'row-level security', 'Vendedora não edita o calendário');
reset role;
\echo '== Testes de RH passaram =='
