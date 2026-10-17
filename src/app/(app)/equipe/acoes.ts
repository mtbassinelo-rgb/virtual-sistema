"use server";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { texto } from "@/lib/formato";

export type RespostaLink = { link?: string; nome?: string; erro?: string };
const HORAS = 72;

/** Cria o token (mostrado uma única vez) e guarda só o hash dele. */
async function novoToken() {
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "app.distribuidoravirtualcosmeticos.com";
  const base = process.env.APP_URL?.replace(/\/$/, "") || `https://${host}`;
  return { hash: createHash("sha256").update(token).digest("hex"), link: `${base}/primeiro-acesso/${token}` };
}

export async function convidarPessoa(_: RespostaLink, fd: FormData): Promise<RespostaLink> {
  const u = await exigirUsuario();
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono cuida da equipe.");
    const t = await novoToken();
    const nome = texto(fd, "nome");
    await comUsuario(u.id, (c) => c.query("select app.convidar_pessoa($1, $2, $3::app.perfil, $4, $5, $6)",
      [texto(fd, "email"), nome, texto(fd, "perfil"), texto(fd, "vendedora") || null, t.hash, HORAS]));
    revalidatePath("/equipe");
    return { link: t.link, nome };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

export async function gerarLinkSenha(_: RespostaLink, fd: FormData): Promise<RespostaLink> {
  const u = await exigirUsuario();
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono cuida da equipe.");
    const t = await novoToken();
    await comUsuario(u.id, (c) => c.query("select app.gerar_link_senha($1, $2, $3)", [texto(fd, "id"), t.hash, HORAS]));
    revalidatePath("/equipe");
    return { link: t.link, nome: texto(fd, "nome") };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

export async function ativarPessoa(fd: FormData) {
  const u = await exigirUsuario();
  const ativo = texto(fd, "ativo") === "1";
  let q = "ok=" + encodeURIComponent(ativo ? "Acesso reativado. Gere um link de nova senha se a pessoa não lembrar a senha." : "Acesso desativado.");
  try {
    await comUsuario(u.id, (c) => c.query("select app.ativar_pessoa($1, $2)", [texto(fd, "id"), ativo]));
  } catch (e) {
    q = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  revalidatePath("/equipe");
  redirect(`/equipe?${q}`);
}
