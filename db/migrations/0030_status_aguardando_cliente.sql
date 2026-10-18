-- Pedido montado pela vendedora (ex.: conversa no WhatsApp) e enviado ao cliente por link para conferir
-- e confirmar as caixas. Fica sozinho porque o Postgres não deixa usar um valor novo de enum na mesma transação.
alter type app.status_comercial add value if not exists 'aguardando_cliente' before 'aguardando_aprovacao';
