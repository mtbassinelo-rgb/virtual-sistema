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

/** Abre a sessão do cliente neste navegador (cookie só para /loja). */
export async function abrirSessaoCliente(clienteId: string): Promise<void> {
  const sessao = novoToken();
  await pool.query("select app.portal_abrir_sessao($1, $2)", [clienteId, sha256(sessao)]);
  (await cookies()).set(COOKIE_CLIENTE, sessao, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/loja", maxAge: 90 * 86400,
  });
}

/** Confere documento + senha do cliente. Devolve o id do cliente ou a mensagem de erro. */
export async function conferirCliente(documento: string, senha: string, es: boolean): Promise<{ id?: string; erro?: string }> {
  const { verify } = await import("@node-rs/argon2");
  const { rows } = await pool.query("select cliente_id, senha_hash, bloqueado from app.portal_dados_login($1)", [documento]);
  const r = rows[0] as { cliente_id: string; senha_hash: string; bloqueado: boolean } | undefined;
  if (r?.bloqueado) return { erro: es ? "Demasiados intentos. Espere 15 minutos e intente de nuevo." : "Muitas tentativas erradas. Aguarde 15 minutos e tente de novo." };
  let ok = false;
  if (r?.senha_hash) { try { ok = await verify(r.senha_hash, senha); } catch { ok = false; } }
  await pool.query("select app.portal_registrar_tentativa($1, $2)", [documento, ok]);
  if (!r || !ok) return { erro: es ? "Documento o contraseña incorrectos." : "Documento ou senha incorretos." };
  return { id: r.cliente_id };
}
