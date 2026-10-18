import "server-only";
import { cookies } from "next/headers";
import { pool } from "./db";

/** Visitante que entrou pelo link da vendedora (distribuidoravirtualcosmeticos.com/loja/v/keila) fica com ela. */
export const COOKIE_VENDEDORA = "vc_vend";

export async function vendedoraDoLink(): Promise<{ slug: string; nome: string; whatsapp: string | null } | null> {
  const slug = (await cookies()).get(COOKIE_VENDEDORA)?.value;
  if (!slug || !/^[a-z0-9-]{2,30}$/.test(slug)) return null;
  const r = (await pool.query("select nome, whatsapp from app.vendedora_do_link($1)", [slug])).rows[0];
  return r ? { slug, nome: r.nome, whatsapp: r.whatsapp ? String(r.whatsapp).replace(/\D/g, "") || null : null } : null;
}
