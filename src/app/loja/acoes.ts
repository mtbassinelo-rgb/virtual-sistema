"use server";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { pool, mensagemErro } from "@/lib/db";
import { exigirCliente } from "@/lib/portal";
import { numero, texto } from "@/lib/formato";
import { pastaArquivos } from "@/lib/arquivos";

const TIPOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

export async function enviarPedido(fd: FormData) {
  const { sessao } = await exigirCliente();
  const itens: { produto_id: string; quantidade: number }[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("q_")) continue;
    const q = Number(String(v).replace(",", "."));
    if (Number.isFinite(q) && q > 0) itens.push({ produto_id: k.slice(2), quantidade: q });
  }
  let erro: string | null = null;
  try {
    if (itens.length === 0) throw new Error("Escolha a quantidade de pelo menos um produto.");
    await pool.query("select app.portal_criar_pedido($1, $2, $3)", [sessao, JSON.stringify(itens), texto(fd, "observacao")]);
  } catch (e) {
    erro = mensagemErro(e);
  }
  if (erro) redirect(`/loja?erro=${encodeURIComponent(erro)}`);
  redirect(`/loja/pedidos?ok=${encodeURIComponent("Pedido enviado! Sua vendedora vai confirmar e avisar o total para pagamento.")}`);
}

export async function enviarComprovante(fd: FormData) {
  const { sessao } = await exigirCliente();
  let erro: string | null = null;
  try {
    const arquivo = fd.get("comprovante");
    if (!(arquivo instanceof File) || arquivo.size === 0) throw new Error("Anexe a foto ou o PDF do comprovante.");
    const ext = TIPOS[arquivo.type];
    if (!ext) throw new Error("O comprovante deve ser foto (JPG, PNG, WEBP) ou PDF.");
    if (arquivo.size > 10 * 1024 * 1024) throw new Error("Arquivo maior que 10 MB.");
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new Error("Informe o valor pago.");
    const bytes = Buffer.from(await arquivo.arrayBuffer());
    const sha = createHash("sha256").update(bytes).digest("hex");
    await mkdir(pastaArquivos(), { recursive: true });
    await writeFile(path.join(pastaArquivos(), `${sha}.${ext}`), bytes);
    await pool.query(
      "select app.portal_enviar_pagamento($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [sessao, texto(fd, "pedido_id"), valor, texto(fd, "data") || null, texto(fd, "modalidade") || "transferencia",
       `${sha}.${ext}`, arquivo.name, arquivo.type, arquivo.size, sha],
    );
  } catch (e) {
    erro = mensagemErro(e);
  }
  redirect(`/loja/pedidos?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Comprovante enviado. Assim que for conferido, o pedido aparece como pago.")}`);
}
