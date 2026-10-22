"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";

async function executar(volta: string, ok: string, fn: (uid: string) => Promise<void>) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    await fn(u.id);
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/despesas");
  const base = volta.startsWith("/despesas") ? volta : "/despesas";
  redirect(`${base}${base.includes("?") ? "&" : "?"}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
}

/** Soma meses a uma data AAAA-MM-DD mantendo o dia (ou o último dia do mês). */
function somarMeses(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 + n, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

export async function lancarDespesa(fd: FormData) {
  const repetir = Math.min(Math.max(Math.trunc(numero(fd, "repetir") ?? 1), 1), 24);
  await executar(texto(fd, "volta"), repetir > 1 ? `${repetir} contas lançadas.` : "Conta lançada.", async (uid) => {
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new Error("Informe o valor.");
    const moeda = texto(fd, "moeda") === "BRL" ? "BRL" : "GS";
    const vencimento = texto(fd, "vencimento");
    const competencia = texto(fd, "competencia");
    const paga = texto(fd, "paga") === "1";
    if (repetir > 1 && !vencimento) throw new Error("Para repetir todo mês, informe o primeiro vencimento.");
    await comUsuario(uid, async (c) => {
      for (let i = 0; i < repetir; i++) {
        const venc = vencimento ? somarMeses(vencimento, i) : null;
        const comp = i === 0 && /^\d{4}-\d{2}$/.test(competencia) ? `${competencia}-01` : venc;
        await c.query(
          `insert into app.despesas (categoria, descricao, fornecedor, moeda, valor, competencia, vencimento, pago_em, forma, cambio, documento, observacao, deposito_id)
           values ($1, $2, nullif($3,''), $4, $5, $6::date, $7::date, $8::date, nullif($9,''), $10, nullif($11,''), nullif($12,''), nullif($13,'')::uuid)`,
          [texto(fd, "categoria"), texto(fd, "descricao") + (repetir > 1 ? ` (${i + 1}/${repetir})` : ""), texto(fd, "fornecedor"),
           moeda, valor, comp, venc, paga && i === 0 ? (texto(fd, "pago_em") || venc || new Date().toISOString().slice(0, 10)) : null,
           texto(fd, "forma"), numero(fd, "cambio"), texto(fd, "documento"), texto(fd, "observacao"), texto(fd, "deposito")]);
      }
    });
  });
}

export async function pagarDespesa(fd: FormData) {
  await executar(texto(fd, "volta"), "Conta marcada como paga.", async (uid) => {
    const data = texto(fd, "pago_em") || new Date().toISOString().slice(0, 10);
    const r = await comUsuario(uid, (c) => c.query(
      `update app.despesas set pago_em = $2::date, valor_pago = coalesce($3, valor), forma = coalesce(nullif($4,''), forma)
        where id = $1 and pago_em is null`, [texto(fd, "id"), data, numero(fd, "valor_pago"), texto(fd, "forma")]));
    if (r.rowCount === 0) throw new Error("Conta não encontrada ou já paga.");
  });
}

export async function desfazerPagamento(fd: FormData) {
  await executar(texto(fd, "volta"), "Pagamento desfeito: a conta voltou para a lista a pagar.", async (uid) => {
    const r = await comUsuario(uid, (c) => c.query("update app.despesas set pago_em = null where id = $1 and pago_em is not null", [texto(fd, "id")]));
    if (r.rowCount === 0) throw new Error("Conta não encontrada.");
  });
}

export async function apagarDespesa(fd: FormData) {
  await executar(texto(fd, "volta"), "Conta apagada.", async (uid) => {
    const r = await comUsuario(uid, (c) => c.query("delete from app.despesas where id = $1", [texto(fd, "id")]));
    if (r.rowCount === 0) throw new Error("Só é possível apagar conta ainda não paga.");
  });
}

/** Conta fixa: o sistema lança a conta de cada mês sozinho (a do mês atual já sai na hora). */
export async function salvarRecorrente(fd: FormData) {
  await executar(texto(fd, "volta"), "Conta fixa salva: a conta deste mês e as próximas são lançadas sozinhas.", async (uid) => {
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new Error("Informe o valor.");
    const dia = Math.trunc(numero(fd, "dia") ?? 0);
    if (dia < 1 || dia > 28) throw new Error("Dia do vencimento entre 1 e 28.");
    const inicio = /^\d{4}-\d{2}$/.test(texto(fd, "inicio")) ? `${texto(fd, "inicio")}-01` : null;
    await comUsuario(uid, async (c) => {
      await c.query(`insert into app.despesas_recorrentes (categoria, descricao, fornecedor, moeda, valor, dia_vencimento, inicio, criado_por, deposito_id)
                     values ($1, $2, nullif($3, ''), $4, $5, $6, coalesce($7::date, date_trunc('month', current_date)::date), app.uid(), nullif($8, '')::uuid)`,
        [texto(fd, "categoria"), texto(fd, "descricao"), texto(fd, "fornecedor"), texto(fd, "moeda") === "BRL" ? "BRL" : "GS", valor, dia, inicio, texto(fd, "deposito")]);
      await c.query("select app.gerar_despesas_recorrentes(current_date)");
    });
  });
}

export async function encerrarRecorrente(fd: FormData) {
  await executar(texto(fd, "volta"), "Conta fixa encerrada: não será mais lançada (as já lançadas continuam).", async (uid) => {
    const r = await comUsuario(uid, (c) => c.query(
      "update app.despesas_recorrentes set ativo = false, fim = date_trunc('month', current_date)::date where id = $1 and ativo", [texto(fd, "id")]));
    if (r.rowCount === 0) throw new Error("Conta fixa não encontrada.");
    // a do próximo mês, se já tinha sido lançada e não foi paga, sai
    await comUsuario(uid, (c) => c.query(
      "delete from app.despesas where recorrente_id = $1 and pago_em is null and competencia > date_trunc('month', current_date)", [texto(fd, "id")]));
  });
}

export async function alterarValorRecorrente(fd: FormData) {
  await executar(texto(fd, "volta"), "Valor da conta fixa atualizado (vale para os próximos meses).", async (uid) => {
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new Error("Informe o valor.");
    const r = await comUsuario(uid, (c) => c.query("update app.despesas_recorrentes set valor = $2 where id = $1 and ativo", [texto(fd, "id"), valor]));
    if (r.rowCount === 0) throw new Error("Conta fixa não encontrada.");
    await comUsuario(uid, (c) => c.query(
      "update app.despesas set valor = $2 where recorrente_id = $1 and pago_em is null and competencia > date_trunc('month', current_date)", [texto(fd, "id"), valor]));
  });
}
