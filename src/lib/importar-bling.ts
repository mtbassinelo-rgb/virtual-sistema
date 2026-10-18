import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pastaArquivos } from "./arquivos";

/** Uma linha da planilha de produtos do Bling, já limpa. */
export type LinhaBling = {
  bling_id: number;
  codigo: string;
  nome: string;
  preco: number | null;
  custo: number | null;
  estoque: number | null;
  gtin: string;
  unidade: string;
  marca: string;
  ncm: string;
  fornecedor: string;
};

export type Lote = { id: string; arquivo: string; usuario_id: string; criado_em: string; linhas: LinhaBling[] };

/** Lê CSV com ";" e aspas (formato de exportação do Bling). */
export function lerCsv(texto: string, sep = ";"): string[][] {
  const linhas: string[][] = [];
  let campo = "", linha: string[] = [], aspas = false;
  const t = texto.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      if (linha.some((c) => c.trim() !== "")) linhas.push(linha);
      linha = [];
    } else campo += ch;
  }
  if (campo !== "" || linha.length) { linha.push(campo); if (linha.some((c) => c.trim() !== "")) linhas.push(linha); }
  return linhas;
}

/** Número no formato brasileiro do Bling: "1.728,0000000000" → 1728 */
export function numeroBr(v: string | undefined): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Converte o arquivo exportado do Bling nas linhas que o banco importa. */
export function interpretarPlanilhaBling(bytes: Buffer): LinhaBling[] {
  let texto = new TextDecoder("utf-8").decode(bytes);
  if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(bytes);
  const linhas = lerCsv(texto);
  if (linhas.length < 2) throw new Error("O arquivo não tem produtos. Exporte de novo em Cadastros → Produtos → Exportar (CSV).");
  const cab = linhas[0].map(normal);
  const col = (...nomes: string[]) => {
    for (const n of nomes) { const i = cab.indexOf(normal(n)); if (i >= 0) return i; }
    return -1;
  };
  const c = {
    id: col("ID"), codigo: col("Código"), nome: col("Descrição"), preco: col("Preço"), custo: col("Preço de custo"),
    estoque: col("Estoque"), gtin: col("GTIN/EAN"), unidade: col("Unidade"), marca: col("Marca"), ncm: col("NCM"),
    fornecedor: col("Fornecedor"),
  };
  if (c.id < 0 || c.nome < 0) {
    throw new Error("Não reconheci a planilha: faltam as colunas \"ID\" e \"Descrição\". Use a exportação de produtos do Bling em CSV.");
  }
  const v = (l: string[], i: number) => (i >= 0 ? (l[i] ?? "").trim() : "");
  const vistos = new Set<number>();
  const saida: LinhaBling[] = [];
  for (const l of linhas.slice(1)) {
    const id = Number(v(l, c.id));
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    if (vistos.has(id)) continue;
    vistos.add(id);
    saida.push({
      bling_id: id, codigo: v(l, c.codigo), nome: v(l, c.nome).replace(/\s+/g, " "),
      preco: numeroBr(v(l, c.preco)), custo: numeroBr(v(l, c.custo)), estoque: c.estoque >= 0 ? numeroBr(v(l, c.estoque)) : null,
      gtin: v(l, c.gtin), unidade: v(l, c.unidade), marca: v(l, c.marca), ncm: v(l, c.ncm), fornecedor: v(l, c.fornecedor),
    });
  }
  if (saida.length === 0) throw new Error("Nenhum produto com ID do Bling no arquivo.");
  return saida;
}

/** Problemas que vale corrigir no Bling antes (ou depois) de importar. */
export function analisar(linhas: LinhaBling[]) {
  const porNome = new Map<string, LinhaBling[]>();
  for (const l of linhas) {
    const k = normal(l.nome);
    porNome.set(k, [...(porNome.get(k) ?? []), l]);
  }
  const porCodigo = new Map<string, LinhaBling[]>();
  for (const l of linhas) if (l.codigo) porCodigo.set(l.codigo, [...(porCodigo.get(l.codigo) ?? []), l]);
  return {
    semCodigo: linhas.filter((l) => !l.codigo),
    codigoRepetido: [...porCodigo.values()].filter((g) => g.length > 1).flat(),
    nomeRepetido: [...porNome.values()].filter((g) => g.length > 1).flat(),
    negativo: linhas.filter((l) => (l.estoque ?? 0) < 0),
    semPreco: linhas.filter((l) => !l.preco),
    pareceKit: linhas.filter((l) => /\bkits?\b/i.test(l.nome)),
    comEstoque: linhas.filter((l) => (l.estoque ?? 0) > 0),
    zerados: linhas.filter((l) => l.estoque === 0),
    unidades: linhas.reduce((s, l) => s + Math.max(0, l.estoque ?? 0), 0),
  };
}

const pasta = () => path.join(path.dirname(pastaArquivos()), "importacoes");

export async function guardarLote(arquivo: string, usuarioId: string, linhas: LinhaBling[]): Promise<string> {
  const id = randomUUID();
  await mkdir(pasta(), { recursive: true });
  const lote: Lote = { id, arquivo, usuario_id: usuarioId, criado_em: new Date().toISOString(), linhas };
  await writeFile(path.join(pasta(), `${id}.json`), JSON.stringify(lote), { mode: 0o600 });
  return id;
}

export async function lerLote(id: string, usuarioId: string): Promise<Lote | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  try {
    const lote = JSON.parse(await readFile(path.join(pasta(), `${id}.json`), "utf8")) as Lote;
    return lote.usuario_id === usuarioId ? lote : null;
  } catch {
    return null;
  }
}

export async function apagarLote(id: string) {
  if (/^[0-9a-f-]{36}$/.test(id)) await rm(path.join(pasta(), `${id}.json`), { force: true });
}
