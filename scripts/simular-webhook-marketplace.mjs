#!/usr/bin/env node
// Simula avisos da Shopee e do Mercado Livre para testar a área do estoquista ao vivo (ambiente teste).
// Uso:
//   node scripts/simular-webhook-marketplace.mjs <endereço> <chave> <tipo> [número]
//   tipos: ml | shopee | shopee-cancelar | ml-cancelar
// Ex.: node scripts/simular-webhook-marketplace.mjs https://teste.distribuidoravirtualcosmeticos.com SEGREDO_TESTE shopee
// Com SHOPEE_PARTNER_KEY definida, assina o aviso da Shopee como a Shopee faz (testa a conferência da assinatura).
import { createHmac } from "node:crypto";

const [base, chave, tipo = "shopee", numeroArg] = process.argv.slice(2);
if (!base || !chave) { console.error("Uso: node scripts/simular-webhook-marketplace.mjs <endereço> <chave> <ml|shopee|shopee-cancelar|ml-cancelar> [número]"); process.exit(1); }
const agora = Math.floor(Date.now() / 1000);
const itens = [
  { sku: "TESTE-001", descricao: "Creme de teste 500g", quantidade: 2, valor: 29.9 },
  { sku: "TESTE-KIT", descricao: "Kit de teste (3 itens)", quantidade: 1, valor: 79.9 },
];

let url, corpo;
if (tipo.startsWith("shopee")) {
  const numero = numeroArg ?? `TESTE${agora}`;
  url = `${base}/api/marketplace/shopee/webhook?chave=${encodeURIComponent(chave)}`;
  corpo = JSON.stringify({
    shop_id: Number(process.env.SHOPEE_SHOP_ID ?? 0) || 123456, code: 3, timestamp: agora,
    data: { ordersn: numero, status: tipo === "shopee-cancelar" ? "CANCELLED" : "READY_TO_SHIP", update_time: agora },
    _teste_detalhes: { comprador: "comprador_teste", itens, total: 139.7 },
  });
} else {
  const numero = numeroArg ?? String(2000000000 + (agora % 1000000));
  url = `${base}/api/marketplace/mercadolivre/webhook?chave=${encodeURIComponent(chave)}`;
  corpo = JSON.stringify({
    _id: `teste-${agora}`, resource: `/orders/${numero}`, user_id: Number(process.env.ML_USER_ID ?? 0) || 123456789, topic: "orders_v2",
    application_id: Number(process.env.ML_APP_ID ?? 0) || 1, attempts: 1, sent: new Date().toISOString(), received: new Date().toISOString(),
    _teste_status: tipo === "ml-cancelar" ? "cancelled" : "paid", _teste_detalhes: { comprador: "COMPRADOR.TESTE", itens, total: 139.7 },
  });
}

const headers = { "Content-Type": "application/json" };
if (tipo.startsWith("shopee") && process.env.SHOPEE_PARTNER_KEY) {
  headers.Authorization = createHmac("sha256", process.env.SHOPEE_PARTNER_KEY).update(`${process.env.SHOPEE_PUSH_URL ?? url}|${corpo}`).digest("hex");
}
const r = await fetch(url, { method: "POST", headers, body: corpo });
console.log(r.status, await r.text());
console.log("Corpo enviado:", corpo);
