import { after, NextResponse, type NextRequest } from "next/server";
import { buscarPedidoML, chaveCerta, lerAvisoML, modoTeste, registrarAviso, situacaoML, type Detalhes } from "@/lib/marketplace-webhooks";

/**
 * Avisos do Mercado Livre (tópico orders_v2). Endereço cadastrado no app do ML:
 *   https://app.distribuidoravirtualcosmeticos.com/api/marketplace/mercadolivre/webhook?chave=<MARKETPLACE_WEBHOOK_SEGREDO>
 * O ML exige 200 em até 500 ms: responde na hora e relê o pedido na API depois (after).
 * O ML não assina o aviso: valem a chave no endereço, application_id/user_id e a releitura do pedido com o nosso token.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!chaveCerta(req.nextUrl.searchParams.get("chave"))) return new NextResponse(null, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, motivo: "json inválido" }, { status: 400 }); }

  const lido = lerAvisoML(b);
  // 200 mesmo quando ignora: senão o ML fica reenviando por 1 hora
  if ("recusa" in lido) return NextResponse.json({ ok: true, ignorado: lido.recusa });

  after(async () => {
    let status: string | null = null, detalhes: Detalhes | null = null;
    try {
      const api = await buscarPedidoML(lido.numero);
      if (api) ({ status, detalhes } = api);
    } catch (e) {
      console.error("Webhook ML:", (e as Error).message);
    }
    if (!detalhes && modoTeste()) {
      status = typeof b._teste_status === "string" ? b._teste_status : "paid";
      detalhes = (b._teste_detalhes as Detalhes | undefined) ?? null;
    }
    try {
      await registrarAviso({
        canal: "mercado_livre", numero: lido.numero,
        chave: String(b._id ?? `${b.resource}|${b.sent ?? ""}|${b.attempts ?? ""}`),
        status, situacao: situacaoML(status), payload: b, detalhes,
      });
    } catch (e) {
      console.error("Webhook ML (gravar):", (e as Error).message);
    }
  });
  return NextResponse.json({ ok: true });
}
