import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { mlConfigurado, mlUrlAutorizacao } from "@/lib/marketplace-api";
import { baseSistema, gestaoLogada, voltarConexoes } from "@/lib/marketplace-rotas";

export const dynamic = "force-dynamic";

/** Gerente clica em "Conectar Mercado Livre": vai para a autorização do ML (com um código anti-falsificação). */
export async function GET(req: NextRequest) {
  const base = baseSistema(req);
  if (!(await gestaoLogada())) return NextResponse.redirect(`${base}/login`);
  if (!mlConfigurado()) return NextResponse.redirect(voltarConexoes(base, "erro", "Falta configurar ML_CLIENT_ID e ML_CLIENT_SECRET no servidor."));
  const state = randomBytes(16).toString("hex");
  const r = NextResponse.redirect(mlUrlAutorizacao(`${base}/api/marketplace/ml/retorno`, state));
  r.cookies.set("vc_ml_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/marketplace/ml", maxAge: 900 });
  return r;
}
