"use server";

import type { PoolClient } from "pg";
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

type Cliente = PoolClient;

/** Código digitado (ou escolhido na lista) → id do produto */
async function produtoId(c: Cliente, codigo: string): Promise<string> {
  const r = await c.query(
    `select id from app.produtos where codigo = $1
     union all select produto_id from app.produto_codigos where codigo = $1 limit 1`, [codigo.trim()]);
  if (!r.rows[0]) throw new Error(`Produto com código "${codigo}" não encontrado.`);
  return String(r.rows[0].id);
}

async function itens(c: Cliente, fd: FormData, max = 10) {
  const lista: { produto_id: string; quantidade: number }[] = [];
  for (let i = 0; i < max; i++) {
    const p = texto(fd, `produto_${i}`);
    const q = numero(fd, `qtd_${i}`);
    if (p && q && q > 0) lista.push({ produto_id: await produtoId(c, p), quantidade: q });
  }
  if (lista.length === 0) throw new Error("Inclua pelo menos um produto com quantidade.");
  return lista;
}

export async function criarTransferencia(fd: FormData) {
  await executar("Transferência criada. Envie quando a mercadoria sair.", (uid) =>
    comUsuario(uid, async (c) => c.query("select app.criar_transferencia($1, $2, $3, nullif($4,''))",
      [texto(fd, "origem_id"), texto(fd, "destino_id"), JSON.stringify(await itens(c, fd)), texto(fd, "observacao")])));
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
    comUsuario(uid, async (c) => c.query("select app.entrada_compra($1, $2, $3, nullif($4,''))",
      [texto(fd, "deposito_id"), JSON.stringify(await itens(c, fd)), texto(fd, "referencia"), texto(fd, "observacao")])));
}

export async function ajustarEstoque(fd: FormData) {
  await executar("Estoque ajustado.", (uid) =>
    comUsuario(uid, async (c) => c.query("select app.ajustar_estoque($1, $2, $3, $4)",
      [texto(fd, "deposito_id"), await produtoId(c, texto(fd, "produto")), numero(fd, "contado"), texto(fd, "motivo")])));
}

export async function definirKit(fd: FormData) {
  await executar("Kit salvo: ao vender, saem os componentes.", (uid) =>
    comUsuario(uid, async (c) => {
      const kit = await produtoId(c, texto(fd, "kit"));
      const comps = fd.get("desfazer") ? [] : await itens(c, fd, 6);
      return c.query("select app.definir_kit($1, $2)", [kit, JSON.stringify(comps)]);
    }));
}

/** Pendências "sem estoque" de marketplace: dá a saída agora nas que já têm saldo. */
export async function reprocessarPendencias() {
  const u = await exigirUsuario();
  let erro: string | null = null, ok = "";
  try {
    const r = (await comUsuario(u.id, (c) => c.query("select app.reprocessar_pendencias_estoque() r"))).rows[0].r as { baixadas: number; sem_estoque: number };
    ok = `${r.baixadas} pendência(s) baixada(s) no estoque.` + (r.sem_estoque ? ` ${r.sem_estoque} continuam sem estoque suficiente.` : "");
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/estoque");
  redirect(`/estoque?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}#pendencias`);
}
