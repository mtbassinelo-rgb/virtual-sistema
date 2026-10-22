"use server";

import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";
import type { PoolClient } from "pg";

export type Resultado = { ok?: string; erro?: string; pedido?: string };
type Pagamento = { modalidade: string; valor: number; conta_bancaria_id?: string | null; referencia?: string | null };

const MODALIDADES = ["efetivo", "pix", "transferencia", "cartao", "deposito", "link_pagamento", "outro"];
const uuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const limparPagamentos = (p: Pagamento[]) =>
  (Array.isArray(p) ? p : []).filter((x) => MODALIDADES.includes(x.modalidade) && Number(x.valor) > 0).map((x) => ({ modalidade: x.modalidade, valor: Number(x.valor),
      conta_bancaria_id: x.conta_bancaria_id && uuid(x.conta_bancaria_id) ? x.conta_bancaria_id : null, referencia: x.referencia ? String(x.referencia).slice(0, 80) : null }));

async function rodar(ok: string, fn: (c: PoolClient) => Promise<unknown>): Promise<Resultado> {
  const u = await exigirUsuario();
  try {
    const r = await comUsuario(u.id, fn);
    revalidatePath("/caixa");
    return { ok, pedido: typeof r === "string" ? r : undefined };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

export async function abrirCaixa(_: Resultado, fd: FormData): Promise<Resultado> {
  return rodar("Caixa aberto. Boas vendas!", (c) =>
    c.query("select app.abrir_caixa($1, $2, $3)", [texto(fd, "deposito_id"), numero(fd, "fundo_gs") ?? 0, numero(fd, "fundo_brl") ?? 0]));
}

/** Preço de cada produto para a venda: tabela do cliente (com promoção) ou a tabela normal da moeda para cliente avulso. */
export async function precosParaVenda(cliente: string | null, moeda: "GS" | "BRL", produtos: string[]): Promise<Record<string, number | null>> {
  const u = await exigirUsuario();
  const ids = produtos.filter(uuid).slice(0, 300);
  if (!ids.length) return {};
  const r = await comUsuario(u.id, (c) => cliente && uuid(cliente)
    ? c.query("select p.id, f.preco from unnest($2::uuid[]) p(id) left join lateral app.preco_final_moeda($1, p.id, $3::app.moeda) f on true", [cliente, ids, moeda])
    : c.query(`select p.id, (select valor from app.precos z where z.produto_id = p.id and z.tabela = $2 and z.vigente_desde <= current_date
                               order by vigente_desde desc limit 1) as preco from unnest($1::uuid[]) p(id)`, [ids, moeda === "GS" ? "py_normal" : "br_normal"]));
  return Object.fromEntries(r.rows.map((x) => [String(x.id), x.preco == null ? null : Number(x.preco)]));
}

export async function finalizarVenda(dados: {
  caixa: string; cliente: string | null; moeda: "GS" | "BRL"; obs: string;
  itens: { produto_id: string; quantidade: number; preco: number | null }[]; pagamentos: Pagamento[];
}): Promise<Resultado> {
  if (!uuid(dados.caixa)) return { erro: "Caixa inválido." };
  const itens = dados.itens.filter((i) => uuid(i.produto_id) && Number(i.quantidade) > 0)
    .map((i) => ({ produto_id: i.produto_id, quantidade: Number(i.quantidade), preco: i.preco && i.preco > 0 ? Number(i.preco) : null }));
  return rodar("Venda registrada: estoque baixado e pagamento lançado no caixa.", async (c) =>
    (await c.query("select app.venda_balcao($1, $2, $3::app.moeda, $4::jsonb, $5::jsonb, $6) as id",
      [dados.caixa, dados.cliente && uuid(dados.cliente) ? dados.cliente : null, dados.moeda === "BRL" ? "BRL" : "GS",
       JSON.stringify(itens), JSON.stringify(limparPagamentos(dados.pagamentos)), dados.obs?.slice(0, 1000) ?? null])).rows[0].id as string);
}

export async function receberPedido(dados: { caixa: string; pedido: string; pagamentos: Pagamento[]; entregar: boolean }): Promise<Resultado> {
  if (!uuid(dados.caixa) || !uuid(dados.pedido)) return { erro: "Escolha o pedido." };
  return rodar(dados.entregar ? "Pedido recebido no caixa, entregue e baixado do estoque." : "Pagamento do pedido lançado no caixa.", (c) =>
    c.query("select app.receber_pedido_caixa($1, $2, $3::jsonb, $4)", [dados.caixa, dados.pedido, JSON.stringify(limparPagamentos(dados.pagamentos)), dados.entregar]));
}

export async function movimentoCaixa(_: Resultado, fd: FormData): Promise<Resultado> {
  const tipo = texto(fd, "tipo");
  const nomes: Record<string, string> = { reforco: "Reforço de troco lançado.", sangria: "Retirada lançada.", despesa: "Despesa lançada (e registrada no Contas a pagar da unidade)." };
  return rodar(nomes[tipo] ?? "Lançado.", (c) =>
    c.query("select app.movimento_caixa($1, $2, $3::app.moeda, $4, $5, $6, $7, $8)", [texto(fd, "caixa_id"), tipo, texto(fd, "moeda") === "BRL" ? "BRL" : "GS",
      numero(fd, "valor"), texto(fd, "descricao"), texto(fd, "destino") || null, texto(fd, "categoria") || null, uuid(texto(fd, "conta")) ? texto(fd, "conta") : null]));
}

export async function fecharCaixa(_: Resultado, fd: FormData): Promise<Resultado> {
  return rodar("Caixa fechado. O resumo fica no histórico.", (c) =>
    c.query("select app.fechar_caixa($1, $2, $3, $4)", [texto(fd, "caixa_id"), numero(fd, "contado_gs"), numero(fd, "contado_brl"), texto(fd, "observacao")]));
}

/** Gerente confirma (ou recusa) no extrato um recebimento por transferência do caixa. */
export async function confirmarRecebimento(fd: FormData): Promise<void> {
  const u = await exigirUsuario();
  try {
    await comUsuario(u.id, (c) => c.query("select app.confirmar_recebimento_caixa($1, $2, $3)", [Number(texto(fd, "mov")), texto(fd, "ok") === "1", texto(fd, "motivo") || null]));
  } catch { /* o erro aparece porque o item continua na lista */ }
  revalidatePath("/caixa");
}

/** Cadastro das contas bancárias (gerente/dono). */
export async function salvarContaBancaria(fd: FormData): Promise<void> {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  try {
    await comUsuario(u.id, (c) => id && uuid(id)
      ? c.query("update app.contas_bancarias set ativo = $2 where id = $1", [id, texto(fd, "ativo") === "1"])
      : c.query("insert into app.contas_bancarias (nome, banco, titular, moeda, deposito_id) values ($1, nullif($2, ''), nullif($3, ''), $4::app.moeda, $5)",
          [texto(fd, "nome"), texto(fd, "banco"), texto(fd, "titular"), texto(fd, "moeda") === "BRL" ? "BRL" : "GS", uuid(texto(fd, "deposito")) ? texto(fd, "deposito") : null]));
  } catch { /* sem permissão: nada muda */ }
  revalidatePath("/caixa");
}
