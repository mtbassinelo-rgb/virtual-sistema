import { NextResponse, type NextRequest } from "next/server";
import { shopeeConfigurada, shopeeUrlAutorizacao } from "@/lib/marketplace-api";
import { baseSistema, gestaoLogada, voltarConexoes } from "@/lib/marketplace-rotas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = baseSistema(req);
  if (!(await gestaoLogada())) return NextResponse.redirect(`${base}/login`);
  if (!shopeeConfigurada()) return NextResponse.redirect(voltarConexoes(base, "erro", "Falta configurar SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY no servidor."));
  return NextResponse.redirect(shopeeUrlAutorizacao(`${base}/api/marketplace/shopee/retorno`));
}
