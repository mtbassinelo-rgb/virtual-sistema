import { NextResponse, type NextRequest } from "next/server";
import { mlConectar, sincronizarMarketplaces } from "@/lib/marketplace-api";
import { baseSistema, gestaoLogada, voltarConexoes } from "@/lib/marketplace-rotas";

export const dynamic = "force-dynamic";

/** Volta da autorização do Mercado Livre: troca o código pelos tokens e guarda a conta. */
export async function GET(req: NextRequest) {
  const base = baseSistema(req);
  const u = await gestaoLogada();
  if (!u) return NextResponse.redirect(`${base}/login`);
  const q = req.nextUrl.searchParams;
  const state = req.cookies.get("vc_ml_state")?.value;
  if (!state || state !== q.get("state")) return NextResponse.redirect(voltarConexoes(base, "erro", "Autorização expirada ou inválida. Clique em Conectar de novo."));
  const code = q.get("code");
  if (!code) return NextResponse.redirect(voltarConexoes(base, "erro", q.get("error_description") ?? "O Mercado Livre não autorizou."));
  let destino: string;
  try {
    const nome = await mlConectar(code, `${base}/api/marketplace/ml/retorno`, u.id);
    sincronizarMarketplaces().catch(() => {});
    destino = voltarConexoes(base, "ok", `Mercado Livre conectado (${nome}). Os pedidos começam a chegar em instantes.`);
  } catch (e) {
    destino = voltarConexoes(base, "erro", (e as Error).message);
  }
  const r = NextResponse.redirect(destino);
  r.cookies.delete({ name: "vc_ml_state", path: "/api/marketplace/ml" });
  return r;
}
