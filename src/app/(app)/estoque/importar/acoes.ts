"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { texto } from "@/lib/formato";
import { apagarLote, guardarLote, interpretarPlanilhaBling, lerLote } from "@/lib/importar-bling";

const voltar = (q: string): never => redirect(`/estoque/importar?${q}`);

/** Passo 1: recebe o arquivo, confere e guarda para a prévia. Nada é gravado no cadastro ainda. */
export async function enviarPlanilha(fd: FormData) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) voltar("erro=" + encodeURIComponent("Só gerente ou dono importa produtos."));
  const arq = fd.get("arquivo");
  let destino: string;
  try {
    if (!(arq instanceof File) || arq.size === 0) throw new Error("Escolha o arquivo exportado do Bling.");
    if (/\.xlsx?$/i.test(arq.name)) throw new Error("Exporte do Bling no formato CSV (não XLS).");
    if (arq.size > 10 * 1024 * 1024) throw new Error("Arquivo grande demais (máximo 10 MB).");
    const linhas = interpretarPlanilhaBling(Buffer.from(await arq.arrayBuffer()));
    destino = "lote=" + (await guardarLote(arq.name, u.id, linhas));
  } catch (e) {
    destino = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  voltar(destino);
}

/** Passo 2: grava produtos (e, se escolhido, estoque e preço) numa única transação. */
export async function confirmarImportacao(fd: FormData) {
  const u = await exigirUsuario();
  const loteId = texto(fd, "lote");
  const lote = await lerLote(loteId, u.id);
  if (!lote) voltar("erro=" + encodeURIComponent("Essa prévia expirou. Envie o arquivo de novo."));
  let ok: string | null = null, erro: string | null = null;
  try {
    const deposito = texto(fd, "deposito_id") || null;
    const tabela = texto(fd, "tabela_preco") || null;
    const r = await comUsuario(u.id, (c) => c.query(
      "select app.importar_produtos_bling($1::jsonb, $2, $3, $4) as r",
      [JSON.stringify(lote!.linhas), deposito, tabela, `planilha ${lote!.arquivo}`.slice(0, 120)]));
    const s = r.rows[0].r as Record<string, number>;
    ok = `Importação concluída: ${s.novos} produto(s) novo(s), ${s.atualizados} atualizado(s)` +
      (deposito ? `, estoque ajustado em ${s.estoque_ajustado}` : "") +
      (tabela ? `, ${s.precos} preço(s) definido(s)` : "") +
      (s.codigo_provisorio ? `. ${s.codigo_provisorio} ficaram com código provisório (BLING-…): corrija no Bling e importe de novo.` : ".");
    await apagarLote(loteId);
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/estoque");
  if (erro) voltar(`lote=${loteId}&erro=${encodeURIComponent(erro)}`);
  redirect(`/estoque?ok=${encodeURIComponent(ok!)}`);
}

export async function descartarLote(fd: FormData) {
  await exigirUsuario();
  await apagarLote(texto(fd, "lote"));
  voltar("");
}
