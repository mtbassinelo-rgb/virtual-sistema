import { NextResponse, type NextRequest } from "next/server";
import { sincronizarMarketplaces } from "@/lib/marketplace-api";

export const dynamic = "force-dynamic";

/**
 * Avisos do Mercado Livre (tópico orders_v2). Responde na hora (o ML exige < 500 ms) e busca o pedido em seguida.
 * Não confia no conteúdo do aviso: só usa o número para buscar o pedido na API com o token da própria loja.
 */
export async function POST(req: NextRequest) {
  try {
    const b = await req.json() as { topic?: string; resource?: string; user_id?: number };
    const id = (b.resource ?? "").match(/\/orders\/(\d+)/)?.[1];
    if (b.topic?.startsWith("orders") && id) sincronizarMarketplaces({ mlPedidos: [id], mlConta: String(b.user_id ?? "") }).catch(() => {});
  } catch { /* aviso inválido: ignora */ }
  return NextResponse.json({ ok: true });
}
