import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_IDIOMA } from "@/lib/idioma";

// Troca o idioma do site e volta para a página de onde a pessoa veio (só dentro do próprio site).
export async function GET(req: NextRequest) {
  const l = req.nextUrl.searchParams.get("l") === "es" ? "es" : "pt";
  let volta = "/loja";
  try {
    const ref = new URL(req.headers.get("referer") ?? "");
    if (ref.host === req.headers.get("host") && ref.pathname.startsWith("/loja")) volta = ref.pathname + ref.search;
  } catch { /* sem referência: volta para o início */ }
  const r = NextResponse.redirect(new URL(volta, req.url), 303);
  r.cookies.set(COOKIE_IDIOMA, l, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return r;
}
