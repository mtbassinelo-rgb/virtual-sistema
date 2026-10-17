import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { verify } from "@node-rs/argon2";
import { pool } from "./db";

export type Perfil = "dono" | "gerente" | "vendedora" | "consulta";
export type Usuario = { id: string; nome: string; perfil: Perfil; vendedora_id: string | null };

const COOKIE = "vc_sessao";
const DIAS = 30;
const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/** Confere e-mail e senha e abre a sessão. Devolve uma mensagem de erro ou null. */
export async function entrar(email: string, senha: string): Promise<string | null> {
  email = email.trim().toLowerCase();
  if (!email || !senha) return "Informe e-mail e senha.";
  const { rows } = await pool.query("select id, senha_hash, bloqueado from app.dados_login($1)", [email]);
  const u = rows[0] as { id: string; senha_hash: string | null; bloqueado: boolean } | undefined;
  if (u?.bloqueado) return "Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.";
  let ok = false;
  if (u?.senha_hash) {
    try {
      ok = await verify(u.senha_hash, senha);
    } catch {
      ok = false;
    }
  }
  await pool.query("select app.registrar_tentativa($1, $2)", [email, ok]);
  if (!u || !ok) return "E-mail ou senha incorretos.";

  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await pool.query("select app.criar_sessao($1, $2, $3, $4, $5)", [u.id, sha256(token), DIAS, ip, h.get("user-agent")]);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DIAS * 86400,
  });
  return null;
}

export async function usuarioAtual(): Promise<Usuario | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const { rows } = await pool.query(
    "select usuario_id as id, nome, perfil, vendedora_id from app.sessao_valida($1)",
    [sha256(token)],
  );
  return (rows[0] as Usuario | undefined) ?? null;
}

export async function exigirUsuario(): Promise<Usuario> {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  return u;
}

export async function sair(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await pool.query("select app.encerrar_sessao($1)", [sha256(token)]);
  jar.delete(COOKIE);
}

export const ehGestao = (u: Usuario) => u.perfil === "dono" || u.perfil === "gerente";
export const podeEscrever = (u: Usuario) => u.perfil !== "consulta";

/** Hash da sessão aberta neste navegador (para manter esta sessão ao trocar a senha). */
export async function hashSessaoAtual(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? sha256(token) : null;
}

/** Confere a senha de quem está logado (conta como tentativa: 5 erros bloqueiam por 15 minutos). */
export async function conferirSenha(email: string, senha: string): Promise<string | null> {
  const { rows } = await pool.query("select senha_hash, bloqueado from app.dados_login($1)", [email]);
  const u = rows[0] as { senha_hash: string | null; bloqueado: boolean } | undefined;
  if (u?.bloqueado) return "Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.";
  let ok = false;
  if (u?.senha_hash) {
    try { ok = await verify(u.senha_hash, senha); } catch { ok = false; }
  }
  await pool.query("select app.registrar_tentativa($1, $2)", [email, ok]);
  return ok ? null : "A senha atual não confere.";
}
