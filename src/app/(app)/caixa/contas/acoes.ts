"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";

async function executar(fd: FormData, ok: string, fn: (uid: string) => Promise<void>) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try { await fn(u.id); } catch (e) { erro = mensagemErro(e); }
  revalidatePath("/caixa/contas");
  const u2 = `/caixa/contas?u=${encodeURIComponent(texto(fd, "deposito"))}`;
  redirect(`${u2}&${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
}

export async function lancarContaUnidade(fd: FormData) {
  await executar(fd, "Conta lançada.", async (uid) => {
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new Error("Informe o valor.");
    const paga = fd.get("paga") === "1";
    await comUsuario(uid, (c) => c.query(
      `insert into app.despesas (categoria, descricao, fornecedor, moeda, valor, competencia, vencimento, pago_em, forma, documento, deposito_id)
       values ($1, $2, nullif($3, ''), $4::app.moeda, $5, coalesce($6::date, current_date), $6::date, $7::date, nullif($8, ''), nullif($9, ''), $10)`,
      [texto(fd, "categoria"), texto(fd, "descricao"), texto(fd, "fornecedor"), texto(fd, "moeda") === "BRL" ? "BRL" : "GS", valor,
       texto(fd, "vencimento") || null, paga ? (texto(fd, "pago_em") || new Date().toISOString().slice(0, 10)) : null, texto(fd, "forma"), texto(fd, "documento"), texto(fd, "deposito")]));
  });
}

export async function pagarContaUnidade(fd: FormData) {
  await executar(fd, "Conta paga.", async (uid) => {
    const r = await comUsuario(uid, (c) => c.query(
      "update app.despesas set pago_em = coalesce($2::date, current_date), valor_pago = coalesce($3, valor), forma = coalesce(nullif($4, ''), forma) where id = $1 and pago_em is null",
      [texto(fd, "id"), texto(fd, "pago_em") || null, numero(fd, "valor_pago"), texto(fd, "forma")]));
    if (r.rowCount === 0) throw new Error("Conta não encontrada ou já paga.");
  });
}

export async function apagarContaUnidade(fd: FormData) {
  await executar(fd, "Conta apagada.", async (uid) => {
    const r = await comUsuario(uid, (c) => c.query("delete from app.despesas where id = $1 and pago_em is null", [texto(fd, "id")]));
    if (r.rowCount === 0) throw new Error("Só dá para apagar conta ainda não paga.");
  });
}
