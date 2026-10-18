"use server";

import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";

/** Grava a contagem: o saldo da unidade fica igual ao contado (a diferença vira ajuste com motivo "Inventário"). */
export async function salvarInventario(deposito: string, linhas: { produto_id: string; contado: number }[]): Promise<{ ok?: string; erro?: string }> {
  const u = await exigirUsuario();
  if (!/^[0-9a-f-]{36}$/i.test(deposito)) return { erro: "Unidade inválida." };
  const limpas = linhas.filter((l) => /^[0-9a-f-]{36}$/i.test(l.produto_id) && Number.isFinite(l.contado) && l.contado >= 0)
    .map((l) => ({ produto_id: l.produto_id, contado: String(Math.round(l.contado)) }));
  if (!limpas.length) return { erro: "Nenhuma contagem para salvar." };
  try {
    const n = await comUsuario(u.id, async (c) => Number((await c.query("select app.registrar_inventario($1, $2::jsonb) as n", [deposito, JSON.stringify(limpas)])).rows[0].n));
    revalidatePath("/estoque");
    revalidatePath("/estoque/inventario");
    revalidatePath("/produtos");
    return { ok: `Contagem salva: ${limpas.length} produto(s) conferido(s), ${n} com saldo corrigido.` };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}
