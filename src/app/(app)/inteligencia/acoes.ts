"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";

function voltar(aba: string, erro: string | null, ok: string) {
  revalidatePath("/inteligencia");
  redirect(`/inteligencia?aba=${aba}&${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
}

/** Frete de compra por unidade (R$) padrão de uma marca. Vazio remove o padrão. */
export async function salvarFreteMarca(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono altera o frete.");
    const marca = texto(fd, "marca");
    if (!marca) throw new Error("Marca não informada.");
    const valor = texto(fd, "frete") === "" ? null : numero(fd, "frete");
    if (valor !== null && (valor < 0 || valor > 1000)) throw new Error("Informe o frete por unidade em R$ (ex.: 0,35).");
    await comUsuario(u.id, (c) => c.query("select app.definir_frete_marca($1, $2, $3)", [marca, valor, texto(fd, "obs") || null]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar("custos", erro, "Frete da marca salvo.");
}

/** Imposto, comissão, taxa ou entrega do Paraguai, com data de início (o histórico fica guardado). */
export async function salvarCustoVariavel(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono altera custos.");
    const tipo = texto(fd, "tipo");
    const base = texto(fd, "base");
    const valor = numero(fd, "valor");
    const desde = texto(fd, "desde") || null;
    if (!["imposto", "comissao", "taxa_pagamento", "taxa_canal", "entrega"].includes(tipo)) throw new Error("Tipo de custo inválido.");
    if (!["venda", "caixa", "pedido"].includes(base)) throw new Error("Base inválida.");
    if (valor === null || valor < 0) throw new Error("Informe um valor válido.");
    if (base === "venda" && valor > 60) throw new Error("Percentual sobre a venda fora do esperado.");
    await comUsuario(u.id, (c) => c.query("select app.definir_custo_variavel('PY', $1, $2, $3, $4, $5, $6, $7)",
      [tipo, base, base === "venda" ? valor : null, base === "venda" ? null : valor, base === "venda" ? null : "GS", desde, texto(fd, "obs") || null]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar("custos", erro, "Custo salvo. Vale a partir da data informada.");
}
