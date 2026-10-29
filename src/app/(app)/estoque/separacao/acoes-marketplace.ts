"use server";

import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";

/** Marca o pedido do marketplace como separado. Sai da fila de todas as telas abertas (aviso ao vivo). */
export async function marcarSeparadoMarketplace(id: number): Promise<{ erro: string | null }> {
  const u = await exigirUsuario();
  try {
    await comUsuario(u.id, (c) => c.query("select app.marketplace_marcar_separado($1)", [id]));
    return { erro: null };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

/** Pedido cancelado depois de separado: confirma que os produtos voltaram para a prateleira. */
export async function confirmarDevolucaoMarketplace(id: number): Promise<{ erro: string | null }> {
  const u = await exigirUsuario();
  try {
    await comUsuario(u.id, (c) => c.query("select app.marketplace_confirmar_devolucao($1)", [id]));
    return { erro: null };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}
