import { NextResponse, type NextRequest } from "next/server";
import { shopeeConectar, sincronizarMarketplaces } from "@/lib/marketplace-api";
import { baseSistema, gestaoLogada, voltarConexoes } from "@/lib/marketplace-rotas";

export const dynamic = "force-dynamic";

/** Volta da autorização da Shopee (code + shop_id): só vale com gerente/dono logado neste navegador. */
export async function GET(req: NextRequest) {
  const base = baseSistema(req);
  const u = await gestaoLogada();
  if (!u) return NextResponse.redirect(`${base}/login`);
  const q = req.nextUrl.searchParams;
  const code = q.get("code"), shop = q.get("shop_id");
  if (!code || !shop || !/^\d+$/.test(shop)) return NextResponse.redirect(voltarConexoes(base, "erro", "A Shopee não autorizou a loja."));
  try {
    const nome = await shopeeConectar(code, shop, u.id);
    sincronizarMarketplaces().catch(() => {});
    return NextResponse.redirect(voltarConexoes(base, "ok", `Shopee conectada (${nome}). Os pedidos começam a chegar em instantes.`));
  } catch (e) {
    return NextResponse.redirect(voltarConexoes(base, "erro", (e as Error).message));
  }
}
