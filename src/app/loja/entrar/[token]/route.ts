import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { COOKIE_CLIENTE, novoToken, sha256 } from "@/lib/portal";

// O cliente abre o link recebido no WhatsApp: troca o convite (uso único) por uma sessão.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sessao = novoToken();
  const { rows } = await pool.query("select app.portal_entrar($1, $2) as ok", [sha256(token), sha256(sessao)]);
  if (!rows[0]?.ok) return NextResponse.redirect(new URL("/loja/acesso?motivo=link", req.url), 303);
  const r = NextResponse.redirect(new URL("/loja", req.url), 303);
  r.cookies.set(COOKIE_CLIENTE, sessao, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/loja", maxAge: 90 * 86400,
  });
  return r;
}
