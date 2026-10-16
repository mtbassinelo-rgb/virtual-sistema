"use server";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { pool, mensagemErro } from "@/lib/db";
import { clienteAtual, exigirCliente, sha256, tokenCliente } from "@/lib/portal";
import { linkWhatsApp, numero, texto } from "@/lib/formato";
import { TEXTOS, idiomaAtual } from "@/lib/idioma";
import { avisarEquipe } from "@/lib/email";
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
  redirect(`/loja/pedidos?novo=1&ok=${encodeURIComponent("Pedido enviado! Sua vendedora vai confirmar e avisar o total para pagamento.")}`);
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

export type RespostaCarrinho = { erro?: string; url?: string; alternativa?: string };

type Linha = { produto_id: string; quantidade: number };

function lerItens(fd: FormData): Linha[] {
  try {
    const v = JSON.parse(String(fd.get("itens") ?? "[]"));
    if (!Array.isArray(v)) return [];
    return v.filter((i) => typeof i?.produto_id === "string" && /^[0-9a-f-]{36}$/.test(i.produto_id) && Number(i.quantidade) > 0)
            .slice(0, 200).map((i) => ({ produto_id: i.produto_id, quantidade: Math.floor(Number(i.quantidade)) }));
  } catch {
    return [];
  }
}

async function listaTexto(itens: Linha[]): Promise<string> {
  const { rows } = await pool.query("select produto_id, nome from app.vitrine_publica() where produto_id = any($1::uuid[])",
    [itens.map((i) => i.produto_id)]);
  const nome = new Map(rows.map((r) => [String(r.produto_id), String(r.nome)]));
  return itens.filter((i) => nome.has(i.produto_id)).map((i) => `• ${i.quantidade}× ${nome.get(i.produto_id)}`).join("\n");
}

/** Envia o carrinho: cliente com acesso → pedido no sistema; visitante → pedido do site + WhatsApp da empresa. */
export async function enviarCarrinho(_: RespostaCarrinho, fd: FormData): Promise<RespostaCarrinho> {
  const itens = lerItens(fd);
  if (itens.length === 0) return { erro: "O pedido está vazio." };
  const obs = texto(fd, "observacao").slice(0, 500);
  const cliente = await clienteAtual();

  if (cliente) {
    const t = await tokenCliente();
    try {
      await pool.query("select app.portal_criar_pedido($1, $2, $3)", [sha256(t!), JSON.stringify(itens), obs]);
      return { url: "/loja/pedidos?novo=1&ok=" + encodeURIComponent("Pedido enviado! A vendedora confere e avisa o total para pagamento.") };
    } catch (e) {
      const msg = `Olá, ${cliente.vendedora}! Sou ${cliente.nome}. Quero fazer este pedido:\n${await listaTexto(itens)}${obs ? "\nObs.: " + obs : ""}`;
      return { erro: mensagemErro(e), alternativa: linkWhatsApp(cliente.vendedora_whatsapp, msg) ?? undefined };
    }
  }

  // Quem navega em espanhol é atendido pelo WhatsApp de vendas em guaranis; em português, pelo principal
  const idioma = await idiomaAtual();
  const nome = texto(fd, "nome"), zap = texto(fd, "whatsapp"), pais = idioma === "es" ? "PY" : "BR", cidade = texto(fd, "cidade");
  try {
    const r = await pool.query("select app.registrar_pedido_site($1, $2, $3, $4, $5, $6) as numero",
      [nome, zap, pais, cidade, JSON.stringify(itens), obs]);
    const lista = await listaTexto(itens);
    const msg = TEXTOS[idioma].msgVisitante(nome, cidade, lista, obs);
    await avisarEquipe(`Pedido pelo site: ${nome}`, `Pedido de visitante pelo site\n\nNome: ${nome}\nWhatsApp: ${zap}\nCidade: ${cidade}\n\n${lista}${obs ? "\n\nObs.: " + obs : ""}`);
    const url = linkWhatsApp(String(r.rows[0].numero), msg);
    return url ? { url } : { erro: "WhatsApp da empresa não configurado." };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}
