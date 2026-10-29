import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { ehGestao, usuarioAtual } from "./auth";

/** Endereço público do sistema (para os retornos do Mercado Livre e da Shopee). */
export function baseSistema(req: NextRequest): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  return `${req.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
}

/** Só gerente ou dono conecta lojas. */
export async function gestaoLogada() {
  const u = await usuarioAtual();
  return u && ehGestao(u) ? u : null;
}

/** Chave do serviço de sincronização (MARKETPLACE_SINC_SEGREDO), para rodar sem usuário logado. */
export function chaveSincronizacao(req: NextRequest): boolean {
  const segredo = process.env.MARKETPLACE_SINC_SEGREDO ?? "";
  const veio = req.nextUrl.searchParams.get("chave") ?? req.headers.get("x-chave") ?? "";
  if (segredo.length < 16 || veio.length !== segredo.length) return false;
  return timingSafeEqual(Buffer.from(veio), Buffer.from(segredo));
}

export const voltarConexoes = (base: string, tipo: "ok" | "erro", msg: string) =>
  `${base}/marketplace/conexoes?${tipo}=${encodeURIComponent(msg)}`;
