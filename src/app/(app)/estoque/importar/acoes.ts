"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { texto } from "@/lib/formato";
import { apagarLote, guardarLote, interpretarPlanilhaBling, lerLote, type LinhaBling } from "@/lib/importar-bling";

const voltar = (q: string): never => redirect(`/estoque/importar?${q}`);

/** Passo 1: recebe o arquivo, confere e guarda para a prévia. Nada é gravado no cadastro ainda. */
export async function enviarPlanilha(fd: FormData) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) voltar("erro=" + encodeURIComponent("Só gerente ou dono importa produtos."));
  // Pode enviar vários arquivos de uma vez (o Bling às vezes exporta em partes): viram uma importação só
  const arquivos = fd.getAll("arquivo").filter((a): a is File => a instanceof File && a.size > 0);
  let destino: string;
  try {
    if (arquivos.length === 0) throw new Error("Escolha o arquivo exportado do Bling.");
    if (arquivos.length > 20) throw new Error("Envie no máximo 20 arquivos de uma vez.");
    const porId = new Map<number, LinhaBling>();
    for (const arq of arquivos) {
      if (/\.xlsx?$/i.test(arq.name)) throw new Error(`${arq.name}: exporte do Bling no formato CSV (não XLS).`);
      if (arq.size > 10 * 1024 * 1024) throw new Error(`${arq.name}: arquivo grande demais (máximo 10 MB).`);
      // o mesmo produto em dois arquivos entra uma vez só (vale o último arquivo)
      for (const l of interpretarPlanilhaBling(Buffer.from(await arq.arrayBuffer()))) porId.set(l.bling_id, l);
    }
    const nome = arquivos.length === 1 ? arquivos[0].name : `${arquivos.length} arquivos (${arquivos.map((a) => a.name).join(", ")})`;
    destino = "lote=" + (await guardarLote(nome.slice(0, 200), u.id, [...porId.values()]));
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
    const modo = texto(fd, "modo") === "estoque" ? "estoque" : "completo";
    const deposito = texto(fd, "deposito_id") || null;
    const tabela = modo === "completo" ? texto(fd, "tabela_preco") || null : null;
    if (modo === "estoque" && !deposito) throw new Error("Escolha o depósito que recebe o estoque.");
    const r = await comUsuario(u.id, (c) => c.query(
      "select app.importar_bling($1::jsonb, $2, $3, $4, $5) as r",
      [JSON.stringify(lote!.linhas), deposito, tabela, `planilha ${lote!.arquivo}`.slice(0, 120), modo]));
    const s = r.rows[0].r as Record<string, number> & { lista_nao_encontrados: { nome: string }[] };
    const partes = modo === "estoque"
      ? [`Estoque atualizado: ${s.estoque_ajustado} produto(s) mudaram de quantidade`]
      : [`Importação concluída: ${s.novos} produto(s) novo(s), ${s.atualizados} atualizado(s)`];
    if (modo === "completo" && deposito) partes.push(`estoque ajustado em ${s.estoque_ajustado}`);
    if (s.juntados) partes.push(`${s.juntados} cadastro(s) repetido(s) do Bling juntado(s) (estoque somado)`);
    if (deposito && s.esgotados) partes.push(`${s.esgotados} com estoque 0 aparecem como Esgotado na loja`);
    if (tabela) partes.push(`${s.precos} preço(s) definido(s)`);
    if (s.codigo_provisorio) partes.push(`${s.codigo_provisorio} com código provisório (BLING-…): corrija no Bling e importe de novo`);
    if (s.nao_encontrados) {
      const nomes = s.lista_nao_encontrados.slice(0, 5).map((x) => x.nome).join("; ");
      partes.push(`${s.nao_encontrados} produto(s) da planilha não estão cadastrados aqui e ficaram de fora (${nomes}${s.nao_encontrados > 5 ? "…" : ""}). Para trazê-los, importe com "Cadastro e estoque"`);
    }
    ok = partes.join(" · ") + ".";
    await apagarLote(loteId);
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/estoque");
  revalidatePath("/loja");
  if (erro) voltar(`lote=${loteId}&erro=${encodeURIComponent(erro)}`);
  redirect(`/estoque?ok=${encodeURIComponent(ok!)}`);
}

export async function descartarLote(fd: FormData) {
  await exigirUsuario();
  await apagarLote(texto(fd, "lote"));
  voltar("");
}
