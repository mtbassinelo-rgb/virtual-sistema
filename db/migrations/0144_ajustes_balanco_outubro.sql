-- Ajustes do balanço de outubro/2026 (informados pelo Mateus em 30/10):
-- 1) aluguel e salários são pagos todo dia 05;
-- 2) salário da Keila é do CD Principal;
-- 3) a compra à vista de R$ 8.786,30 (30/10) é da marca Adeus e fica para novembro, porque a mercadoria só chega lá.

update app.despesas set vencimento = date '2026-10-05', pago_em = date '2026-10-05'
 where categoria in ('aluguel', 'salarios') and competencia = date '2026-10-01' and pago_em = date '2026-10-30';

update app.despesas set deposito_id = (select id from app.depositos where codigo = 'cd-foz')
 where categoria = 'salarios' and competencia = date '2026-10-01' and deposito_id is null
   and (coalesce(fornecedor, '') ilike '%keila%' or descricao ilike '%keila%');

do $$
declare v_forn uuid;
begin
  if not exists (select 1 from app.despesas where descricao = 'Compra à vista 30/10 (chega em novembro)') then return; end if;
  update app.despesas set fornecedor = 'Adeus', descricao = 'Compra Adeus à vista (chega em novembro)', competencia = date '2026-11-01',
         observacao = 'Paga à vista em 30/10; a mercadoria chega em novembro, por isso fica no mês de novembro.'
   where descricao = 'Compra à vista 30/10 (chega em novembro)';
  select id into v_forn from app.fornecedores where nome ilike '%adeus%' order by ativo desc, criado_em limit 1;
  if v_forn is null then
    insert into app.fornecedores (nome) values ('Adeus') on conflict (nome) do nothing;
    select id into v_forn from app.fornecedores where nome = 'Adeus';
  end if;
  if not exists (select 1 from app.compras where fornecedor_id = v_forn and abs(total - 8786.30) <= 1 and data >= date '2026-10-25') then
    insert into app.compras (fornecedor_id, data, valor_produtos, frete, status, deposito_id, observacao)
    values (v_forn, date '2026-11-01', 8786.30, 0, 'a_caminho', (select id from app.depositos where codigo = 'cd-foz'),
            'Paga à vista em 30/10; chega em novembro.');
  end if;
end $$;
