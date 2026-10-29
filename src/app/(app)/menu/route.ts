import type { NextRequest } from "next/server";
import { redirecionar } from "@/lib/redirecionar";

/** Liga/desliga o menu completo (o menu simples por função é o padrão). Volta para a mesma tela. */
export async function GET(req: NextRequest) {
  const completo = req.nextUrl.searchParams.get("completo") === "1";
  let destino = "/";
  try { const ref = req.headers.get("referer"); if (ref) { const r = new URL(ref); destino = r.pathname + r.search; } } catch { /* fica no início */ }
  if (destino.startsWith("/menu")) destino = "/";
  const res = redirecionar(destino);
  res.cookies.set("menu_completo", completo ? "1" : "0", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}
