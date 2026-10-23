"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { texto } from "@/lib/formato";
import { lerRelatorio } from "@/lib/relatorio-marketplace";

const ir = (erro: string | null, ok: string) => {
  revalidatePath("/estoque/marketplace");
  revalidatePath("/estoque");
  redirect(`/estoque/marketplace?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
};

/** Lança o relatório de vendas do marketplace: arquivo CSV ou linhas coladas da planilha. */
export async function importarRelatorio(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null, ok = "";
  try {
    const canal = texto(fd, "canal");
    if (!["shopee", "mercado_livre", "tiktok"].includes(canal)) throw new Error("Escolha o marketplace.");
    const arq = fd.get("arquivo");
    let conteudo = String(fd.get("colado") ?? ""), nome = "colado";
    if (arq && typeof arq === "object" && "text" in arq && arq.size > 0) {
      if (/\.xlsx?$/i.test(arq.name)) throw new Error("Arquivo do Excel: abra e use \"Salvar como CSV\", ou copie as linhas e cole no campo de texto.");
      if (arq.size > 5_000_000) throw new Error("Arquivo grande demais (máx. 5 MB).");
      conteudo = await arq.text(); nome = arq.name;
    }
    if (!conteudo.trim()) throw new Error("Envie o arquivo CSV ou cole as linhas do relatório.");
    const leitura = lerRelatorio(conteudo, canal, texto(fd, "data") || new Date().toISOString().slice(0, 10));
    if (!leitura.pedidos.length) throw new Error("Não achei vendas no relatório (precisa de SKU e quantidade).");
    const r = await comUsuario(u.id, async (c) => (await c.query("select app.lancar_vendas_marketplace($1, $2, $3::jsonb, $4) r",
      [canal, texto(fd, "deposito"), JSON.stringify(leitura.pedidos), nome.slice(0, 200)])).rows[0].r as { novos: number; repetidos: number; itens: number; sem_sku: number; total: number });
    ok = `${r.novos} pedido(s) lançado(s), ${r.itens} item(ns), R$ ${Number(r.total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.`
      + (r.repetidos ? ` ${r.repetidos} já tinham entrado (ignorados).` : "")
      + (leitura.cancelados ? ` ${leitura.cancelados} linha(s) cancelada(s) ignorada(s).` : "")
      + (r.sem_sku ? ` ${r.sem_sku} SKU(s) sem cadastro: ligue abaixo para dar a baixa.` : "");
  } catch (e) {
    erro = mensagemErro(e);
  }
  ir(erro, ok);
}

/** Liga o SKU do marketplace ao produto (pelo código do sistema) e resolve as pendências dele. */
export async function ligarSku(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null, ok = "";
  try {
    const cod = texto(fd, "produto").split(" · ")[0].trim();
    const n = await comUsuario(u.id, async (c) => {
      const p = (await c.query("select id from app.produtos where codigo = $1 or gtin = $1 order by ativo desc limit 1", [cod])).rows[0];
      if (!p) throw new Error(`Produto "${cod}" não encontrado. Use o código do sistema.`);
      return Number((await c.query("select app.ligar_sku($1, $2) n", [texto(fd, "sku"), p.id])).rows[0].n);
    });
    ok = `SKU ligado. ${n} pendência(s) resolvida(s): estoque baixado.`;
  } catch (e) {
    erro = mensagemErro(e);
  }
  ir(erro, ok);
}

/** Pedidos cancelados no marketplace: cancela no sistema e devolve o estoque que saiu. */
export async function cancelarVendas(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null, ok = "";
  try {
    const canal = texto(fd, "canal");
    if (!["shopee", "mercado_livre", "tiktok"].includes(canal)) throw new Error("Escolha o marketplace.");
    const numeros = [...new Set(String(fd.get("numeros") ?? "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))].slice(0, 500);
    if (!numeros.length) throw new Error("Informe os números dos pedidos cancelados.");
    const n = await comUsuario(u.id, async (c) => Number((await c.query("select app.cancelar_vendas_marketplace($1, $2::text[]) n", [canal, numeros])).rows[0].n));
    ok = `${n} pedido(s) cancelado(s) e estoque devolvido.` + (n < numeros.length ? ` ${numeros.length - n} não estavam no sistema ou já estavam cancelados.` : "");
  } catch (e) {
    erro = mensagemErro(e);
  }
  ir(erro, ok);
}
