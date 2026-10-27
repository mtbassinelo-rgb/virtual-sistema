"use server";

import { createHash, randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { texto } from "@/lib/formato";
import { PERMISSOES, padraoDoPerfil, permitidaParaPerfil } from "@/lib/permissoes";

export type RespostaLink = { link?: string; nome?: string; erro?: string; senha?: string; email?: string };
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
    const r = await comUsuario(u.id, (c) => c.query("select app.convidar_pessoa($1, $2, $3::app.perfil, $4, $5, $6) as x",
      [texto(fd, "email"), nome, texto(fd, "perfil"), texto(fd, "vendedora") || null, t.hash, HORAS]));
    const senha = String(fd.get("senha") ?? "").trim();
    if (senha) {
      const email = await aplicarSenha(u.id, r.rows[0].x as string, senha);
      revalidatePath("/equipe");
      return { nome, email, senha };
    }
    revalidatePath("/equipe");
    return { link: t.link, nome };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

/** Senha provisória: a pessoa entra na hora com e-mail + esta senha e troca depois em Minha conta, se quiser. */
async function aplicarSenha(uid: string, id: string, senha: string) {
  if (senha.length < 6) throw new Error("A senha provisória precisa ter pelo menos 6 caracteres.");
  const senhaHash = await hash(senha, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  return (await comUsuario(uid, (c) => c.query("select app.definir_senha_pessoa($1, $2) as email", [id, senhaHash]))).rows[0].email as string;
}

export async function definirSenha(_: RespostaLink, fd: FormData): Promise<RespostaLink> {
  const u = await exigirUsuario();
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono cuida da equipe.");
    const senha = String(fd.get("senha") ?? "").trim();
    const email = await aplicarSenha(u.id, texto(fd, "id"), senha);
    revalidatePath("/equipe");
    return { nome: texto(fd, "nome"), email, senha };
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

/** Em quais unidades (CD Foz, CDE…) cada vendedora vende e qual é a padrão dos pedidos dela. */
export async function salvarUnidadesVendedora(fd: FormData) {
  const u = await exigirUsuario();
  const vendedora = texto(fd, "vendedora_id");
  const marcadas = fd.getAll("depositos").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  let q: string;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono define as unidades das vendedoras.");
    await comUsuario(u.id, (c) => c.query("select app.definir_unidades_vendedora($1, $2::uuid[], $3)", [vendedora, marcadas, texto(fd, "padrao") || null]));
    q = "ok=" + encodeURIComponent("Unidades da vendedora salvas.");
  } catch (e) {
    q = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  revalidatePath("/equipe");
  redirect(`/equipe?${q}#unidades`);
}

/** Áreas liberadas, horário permitido e unidades em que a pessoa mexe no estoque/caixa. */
export async function salvarAcessos(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "usuario_id");
  let q: string;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono cuida dos acessos.");
    const alvo = await comUsuario(u.id, async (c) => (await c.query("select perfil, permissoes from app.usuarios where id = $1", [id])).rows[0] as { perfil: string; permissoes: Record<string, boolean> | null } | undefined);
    const perfil = String(alvo?.perfil ?? "");
    if (!perfil) throw new Error("Pessoa não encontrada.");
    // guarda só o que difere do padrão do perfil
    const permissoes: Record<string, boolean> = {};
    for (const p of PERMISSOES) {
      if (!permitidaParaPerfil(perfil, p.chave)) continue;
      // área exclusiva do dono: quem não é dono não muda (mantém o que já estava)
      if (p.soDono && u.perfil !== "dono") {
        if (typeof alvo?.permissoes?.[p.chave] === "boolean") permissoes[p.chave] = alvo.permissoes[p.chave];
        continue;
      }
      const marcado = fd.get(`perm_${p.chave}`) === "1";
      if (marcado !== padraoDoPerfil(perfil, p.chave)) permissoes[p.chave] = marcado;
    }
    const horarios: { dia: number; inicio: string; fim: string }[] = [];
    if (texto(fd, "limite") === "horario") {
      for (let dia = 0; dia < 7; dia++) {
        if (fd.get(`dia_${dia}`) !== "1") continue;
        const inicio = texto(fd, `ini_${dia}`) || "08:00", fim = texto(fd, `fim_${dia}`) || "18:00";
        if (!/^\d{2}:\d{2}$/.test(inicio) || !/^\d{2}:\d{2}$/.test(fim) || fim <= inicio) throw new Error("Confira os horários: o fim precisa ser depois do início.");
        horarios.push({ dia, inicio, fim });
      }
      if (!horarios.length) throw new Error("Marque pelo menos um dia, ou escolha \"Sem limite de horário\". Para bloquear de vez, use Desativar.");
    }
    const depositos = fd.getAll("dep").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    await comUsuario(u.id, (c) => c.query("select app.definir_acesso_usuario($1, $2::jsonb, $3::jsonb, $4::uuid[])",
      [id, JSON.stringify(permissoes), JSON.stringify(horarios), depositos]));
    await comUsuario(u.id, (c) => c.query("select app.definir_aprova_transferencias($1, $2)", [id, fd.get("aprova_transf") === "1"]));
    q = "ok=" + encodeURIComponent("Acessos salvos. Valem a partir da próxima página que a pessoa abrir.");
  } catch (e) {
    q = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  revalidatePath("/equipe");
  redirect(`/equipe?${q}#acesso-${id}`);
}
