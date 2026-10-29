import { NextResponse, type NextRequest } from "next/server";
import { sincronizarMarketplaces } from "@/lib/marketplace-api";
import { chaveSincronizacao, gestaoLogada } from "@/lib/marketplace-rotas";

export const dynamic = "force-dynamic";

/** Busca os pedidos das lojas conectadas. Chamado a cada poucos minutos pelo serviço do servidor (com a chave). */
export async function GET(req: NextRequest) {
  if (!chaveSincronizacao(req) && !(await gestaoLogada())) return new NextResponse(null, { status: 401 });
  const r = await sincronizarMarketplaces();
  return NextResponse.json({ ok: true, contas: r });
}
