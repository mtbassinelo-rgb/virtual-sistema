import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { pool } from "./db";
import type { Moeda } from "./formato";

// Sessão do CLIENTE na área de atacado (separada da sessão da equipe).
export const COOKIE_CLIENTE = "vc_cliente";
export const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
export const novoToken = () => randomBytes(32).toString("base64url");

export type ClientePortal = {
  cliente_id: string; nome: string; moeda: Moeda; categoria: "normal" | "vip"; pais: "PY" | "BR";
  vendedora: string; vendedora_whatsapp: string | null;
};

export async function tokenCliente(): Promise<string | null> {
  return (await cookies()).get(COOKIE_CLIENTE)?.value ?? null;
}

export async function clienteAtual(): Promise<ClientePortal | null> {
  const t = await tokenCliente();
  if (!t) return null;
  const { rows } = await pool.query("select * from app.portal_perfil($1)", [sha256(t)]);
  return (rows[0] as ClientePortal | undefined) ?? null;
}

export async function exigirCliente(): Promise<{ cliente: ClientePortal; sessao: string }> {
  const t = await tokenCliente();
  const c = t ? await clienteAtual() : null;
  if (!c || !t) redirect("/loja/acesso");
  return { cliente: c, sessao: sha256(t) };
}

/** Endereço público da área do cliente, usado nos links enviados por WhatsApp. */
export function urlPortal(host: string | null, proto: string | null): string {
  if (process.env.PORTAL_URL) return process.env.PORTAL_URL.replace(/\/$/, "");
  return `${proto ?? "https"}://${host ?? "localhost:3000"}`;
}
