-- A compra Adeus de 23/09 (R$ 4.340 com frete) foi paga em 23/09, não em outubro.
update app.despesas set vencimento = date '2026-09-23', pago_em = date '2026-09-23', competencia = date '2026-09-01',
       observacao = 'Compra de 23/09 paga em 23/09 (informado pelo Mateus em 30/10).'
 where descricao = 'Compra Adeus de 23/09 (com frete)' and valor = 4340;
