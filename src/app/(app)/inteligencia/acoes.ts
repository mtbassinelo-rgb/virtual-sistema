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

/** Cadastra ou altera um fornecedor (prazo de reposição em dias, pedido mínimo em R$). */
export async function salvarFornecedor(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono altera fornecedores.");
    const prazo = numero(fd, "prazo");
    if (prazo !== null && (prazo < 0 || prazo > 365 || !Number.isInteger(prazo))) throw new Error("Prazo de reposição em dias inteiros (0 a 365).");
    await comUsuario(u.id, (c) => c.query("select app.definir_fornecedor($1, $2, $3, $4, $5, $6)",
      [texto(fd, "id") || null, texto(fd, "nome"), prazo, numero(fd, "pedido_minimo"), texto(fd, "obs") || null, fd.get("ativo") !== "0"]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar("compras", erro, "Fornecedor salvo.");
}

/** Registra uma compra: valor dos produtos e frete em R$, câmbio em Gs por R$. Não movimenta estoque. */
export async function registrarCompra(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono registra compras.");
    const fornecedor = texto(fd, "fornecedor");
    if (!fornecedor) throw new Error("Escolha o fornecedor.");
    const valor = numero(fd, "valor");
    if (valor === null || valor <= 0) throw new Error("Informe o valor dos produtos em R$.");
    await comUsuario(u.id, (c) => c.query("select app.registrar_compra($1, $2, $3, $4, $5, $6)",
      [fornecedor, texto(fd, "data") || null, valor, numero(fd, "frete") ?? 0, numero(fd, "cambio"), texto(fd, "obs") || null]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar("compras", erro, "Compra registrada.");
}

export async function excluirCompra(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono exclui compras.");
    await comUsuario(u.id, (c) => c.query("select app.excluir_compra($1)", [texto(fd, "id")]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar("compras", erro, "Compra excluída.");
}
