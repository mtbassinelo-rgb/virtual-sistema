"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";

async function executar(ok: string, fn: (uid: string) => Promise<unknown>) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    await fn(u.id);
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/estoque");
  redirect(`/estoque?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}#transferencias`);
}

function itens(fd: FormData) {
  const lista: { produto_id: string; quantidade: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const p = texto(fd, `produto_${i}`);
    const q = numero(fd, `qtd_${i}`);
    if (p && q && q > 0) lista.push({ produto_id: p, quantidade: q });
  }
  if (lista.length === 0) throw new Error("Inclua pelo menos um produto com quantidade.");
  return lista;
}

export async function criarTransferencia(fd: FormData) {
  await executar("Transferência criada. Envie quando a mercadoria sair.", (uid) =>
    comUsuario(uid, (c) => c.query("select app.criar_transferencia($1, $2, $3, nullif($4,''))",
      [texto(fd, "origem_id"), texto(fd, "destino_id"), JSON.stringify(itens(fd)), texto(fd, "observacao")])));
}

export async function enviarTransferencia(fd: FormData) {
  await executar("Transferência enviada: a mercadoria saiu da origem.", (uid) =>
    comUsuario(uid, (c) => c.query("select app.enviar_transferencia($1)", [texto(fd, "transferencia_id")])));
}

export async function cancelarTransferencia(fd: FormData) {
  await executar("Transferência cancelada.", (uid) =>
    comUsuario(uid, (c) => c.query("select app.cancelar_transferencia($1)", [texto(fd, "transferencia_id")])));
}

export async function receberTransferencia(fd: FormData) {
  await executar("Recebimento registrado.", async (uid) => {
    const recebidos: { produto_id: string; quantidade: number }[] = [];
    for (const [k, v] of fd.entries()) {
      if (k.startsWith("recebido_") && String(v).trim() !== "") {
        const q = Number(String(v).replace(",", "."));
        if (!Number.isFinite(q)) throw new Error("Quantidade recebida inválida.");
        recebidos.push({ produto_id: k.slice("recebido_".length), quantidade: q });
      }
    }
    await comUsuario(uid, (c) => c.query("select app.receber_transferencia($1, $2, nullif($3,''))",
      [texto(fd, "transferencia_id"), JSON.stringify(recebidos), texto(fd, "observacao")]));
  });
}

export async function entradaCompra(fd: FormData) {
  await executar("Entrada de mercadoria registrada.", (uid) =>
    comUsuario(uid, (c) => c.query("select app.entrada_compra($1, $2, $3, nullif($4,''))",
      [texto(fd, "deposito_id"), JSON.stringify(itens(fd)), texto(fd, "referencia"), texto(fd, "observacao")])));
}

export async function ajustarEstoque(fd: FormData) {
  await executar("Estoque ajustado.", (uid) =>
    comUsuario(uid, (c) => c.query("select app.ajustar_estoque($1, $2, $3, $4)",
      [texto(fd, "deposito_id"), texto(fd, "produto_id"), numero(fd, "contado"), texto(fd, "motivo")])));
}
