import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { COOKIE_CLIENTE, novoToken, sha256 } from "@/lib/portal";

// Links antigos de acesso (uso único). Hoje o cliente entra com documento e senha em /loja/acesso.
// Robôs de pré-visualização (WhatsApp, Facebook, Telegram...) abrem o link antes do cliente:
// para eles não gastamos o convite.
const ROBO = /whatsapp|facebookexternalhit|facebot|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|skypeuripreview|googlebot|bingbot|preview/i;

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (ROBO.test(req.headers.get("user-agent") ?? "")) {
    return new Response("<!doctype html><title>Virtual Cosméticos · Área do cliente</title><meta property=\"og:title\" content=\"Virtual Cosméticos · Área do cliente\">",
      { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
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
