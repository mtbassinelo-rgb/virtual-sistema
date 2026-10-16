-- Migração 0007: novo status para pedidos feitos pelo cliente na área de atacado.
-- (Fica sozinho porque o Postgres não permite usar um valor novo de enum na mesma transação.)
alter type app.status_comercial add value if not exists 'aguardando_aprovacao' before 'em_separacao';
