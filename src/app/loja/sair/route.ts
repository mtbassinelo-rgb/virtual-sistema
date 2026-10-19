import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { pool } from "@/lib/db";
import { COOKIE_CLIENTE, sha256 } from "@/lib/portal";

/** Pré-carregamento do Next (Link), do navegador ou de robôs: nunca pode encerrar a sessão do cliente. */
function ehPrecarga(req: Request): boolean {
  const h = req.headers;
  return h.has("next-router-prefetch") || h.has("rsc") || h.get("purpose") === "prefetch"
    || h.get("sec-purpose")?.includes("prefetch") === true || h.get("x-middleware-prefetch") === "1";
}

export async function GET(req: Request) {
  if (ehPrecarga(req)) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  const t = (await cookies()).get(COOKIE_CLIENTE)?.value;
  if (t) await pool.query("select app.portal_sair($1)", [sha256(t)]);
  const r = NextResponse.redirect(new URL("/loja/acesso", req.url), 303);
  r.cookies.set(COOKIE_CLIENTE, "", { path: "/loja", maxAge: 0 });
  r.headers.set("cache-control", "no-store");
  return r;
}
