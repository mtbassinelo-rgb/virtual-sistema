"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { texto } from "@/lib/formato";

const ir = (url: string, erro: string | null, ok: string) => {
  revalidatePath("/estoque/transferencias");
  revalidatePath("/estoque/separacao");
  revalidatePath("/estoque");
  redirect(`${url}${url.includes("?") ? "&" : "?"}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
};
const qtd = (v: FormDataEntryValue | null) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };

/** A unidade que vai receber pede mercadoria à outra. Campos q:<produto_id> com a quantidade. */
export async function solicitarTransferencia(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null, id = "";
  try {
    const itens = [...fd.entries()].filter(([k, v]) => k.startsWith("q:") && qtd(v) > 0).map(([k, v]) => ({ produto_id: k.slice(2), quantidade: qtd(v) }));
    if (!itens.length) throw new Error("Informe a quantidade de pelo menos um produto.");
    id = await comUsuario(u.id, async (c) => (await c.query("select app.solicitar_transferencia($1, $2, $3::jsonb, $4, $5) id",
      [texto(fd, "origem"), texto(fd, "destino"), JSON.stringify(itens), texto(fd, "obs") || null, texto(fd, "pedido") || null])).rows[0].id as string);
  } catch (e) {
    erro = mensagemErro(e);
  }
  if (erro) ir(texto(fd, "volta") || "/estoque/transferencias/nova", erro, "");
  ir(`/estoque/transferencias/${id}`, null, "Pedido enviado ao estoque de origem. Você acompanha aqui: separação, aprovação e chegada.");
}

/** Estoquista confere o que tem: campos s:<produto_id> com a quantidade separada e f:<produto_id> = não tem. */
export async function separarTransferencia(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  let erro: string | null = null, ok = "";
  try {
    const itens = [...fd.entries()].filter(([k]) => k.startsWith("s:")).map(([k, v]) => {
      const p = k.slice(2);
      return { produto_id: p, quantidade: fd.get(`f:${p}`) ? 0 : qtd(v) };
    });
    const r = await comUsuario(u.id, async (c) => (await c.query("select app.separar_transferencia($1, $2::jsonb) r", [id, JSON.stringify(itens)])).rows[0].r as { tem: number; falta: number });
    ok = `Separação conferida: ${r.tem} item(ns) separado(s)${r.falta ? `, ${r.falta} em falta` : ""}. Agora falta a aprovação do envio.`;
  } catch (e) {
    erro = mensagemErro(e);
  }
  ir(`/estoque/transferencias/${id}`, erro, ok);
}

export async function aprovarTransferencia(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.aprovar_transferencia($1)", [id]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  ir(`/estoque/transferencias/${id}`, erro, "Envio aprovado: a mercadoria saiu do estoque de origem e está a caminho.");
}

export async function cancelarSolicitacao(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.cancelar_transferencia($1, $2)", [id, texto(fd, "motivo") || null]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  ir(`/estoque/transferencias/${id}`, erro, "Cancelada.");
}

/** Chegada no destino: campos r:<produto_id> com o que chegou de fato. */
export async function receberSolicitacao(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  let erro: string | null = null, ok = "";
  try {
    const itens = [...fd.entries()].filter(([k]) => k.startsWith("r:")).map(([k, v]) => ({ produto_id: k.slice(2), quantidade: qtd(v) }));
    const r = await comUsuario(u.id, async (c) => (await c.query("select app.receber_transferencia($1, $2::jsonb, $3) r", [id, JSON.stringify(itens), texto(fd, "obs") || null])).rows[0].r as string);
    ok = r === "recebida" ? "Recebida: a mercadoria entrou no estoque da unidade." : "Recebida com diferença: entrou só o que chegou; a diferença fica registrada.";
  } catch (e) {
    erro = mensagemErro(e);
  }
  ir(`/estoque/transferencias/${id}`, erro, ok);
}
