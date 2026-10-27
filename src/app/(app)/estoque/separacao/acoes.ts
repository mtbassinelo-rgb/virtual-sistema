"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { texto } from "@/lib/formato";

/** Estoquista confirma o que separou: quantidade exata de cada item (ou "Não tem") e o total de caixas. Não altera o pedido. */
export async function confirmarSeparacao(fd: FormData) {
  const u = await exigirUsuario();
  const pedido = texto(fd, "pedido_id");
  let erro: string | null = null;
  try {
    const itens: { item_id: string; quantidade: number | null }[] = [];
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("sep_")) continue;
      const id = k.slice(4);
      const bruto = String(v).trim().replace(",", ".");
      const q = fd.get(`falta_${id}`) === "on" ? 0 : bruto === "" ? null : Number(bruto);
      if (q !== null && !Number.isFinite(q)) throw new Error("Quantidade separada inválida.");
      if (q !== null) itens.push({ item_id: id, quantidade: q });
    }
    const caixas = texto(fd, "caixas");
    await comUsuario(u.id, (c) => c.query("select app.confirmar_separacao_estoque($1, $2::jsonb, $3)",
      [pedido, JSON.stringify(itens), caixas === "" ? null : Math.round(Number(caixas))]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/estoque/separacao");
  if (erro) redirect(`/estoque/separacao/${pedido}?erro=${encodeURIComponent(erro)}`);
  redirect(`/estoque/separacao?ok=${encodeURIComponent("Separação confirmada. A vendedora já vê o que foi separado e o que faltou.")}`);
}
