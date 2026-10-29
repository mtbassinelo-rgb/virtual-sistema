import { NextResponse, type NextRequest } from "next/server";
import { assinaturaShopeeCerta, chaveCerta, lerPushShopee, modoTeste, registrarAviso, situacaoShopee, type Detalhes } from "@/lib/marketplace-webhooks";

/**
 * Push da Shopee (Order Status Push, code 3). Endereço cadastrado no console da Shopee Open Platform:
 *   https://app.distribuidoravirtualcosmeticos.com/api/marketplace/shopee/webhook?chave=<MARKETPLACE_WEBHOOK_SEGREDO>
 * (o mesmo texto, inteiro, vai em SHOPEE_PUSH_URL: entra no cálculo da assinatura).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!chaveCerta(req.nextUrl.searchParams.get("chave"))) return new NextResponse(null, { status: 401 });
  const corpo = await req.text(); // corpo bruto: a assinatura é calculada sobre ele, byte a byte
  if (!modoTeste() && !assinaturaShopeeCerta(corpo, req.headers.get("authorization"))) return new NextResponse(null, { status: 401 });

  let b: Record<string, unknown>;
  try { b = JSON.parse(corpo); } catch { return NextResponse.json({ ok: false, motivo: "json inválido" }, { status: 400 }); }
  const lido = lerPushShopee(b);
  if ("recusa" in lido) return NextResponse.json({ ok: true, ignorado: lido.recusa });

  try {
    await registrarAviso({
      canal: "shopee", numero: lido.numero, chave: lido.chave, status: lido.status, situacao: situacaoShopee(lido.status), payload: b,
      // itens do pedido: virão da API (get_order_detail) quando a conexão da loja estiver pronta; no teste, do próprio aviso
      detalhes: modoTeste() ? ((b._teste_detalhes as Detalhes | undefined) ?? null) : null,
    });
  } catch (e) {
    console.error("Webhook Shopee:", (e as Error).message);
  }
  return NextResponse.json({ ok: true });
}
