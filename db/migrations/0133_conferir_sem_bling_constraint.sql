-- Correção da 0123: confirmar pagamento sem nº do Bling esbarrava na regra antiga
-- (conferido exigia nº do Bling ou conta bancária). Agora basta quem conferiu e quando (conferido_completo).
alter table app.pagamentos drop constraint if exists conferido_tem_bling;
