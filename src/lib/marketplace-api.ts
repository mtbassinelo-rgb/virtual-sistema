import "server-only";
import { createHmac } from "node:crypto";
import { pool } from "./db";

/**
 * Integração direta com Mercado Livre e Shopee (leitura de pedidos).
 * As chaves dos apps ficam só no servidor (.env): ML_CLIENT_ID, ML_CLIENT_SECRET, SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY.
 * Os tokens de cada loja conectada ficam no banco (app.marketplace_contas), sem leitura pelas telas.
 */

const ML_API = "https://api.mercadolibre.com";
const ML_AUTH = "https://auth.mercadolivre.com.br/authorization";
const SHOPEE = process.env.SHOPEE_HOST || "https://partner.shopeemobile.com";

export const mlConfigurado = () => Boolean(process.env.ML_CLIENT_ID && process.env.ML_CLIENT_SECRET);
export const shopeeConfigurada = () => Boolean(process.env.SHOPEE_PARTNER_ID && process.env.SHOPEE_PARTNER_KEY);

type Conta = { id: string; canal: string; conta_externa: string; access_token: string | null; refresh_token: string | null; expira_em: string | null; sincronizada_em: string | null };
type PedidoMkt = {
  ref: string; pacote?: string | null; data: string; comprador?: string | null; status: string; logistica?: string | null;
  prazo?: string | null; etapa: "a_preparar" | "enviado" | "cancelado"; taxa?: number | null;
  itens: { sku: string | null; alt: string | null; descricao: string; quantidade: number; valor: number | null }[];
};

/** Data no fuso de São Paulo (yyyy-mm-dd). */
function diaSP(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

async function json(r: Response, onde: string) {
  const t = await r.text();
  let b: unknown = null;
  try { b = t ? JSON.parse(t) : null; } catch { /* resposta não-JSON */ }
  if (!r.ok) {
    const m = (b as { message?: string; error?: string } | null);
    throw new Error(`${onde}: ${r.status} ${m?.message ?? m?.error ?? t.slice(0, 200)}`);
  }
  return b as Record<string, unknown>;
}

// ---------------------------------------------------------------- Mercado Livre

export function mlUrlAutorizacao(redirect: string, state: string): string {
  return `${ML_AUTH}?` + new URLSearchParams({ response_type: "code", client_id: process.env.ML_CLIENT_ID ?? "", redirect_uri: redirect, state });
}

async function mlToken(corpo: Record<string, string>) {
  const r = await fetch(`${ML_API}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: process.env.ML_CLIENT_ID ?? "", client_secret: process.env.ML_CLIENT_SECRET ?? "", ...corpo }),
  });
  return (await json(r, "Mercado Livre (token)")) as { access_token: string; refresh_token: string; expires_in: number; user_id: number };
}

export async function mlConectar(code: string, redirect: string, usuario: string): Promise<string> {
  const t = await mlToken({ grant_type: "authorization_code", code, redirect_uri: redirect });
  const eu = await json(await fetch(`${ML_API}/users/me`, { headers: { authorization: `Bearer ${t.access_token}` } }), "Mercado Livre (conta)");
  const nome = String(eu.nickname ?? eu.first_name ?? t.user_id);
  await pool.query("select app.mkt_salvar_conta('mercado_livre', $1, $2, $3, $4, $5, $6, $7)",
    [String(t.user_id), nome, t.access_token, t.refresh_token, t.expires_in, 180 * 86400, usuario]);
  return nome;
}

async function mlGet(path: string, token: string, extra?: Record<string, string>) {
  return json(await fetch(`${ML_API}${path}`, { headers: { authorization: `Bearer ${token}`, ...extra } }), `Mercado Livre ${path.split("?")[0]}`);
}

type MlPedido = {
  id: number; status: string; date_created: string; pack_id?: number | null; buyer?: { nickname?: string };
  shipping?: { id?: number | null }; tags?: string[];
  order_items: { item: { id: string; title: string; seller_sku?: string | null; seller_custom_field?: string | null }; quantity: number; unit_price: number; sale_fee?: number | null }[];
};

const ML_JA_SAIU = new Set(["picked_up", "in_hub", "authorized_by_carrier", "in_packing_list", "in_warehouse", "dropped_off"]);

async function mlConverter(o: MlPedido, token: string): Promise<PedidoMkt | null> {
  if (!["paid", "cancelled", "partially_refunded"].includes(o.status)) return null;     // ainda não pago
  let status = o.status, logistica: string | null = null, prazo: string | null = null;
  let etapa: PedidoMkt["etapa"] = o.status === "cancelled" ? "cancelado" : "a_preparar";
  const envio = o.shipping?.id;
  if (envio && etapa !== "cancelado") {
    const s = await mlGet(`/shipments/${envio}`, token, { "x-format-new": "true" }).catch(() => null) as
      { status?: string; substatus?: string; logistic?: { type?: string }; logistic_type?: string } | null;
    if (s) {
      logistica = s.logistic?.type ?? s.logistic_type ?? null;
      if (logistica === "fulfillment") return null;                                   // Full: sai do armazém do ML
      status = [s.status, s.substatus].filter(Boolean).join(" / ");
      if (s.status === "cancelled") etapa = "cancelado";
      else if (["shipped", "delivered", "not_delivered"].includes(s.status ?? "") || ML_JA_SAIU.has(s.substatus ?? "")) etapa = "enviado";
      if (etapa === "a_preparar") {
        const lt = await mlGet(`/shipments/${envio}/lead_time`, token).catch(() => null) as { estimated_handling_limit?: { date?: string } } | null;
        prazo = lt?.estimated_handling_limit?.date ?? null;
      }
    }
  }
  return {
    ref: String(o.id), pacote: String(o.pack_id ?? envio ?? o.id), data: diaSP(new Date(o.date_created)),
    comprador: o.buyer?.nickname ?? null, status, logistica, prazo, etapa,
    taxa: o.order_items.reduce((s, i) => s + Number(i.sale_fee ?? 0) * Number(i.quantity), 0) || null,
    itens: o.order_items.map((i) => ({
      sku: i.item.seller_sku ?? i.item.seller_custom_field ?? null, alt: i.item.id, descricao: i.item.title,
      quantidade: Number(i.quantity), valor: Number(i.unit_price),
    })),
  };
}

async function mlSincronizar(c: Conta, desde: Date, ids?: string[]): Promise<number> {
  const token = c.access_token!;
  const pedidos: MlPedido[] = [];
  if (ids?.length) {
    for (const id of ids) pedidos.push(await mlGet(`/orders/${id}`, token) as unknown as MlPedido);
  } else {
    for (let offset = 0; offset < 1000; offset += 50) {
      const r = await mlGet(`/orders/search?` + new URLSearchParams({
        seller: c.conta_externa, "order.date_last_updated.from": desde.toISOString(), sort: "date_desc", limit: "50", offset: String(offset),
      }), token) as { results?: MlPedido[]; paging?: { total?: number } };
      pedidos.push(...(r.results ?? []));
      if (!r.results?.length || offset + 50 >= (r.paging?.total ?? 0)) break;
    }
  }
  let n = 0;
  for (const o of pedidos) {
    const p = await mlConverter(o, token);
    if (!p) continue;
    await pool.query("select app.mkt_registrar_pedido($1, $2::jsonb)", [c.id, JSON.stringify(p)]);
    n++;
  }
  return n;
}

async function mlRenovar(c: Conta): Promise<Conta> {
  const t = await mlToken({ grant_type: "refresh_token", refresh_token: c.refresh_token ?? "" });
  await pool.query("select app.mkt_atualizar_token($1, $2, $3, $4, $5)", [c.id, t.access_token, t.refresh_token, t.expires_in, 180 * 86400]);
  return { ...c, access_token: t.access_token, refresh_token: t.refresh_token };
}

// ---------------------------------------------------------------- Shopee

function shopeeAssinar(path: string, ts: number, token = "", shop = ""): string {
  const base = `${process.env.SHOPEE_PARTNER_ID}${path}${ts}${token}${shop}`;
  return createHmac("sha256", process.env.SHOPEE_PARTNER_KEY ?? "").update(base).digest("hex");
}

export function shopeeUrlAutorizacao(redirect: string): string {
  const path = "/api/v2/shop/auth_partner", ts = Math.floor(Date.now() / 1000);
  return `${SHOPEE}${path}?` + new URLSearchParams({ partner_id: process.env.SHOPEE_PARTNER_ID ?? "", timestamp: String(ts), sign: shopeeAssinar(path, ts), redirect });
}

async function shopeePublica(path: string, corpo: Record<string, unknown>) {
  const ts = Math.floor(Date.now() / 1000);
  const r = await fetch(`${SHOPEE}${path}?` + new URLSearchParams({ partner_id: process.env.SHOPEE_PARTNER_ID ?? "", timestamp: String(ts), sign: shopeeAssinar(path, ts) }), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...corpo, partner_id: Number(process.env.SHOPEE_PARTNER_ID) }),
  });
  const b = await json(r, `Shopee ${path}`);
  if (b.error) throw new Error(`Shopee ${path}: ${b.error} ${b.message ?? ""}`);
  return b as { access_token: string; refresh_token: string; expire_in: number };
}

export async function shopeeConectar(code: string, shopId: string, usuario: string): Promise<string> {
  const t = await shopeePublica("/api/v2/auth/token/get", { code, shop_id: Number(shopId) });
  let nome = `Loja ${shopId}`;
  try {
    const info = await shopeeGet("/api/v2/shop/get_shop_info", t.access_token, shopId, {});
    nome = String((info as { shop_name?: string }).shop_name ?? nome);
  } catch { /* nome é só para exibir */ }
  await pool.query("select app.mkt_salvar_conta('shopee', $1, $2, $3, $4, $5, $6, $7)",
    [shopId, nome, t.access_token, t.refresh_token, t.expire_in, 30 * 86400, usuario]);
  return nome;
}

async function shopeeGet(path: string, token: string, shop: string, q: Record<string, string>) {
  const ts = Math.floor(Date.now() / 1000);
  const r = await fetch(`${SHOPEE}${path}?` + new URLSearchParams({
    partner_id: process.env.SHOPEE_PARTNER_ID ?? "", timestamp: String(ts), access_token: token, shop_id: shop,
    sign: shopeeAssinar(path, ts, token, shop), ...q,
  }));
  const b = await json(r, `Shopee ${path}`);
  if (b.error) throw new Error(`Shopee ${path}: ${b.error} ${b.message ?? ""}`);
  return (b.response ?? {}) as Record<string, unknown>;
}

type ShopeePedido = {
  order_sn: string; order_status: string; create_time: number; ship_by_date?: number; buyer_username?: string; fulfillment_flag?: string;
  item_list?: { item_name: string; item_sku?: string; model_sku?: string; model_quantity_purchased: number; model_discounted_price?: number }[];
};

function shopeeConverter(o: ShopeePedido): PedidoMkt | null {
  if (o.order_status === "UNPAID") return null;
  if (o.fulfillment_flag === "fulfilled_by_shopee") return null;                     // Full da Shopee
  const etapa: PedidoMkt["etapa"] = o.order_status === "CANCELLED" ? "cancelado"
    : ["SHIPPED", "TO_CONFIRM_RECEIVE", "COMPLETED", "TO_RETURN"].includes(o.order_status) ? "enviado" : "a_preparar";
  return {
    ref: o.order_sn, pacote: o.order_sn, data: diaSP(new Date(o.create_time * 1000)), comprador: o.buyer_username ?? null,
    status: o.order_status, logistica: null, prazo: o.ship_by_date ? new Date(o.ship_by_date * 1000).toISOString() : null, etapa,
    itens: (o.item_list ?? []).map((i) => ({
      sku: i.model_sku || i.item_sku || null, alt: i.item_sku || null, descricao: i.item_name,
      quantidade: Number(i.model_quantity_purchased), valor: i.model_discounted_price != null ? Number(i.model_discounted_price) : null,
    })),
  };
}

async function shopeeSincronizar(c: Conta, desde: Date): Promise<number> {
  const token = c.access_token!, shop = c.conta_externa;
  const agora = Math.floor(Date.now() / 1000);
  const de = Math.max(Math.floor(desde.getTime() / 1000), agora - 14 * 86400);
  const sns: string[] = [];
  let cursor = "";
  for (let k = 0; k < 50; k++) {
    const r = await shopeeGet("/api/v2/order/get_order_list", token, shop, {
      time_range_field: "update_time", time_from: String(de), time_to: String(agora), page_size: "100", cursor,
    }) as { order_list?: { order_sn: string }[]; more?: boolean; next_cursor?: string };
    sns.push(...(r.order_list ?? []).map((x) => x.order_sn));
    if (!r.more || !r.next_cursor) break;
    cursor = r.next_cursor;
  }
  let n = 0;
  for (let i = 0; i < sns.length; i += 50) {
    const r = await shopeeGet("/api/v2/order/get_order_detail", token, shop, {
      order_sn_list: sns.slice(i, i + 50).join(","),
      response_optional_fields: "buyer_username,item_list,fulfillment_flag",
    }) as { order_list?: ShopeePedido[] };
    for (const o of r.order_list ?? []) {
      const p = shopeeConverter(o);
      if (!p) continue;
      await pool.query("select app.mkt_registrar_pedido($1, $2::jsonb)", [c.id, JSON.stringify(p)]);
      n++;
    }
  }
  return n;
}

async function shopeeRenovar(c: Conta): Promise<Conta> {
  const t = await shopeePublica("/api/v2/auth/access_token/get", { refresh_token: c.refresh_token, shop_id: Number(c.conta_externa) });
  await pool.query("select app.mkt_atualizar_token($1, $2, $3, $4, $5)", [c.id, t.access_token, t.refresh_token, t.expire_in, 30 * 86400]);
  return { ...c, access_token: t.access_token, refresh_token: t.refresh_token };
}

// ---------------------------------------------------------------- Sincronização

let rodando: Promise<{ canal: string; pedidos: number; erro?: string }[]> | null = null;

/** Busca os pedidos de todas as lojas conectadas. Uma rodada por vez (chamadas juntas esperam a mesma). */
export function sincronizarMarketplaces(opcoes: { mlPedidos?: string[]; mlConta?: string } = {}) {
  if (rodando && !opcoes.mlPedidos) return rodando;
  const tarefa = (async () => {
    const contas = (await pool.query("select * from app.mkt_contas_ativas()")).rows as Conta[];
    const res: { canal: string; pedidos: number; erro?: string }[] = [];
    for (let c of contas) {
      if (opcoes.mlPedidos && (c.canal !== "mercado_livre" || (opcoes.mlConta && c.conta_externa !== opcoes.mlConta))) continue;
      try {
        if (c.canal === "mercado_livre" && !mlConfigurado()) continue;
        if (c.canal === "shopee" && !shopeeConfigurada()) continue;
        if (!c.access_token || !c.expira_em || new Date(c.expira_em).getTime() < Date.now() + 5 * 60000) {
          c = c.canal === "mercado_livre" ? await mlRenovar(c) : await shopeeRenovar(c);
        }
        // relê um dia antes da última rodada (pedidos que mudaram de situação); primeira vez: 3 dias
        const desde = new Date((c.sincronizada_em ? new Date(c.sincronizada_em).getTime() - 86400000 : Date.now() - 3 * 86400000));
        const n = c.canal === "mercado_livre" ? await mlSincronizar(c, desde, opcoes.mlPedidos) : await shopeeSincronizar(c, desde);
        if (!opcoes.mlPedidos) await pool.query("select app.mkt_resultado($1, null)", [c.id]);
        res.push({ canal: c.canal, pedidos: n });
      } catch (e) {
        const msg = (e as Error).message;
        await pool.query("select app.mkt_resultado($1, $2)", [c.id, msg]).catch(() => {});
        res.push({ canal: c.canal, pedidos: 0, erro: msg });
      }
    }
    return res;
  })();
  if (!opcoes.mlPedidos) {
    rodando = tarefa;
    tarefa.finally(() => { rodando = null; }).catch(() => {});
  }
  return tarefa;
}
