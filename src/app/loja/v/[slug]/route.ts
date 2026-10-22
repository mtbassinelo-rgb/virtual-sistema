import { redirecionar } from "@/lib/redirecionar";
import { type NextRequest } from "next/server";
import { COOKIE_VENDEDORA } from "@/lib/vendedora-link";

// Link de vendas de cada vendedora: o visitante que entra por aqui fala com ela e o cadastro/pedido vai para a carteira dela.
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = redirecionar("/loja");
  if (/^[a-z0-9-]{2,30}$/i.test(slug)) {
    r.cookies.set(COOKIE_VENDEDORA, slug.toLowerCase(), { path: "/", maxAge: 60 * 60 * 24 * 60, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  }
  return r;
}
