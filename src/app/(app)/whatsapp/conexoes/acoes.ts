"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro, pool } from "@/lib/db";
import { texto } from "@/lib/formato";
import { converterMensagem, evo, gerarCodigo, gerarQr, type MensagemZap } from "@/lib/whatsapp";

const VOLTA = "/whatsapp/conexoes";
const voltar = (ok: string | null, erro: string | null, extra = "") => {
  revalidatePath(VOLTA);
  redirect(`${VOLTA}?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok ?? "Feito.")}${extra}`);
};

async function conexao(uid: string, id: string) {
  const r = await comUsuario(uid, (c) => c.query("select id, instancia, nome from app.whatsapp_conexoes where id = $1 and app.pode_gerir()", [id]));
  const w = r.rows[0] as { id: string; instancia: string; nome: string } | undefined;
  if (!w) throw new Error("Conexão não encontrada ou sem permissão.");
  return w;
}

/** Cria a conexão e já gera o QR Code para escanear. */
export async function criarConexao(fd: FormData) {
  const u = await exigirUsuario();
  const nome = texto(fd, "nome");
  const slug = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "numero";
  const instancia = `vc-${slug}-${randomBytes(2).toString("hex")}`;
  let erro: string | null = null, id = "", codigo = "";
  try {
    id = await comUsuario(u.id, async (c) => (await c.query(
      `insert into app.whatsapp_conexoes (nome, instancia, pais, vendedora_id) values ($1, $2, $3, nullif($4, '')::uuid) returning id`,
      [nome, instancia, texto(fd, "pais") || "PY", texto(fd, "vendedora_id")])).rows[0].id);
    const numero = texto(fd, "numero").replace(/\D/g, "");
    if (numero) {
      codigo = await gerarCodigo(instancia, numero);
      await pool.query("select app.whatsapp_estado($1, 'aguardando_qr', $2, null)", [instancia, numero]);
    } else {
      const qr = await gerarQr(instancia);
      await pool.query("select app.whatsapp_estado($1, 'aguardando_qr', null, $2)", [instancia, qr]);
      if (!qr) erro = "Conexão criada, mas o servidor de WhatsApp ainda não gerou o QR Code. Toque em \"Gerar novo QR Code\" ou use \"Entrar por código\".";
    }
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar(codigo ? "Conexão criada. Digite o código no celular do número." : "Conexão criada. Escaneie o QR Code com o celular do número.", erro,
    id ? (codigo ? `&codigo=${encodeURIComponent(codigo)}&cid=${id}` : `&qr=${id}`) : "");
}

/** Entrar por código: gera o código de 8 letras para digitar no celular (Conectar com número de telefone). */
export async function codigoConexao(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  let erro: string | null = null, codigo = "";
  try {
    const w = await conexao(u.id, id);
    const numero = texto(fd, "numero").replace(/\D/g, "");
    codigo = await gerarCodigo(w.instancia, numero);
    await pool.query("select app.whatsapp_estado($1, 'aguardando_qr', $2, null)", [w.instancia, numero]);
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar("Código gerado. Digite no celular do número.", erro, codigo ? `&codigo=${encodeURIComponent(codigo)}&cid=${id}` : "");
}

export async function novoQr(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  let erro: string | null = null;
  try {
    const w = await conexao(u.id, id);
    const qr = await gerarQr(w.instancia);
    await pool.query("select app.whatsapp_estado($1, 'aguardando_qr', null, $2)", [w.instancia, qr]);
    if (!qr) throw new Error("O servidor de WhatsApp ainda não gerou o QR Code. Tente de novo em alguns segundos ou use \"Entrar por código\".");
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar("Novo QR Code gerado.", erro, `&qr=${id}`);
}

export async function editarConexao(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query(
      `update app.whatsapp_conexoes set nome = $2, pais = $3, vendedora_id = nullif($4, '')::uuid, atualizado_em = now() where id = $1`,
      [texto(fd, "id"), texto(fd, "nome"), texto(fd, "pais") || "PY", texto(fd, "vendedora_id")]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar("Conexão atualizada.", erro);
}

/** Desconecta o número do sistema (o WhatsApp continua funcionando no celular). O histórico já recebido fica. */
export async function desconectar(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    const w = await conexao(u.id, texto(fd, "id"));
    await evo(`/instance/logout/${w.instancia}`, "DELETE").catch(() => undefined);
    await pool.query("select app.whatsapp_estado($1, 'desconectado')", [w.instancia]);
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar("Número desconectado do sistema. O histórico já recebido continua aqui.", erro);
}

/** Tira a conexão da lista (desconecta e apaga do servidor de WhatsApp). As mensagens já recebidas ficam guardadas. */
export async function removerConexao(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    const w = await conexao(u.id, texto(fd, "id"));
    await evo(`/instance/logout/${w.instancia}`, "DELETE").catch(() => undefined);
    await evo(`/instance/delete/${w.instancia}`, "DELETE").catch(() => undefined);
    await pool.query("select app.whatsapp_estado($1, 'desconectado')", [w.instancia]);
    await comUsuario(u.id, (c) => c.query("update app.whatsapp_conexoes set ativo = false, atualizado_em = now() where id = $1", [w.id]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar("Conexão removida. As mensagens já recebidas continuam no sistema.", erro);
}

/** Busca no servidor de WhatsApp as mensagens que ele já guardou (histórico) e traz para o sistema, sem duplicar. */
export async function importarHistorico(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null, total = 0;
  try {
    const w = await conexao(u.id, texto(fd, "id"));
    for (let pagina = 1; pagina <= 400; pagina++) {
      const r = await evo<{ messages?: { pages?: number; records?: unknown[] } }>(`/chat/findMessages/${w.instancia}`, "POST", { where: {}, page: pagina, offset: 250 });
      const regs = r?.messages?.records ?? [];
      const msgs = regs.map((m) => converterMensagem(m as Parameters<typeof converterMensagem>[0])).filter(Boolean) as MensagemZap[];
      if (msgs.length) total += Number((await pool.query("select app.whatsapp_registrar($1, $2::jsonb) as n", [w.instancia, JSON.stringify(msgs)])).rows[0].n);
      if (!regs.length || pagina >= Number(r?.messages?.pages ?? 1)) break;
    }
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar(total ? `${total.toLocaleString("pt-BR")} mensagens antigas importadas.` : "Nenhuma mensagem nova no histórico (tudo já estava aqui).", erro);
}
