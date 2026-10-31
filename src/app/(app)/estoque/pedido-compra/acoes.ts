"use server";

import { revalidatePath } from "next/cache";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";

const uuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/** Quantidade a comprar (unidades). 0 tira o produto do pedido. */
export async function salvarQuantidade(produtoId: string, quantidade: number): Promise<{ erro?: string }> {
  const u = await exigirUsuario();
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono monta o pedido de compra.");
    if (!uuid(produtoId)) throw new Error("Produto inválido.");
    if (!Number.isInteger(quantidade) || quantidade < 0 || quantidade > 1000000) throw new Error("Quantidade inválida (número inteiro de unidades).");
    await comUsuario(u.id, (c) => c.query("select app.compra_definir_qtd($1, $2)", [produtoId, quantidade]));
    return {};
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

/** Custo de compra por unidade, em R$, sem frete. Muda o custo do produto no sistema (não mexe em preço de venda). */
export async function salvarCusto(produtoId: string, custo: number): Promise<{ erro?: string }> {
  const u = await exigirUsuario();
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono altera o custo.");
    if (!uuid(produtoId)) throw new Error("Produto inválido.");
    if (!Number.isFinite(custo) || custo < 0 || custo > 100000) throw new Error("Custo inválido (em R$, sem frete).");
    await comUsuario(u.id, (c) => c.query("select app.compra_definir_custo($1, $2)", [produtoId, custo]));
    return {};
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

/** Zera as quantidades da marca, para começar o próximo pedido. */
export async function zerarPedido(marca: string): Promise<{ ok?: string; erro?: string }> {
  const u = await exigirUsuario();
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono zera o pedido de compra.");
    if (!marca.trim()) throw new Error("Escolha a marca.");
    const n = await comUsuario(u.id, async (c) => Number((await c.query("select app.compra_zerar($1) n", [marca])).rows[0].n));
    revalidatePath("/estoque/pedido-compra");
    return { ok: `${n} produto(s) zerado(s).` };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}
