import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "./db";

/**
 * Avisos (webhooks) da Shopee e do Mercado Livre → fila ao vivo do estoquista.
 * Regras: responder 200 rápido; nunca confiar só no conteúdo do aviso (o pedido é relido na API quando há token);
 * o mesmo aviso repetido não entra duas vezes (app.marketplace_avisos).
 */
export type Situacao = "a_separar" | "aguardando" | "cancelado" | null;
export type Detalhes = { comprador?: string | null; itens?: { sku: string; descricao?: string | null; quantidade: number; valor?: number | null }[]; total?: number | null; enviar_ate?: string | null };
export type AvisoMarketplace = { canal: "shopee" | "mercado_livre"; numero: string; chave: string; status: string | null; situacao: Situacao; payload: unknown; detalhes: Detalhes | null };

const iguais = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Modo de teste (só no ambiente teste): aceita aviso sem assinatura da Shopee e itens de exemplo em "_teste_detalhes". */
export const modoTeste = () => process.env.MARKETPLACE_WEBHOOK_TESTE === "1";

/** Chave secreta no endereço do webhook (?chave=...). O Mercado Livre não assina os avisos: esta é a primeira barreira. */
export function chaveCerta(chave: string | null): boolean {
  const segredo = process.env.MARKETPLACE_WEBHOOK_SEGREDO ?? "";
  return segredo.length >= 16 && !!chave && iguais(chave, segredo);
}

export async function registrarAviso(a: AvisoMarketplace): Promise<number | null> {
  const r = await pool.query("select app.marketplace_receber($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) id",
    [a.canal, a.numero, a.chave, a.status, a.situacao, JSON.stringify(a.payload ?? {}), a.detalhes ? JSON.stringify(a.detalhes) : null]);
  return r.rows[0]?.id ?? null;
}

// ---------------------------------------------------------------- Mercado Livre
// Aviso: {"_id","resource":"/orders/2000001","user_id":123,"topic":"orders_v2","application_id":456,"attempts":1,"sent":"…","received":"…"}
type AvisoML = { _id?: string; resource?: string; user_id?: number | string; topic?: string; application_id?: number | string; sent?: string; attempts?: number };

/** Confere se o aviso é do nosso app e da nossa conta. Devolve o número do pedido ou o motivo da recusa. */
export function lerAvisoML(corpo: unknown): { numero: string } | { recusa: string } {
  const b = (corpo ?? {}) as AvisoML;
  if (!["orders_v2", "orders"].includes(String(b.topic ?? ""))) return { recusa: "tópico ignorado" };
  const app = process.env.ML_APP_ID, conta = process.env.ML_USER_ID;
  if (app && String(b.application_id) !== app) return { recusa: "application_id diferente" };
  if (conta && String(b.user_id) !== conta) return { recusa: "user_id diferente" };
  const m = String(b.resource ?? "").match(/\/orders\/(\d+)/);
  return m ? { numero: m[1] } : { recusa: "resource sem pedido" };
}

export function situacaoML(status: string | null | undefined): Situacao {
  switch (status) {
    case "paid": return "a_separar";
    case "confirmed": case "payment_required": case "payment_in_process": case "partially_paid": return "aguardando";
    case "cancelled": case "invalid": return "cancelado";
    default: return null;
  }
}

/**
 * Relê o pedido na API do Mercado Livre (a fonte da verdade, não o aviso).
 * ML_ACCESS_TOKEN vale 6 horas: enquanto a conexão OAuth com renovação automática não estiver pronta, sem token o pedido
 * entra na fila só com o número e a situação fica "a separar".
 */
export async function buscarPedidoML(numero: string): Promise<{ status: string | null; detalhes: Detalhes } | null> {
  const token = process.env.ML_ACCESS_TOKEN;
  if (!token) return null;
  const r = await fetch(`https://api.mercadolibre.com/orders/${encodeURIComponent(numero)}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000), cache: "no-store",
  });
  if (!r.ok) throw new Error(`Mercado Livre respondeu ${r.status} ao ler o pedido ${numero}`);
  const o = await r.json() as {
    status?: string; total_amount?: number; buyer?: { nickname?: string };
    order_items?: { item?: { title?: string; seller_sku?: string | null; seller_custom_field?: string | null; id?: string }; quantity?: number; unit_price?: number }[];
  };
  return {
    status: o.status ?? null,
    detalhes: {
      comprador: o.buyer?.nickname ?? null,
      total: o.total_amount ?? null,
      itens: (o.order_items ?? []).map((i) => ({
        sku: (i.item?.seller_sku || i.item?.seller_custom_field || i.item?.id || "").trim(),
        descricao: i.item?.title ?? null, quantidade: Number(i.quantity ?? 0), valor: i.unit_price ?? null,
      })),
    },
  };
}

// ---------------------------------------------------------------- Shopee
// Push de status do pedido (code 3): {"shop_id":123,"code":3,"timestamp":1730000000,"data":{"ordersn":"2410…","status":"READY_TO_SHIP","update_time":1730000000}}

/**
 * Assinatura do push da Shopee: cabeçalho Authorization = HMAC-SHA256 (hex) de "URL do webhook|corpo bruto", com a partner key.
 * A URL é a cadastrada no painel da Shopee (SHOPEE_PUSH_URL), não a interna atrás do Caddy.
 * CONFIRMAR no console da Shopee Open Platform (Push Mechanism) antes de ativar.
 */
export function assinaturaShopeeCerta(corpo: string, assinatura: string | null): boolean {
  const chave = process.env.SHOPEE_PARTNER_KEY ?? "", url = process.env.SHOPEE_PUSH_URL ?? "";
  if (!chave || !url || !assinatura) return false;
  const esperado = createHmac("sha256", chave).update(`${url}|${corpo}`).digest("hex");
  return iguais(assinatura.trim().toLowerCase(), esperado);
}

type PushShopee = { shop_id?: number | string; code?: number; timestamp?: number; data?: { ordersn?: string; status?: string; update_time?: number } };

export function lerPushShopee(corpo: unknown): { numero: string; status: string; chave: string } | { recusa: string } {
  const b = (corpo ?? {}) as PushShopee;
  if (Number(b.code) !== 3) return { recusa: "push ignorado (não é status de pedido)" };
  const loja = process.env.SHOPEE_SHOP_ID;
  if (loja && String(b.shop_id) !== loja) return { recusa: "shop_id diferente" };
  const numero = String(b.data?.ordersn ?? "").trim(), status = String(b.data?.status ?? "").trim();
  if (!numero) return { recusa: "push sem ordersn" };
  return { numero, status, chave: `${numero}|${status}|${b.data?.update_time ?? b.timestamp ?? ""}` };
}

export function situacaoShopee(status: string): Situacao {
  switch (status) {
    case "READY_TO_SHIP": return "a_separar";
    case "UNPAID": return "aguardando";
    case "CANCELLED": return "cancelado";
    default: return null; // PROCESSED, SHIPPED, COMPLETED, IN_CANCEL, TO_RETURN…: mantém a situação, só atualiza o status
  }
}
