"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";

const voltar = (msg: string, erro: boolean) =>
  redirect(`/financeiro/vendas-avulsas?${erro ? "erro" : "ok"}=${encodeURIComponent(msg)}`);

export async function lancarVendaAvulsa(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.lancar_venda_avulsa($1, $2, $3, $4, $5, $6)",
      [texto(fd, "deposito") || null, texto(fd, "data") || null, texto(fd, "moeda") === "BRL" ? "BRL" : "GS",
       numero(fd, "valor"), texto(fd, "descricao"), numero(fd, "custo")]));
  } catch (e) { erro = mensagemErro(e); }
  revalidatePath("/"); revalidatePath("/unidades"); revalidatePath("/financeiro");
  voltar(erro ?? "Venda avulsa lançada.", !!erro);
}

export async function excluirVendaAvulsa(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.excluir_venda_avulsa($1)", [texto(fd, "id")]));
  } catch (e) { erro = mensagemErro(e); }
  revalidatePath("/"); revalidatePath("/unidades"); revalidatePath("/financeiro");
  voltar(erro ?? "Venda avulsa excluída.", !!erro);
}
