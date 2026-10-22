import { redirecionar } from "@/lib/redirecionar";
import { type NextRequest } from "next/server";
import { COOKIE_UNIDADE_SISTEMA } from "@/lib/unidade-sistema";

// Troca a unidade do topo do sistema (CD Foz, CDE ou todas) e volta para a mesma página.
export async function GET(req: NextRequest) {
  const d = req.nextUrl.searchParams.get("d") ?? "";
  let volta = "/";
  try {
    const ref = new URL(req.headers.get("referer") ?? "");
    if ([req.headers.get("x-forwarded-host"), req.headers.get("host")].includes(ref.host)) volta = ref.pathname + ref.search;
  } catch { /* sem referência: vai para o início */ }
  const r = redirecionar(volta);
  if (/^[0-9a-f-]{36}$/i.test(d)) r.cookies.set(COOKIE_UNIDADE_SISTEMA, d, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  else r.cookies.delete(COOKIE_UNIDADE_SISTEMA);
  return r;
}
