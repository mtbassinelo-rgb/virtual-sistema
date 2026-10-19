import { NextResponse, type NextRequest } from "next/server";

/** Passa o caminho aberto para o servidor (as permissões por área conferem por ele). Sobrescreve o que vier do navegador. */
export function middleware(req: NextRequest) {
  const h = new Headers(req.headers);
  h.set("x-caminho", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: h } });
}

export const config = { matcher: ["/((?!_next/|loja|fotos/|marca/|banners/|favicon|robots.txt|sitemap.xml).*)"] };
