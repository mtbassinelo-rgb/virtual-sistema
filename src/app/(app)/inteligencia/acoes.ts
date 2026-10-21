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
    const unidades = texto(fd, "unidades") === "" ? null : numero(fd, "unidades");
    if (unidades !== null && (!Number.isInteger(unidades) || unidades < 1)) throw new Error("Quantidade de produtos da nota: número inteiro.");
    await comUsuario(u.id, (c) => c.query("select app.registrar_compra($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [fornecedor, texto(fd, "data") || null, valor, numero(fd, "frete") ?? 0, numero(fd, "cambio"), texto(fd, "obs") || null,
       texto(fd, "marca") || null, unidades, texto(fd, "nfe") || null]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar("compras", erro, "Compra registrada. Se informou marca e quantidade, o frete por produto da marca foi recalculado.");
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

/**
 * Importa custos reais por unidade (R$) de um CSV com ";" — o casamento produto × planilha Clientes VIP.
 * Aceita as colunas: codigo; custo_brl (ou custo); custo_frete_brl ou frete_brl (ou frete); normal_sugerido_gs (ou normal);
 * vip_sugerido_gs (ou vip); confianca (opcional). Preço de venda só entra onde está em branco; produto nunca é ativado.
 */
export async function importarCustos(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null, ok = "";
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono importa custos.");
    const arq = fd.get("arquivo");
    const texto_ = arq instanceof File && arq.size > 0 ? await arq.text() : texto(fd, "conteudo");
    if (!texto_.trim()) throw new Error("Escolha o arquivo CSV.");
    if (texto_.length > 2_000_000) throw new Error("Arquivo grande demais.");
    const linhas = texto_.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
    const cab = linhas[0].split(";").map((c) => c.trim().toLowerCase());
    const idx = (...nomes: string[]) => nomes.map((n) => cab.indexOf(n)).find((i) => i >= 0) ?? -1;
    const iCod = idx("codigo", "código"), iCusto = idx("custo_brl", "custo"), iFrete = idx("frete_brl", "frete"),
      iCustoFrete = idx("custo_frete_brl"), iNormal = idx("normal_sugerido_gs", "normal"), iVip = idx("vip_sugerido_gs", "vip"), iConf = idx("confianca");
    if (iCod < 0 || iCusto < 0) throw new Error("O arquivo precisa das colunas codigo e custo_brl (ou custo).");
    const aceitar = new Set(fd.getAll("confianca").map(String));
    const preencher = fd.get("preencher_precos") === "1";
    const num = (s: string | undefined) => {
      const t = (s ?? "").trim().replace(/\s/g, "");
      if (!t) return null;
      const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
      return Number.isFinite(n) ? n : null;
    };
    const dados: { codigo: string; custo: number | null; frete: number | null; normal: number | null; vip: number | null }[] = [];
    let ignoradas = 0;
    for (const l of linhas.slice(1)) {
      const c = l.split(";");
      const conf = iConf >= 0 ? (c[iConf] ?? "").trim() : "alta";
      const custo = num(c[iCusto]);
      if (!c[iCod]?.trim() || custo === null || (iConf >= 0 && !aceitar.has(conf))) { ignoradas++; continue; }
      const frete = iFrete >= 0 ? num(c[iFrete]) : iCustoFrete >= 0 && num(c[iCustoFrete]) !== null ? Math.round((num(c[iCustoFrete])! - custo) * 10000) / 10000 : null;
      dados.push({ codigo: c[iCod].trim(), custo, frete, normal: preencher && iNormal >= 0 ? num(c[iNormal]) : null, vip: preencher && iVip >= 0 ? num(c[iVip]) : null });
    }
    if (!dados.length) throw new Error("Nenhuma linha para importar com as confianças escolhidas.");
    const r = await comUsuario(u.id, async (c) => (await c.query("select app.importar_custos($1::jsonb) r", [JSON.stringify(dados)])).rows[0].r as
      { custos: number; fretes: number; precos_preenchidos: number; nao_encontrados: string[] });
    ok = `Importado: ${r.custos} custo(s) e ${r.fretes} frete(s) atualizados; ${r.precos_preenchidos} preço(s) em branco preenchidos; ${ignoradas} linha(s) ignoradas` +
      (r.nao_encontrados.length ? `; ${r.nao_encontrados.length} código(s) não encontrados (${r.nao_encontrados.slice(0, 5).join(", ")}${r.nao_encontrados.length > 5 ? "…" : ""})` : "") + ".";
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar("custos", erro, ok);
}

/** Marca que o motor usa como gatilho: papel e margem-alvo (opcional). Não mexe em preço. */
export async function salvarMarcaInteligencia(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono escolhe as marcas do motor.");
    const marca = texto(fd, "marca");
    if (!marca) throw new Error("Marca não informada.");
    const papel = texto(fd, "papel") || "acompanhar";
    if (!["atracao", "rentabilidade", "diferenciacao", "acompanhar"].includes(papel)) throw new Error("Papel inválido.");
    const mn = texto(fd, "margem_normal") === "" ? null : numero(fd, "margem_normal");
    const mv = texto(fd, "margem_vip") === "" ? null : numero(fd, "margem_vip");
    for (const m of [mn, mv]) if (m !== null && (m < 0 || m > 90)) throw new Error("Margem-alvo em % entre 0 e 90.");
    await comUsuario(u.id, (c) => c.query("select app.definir_marca_inteligencia($1, $2, $3, $4, $5, $6)",
      [marca, fd.get("gatilho") === "1", papel, mn, mv, texto(fd, "obs") || null]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/inteligencia/precificacao");
  redirect(`/inteligencia/precificacao?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Marca salva no motor.")}`);
}
