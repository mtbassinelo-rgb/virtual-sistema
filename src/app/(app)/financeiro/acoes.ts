"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";

export async function salvarMetaEmpresa(fd: FormData) {
  const u = await exigirUsuario();
  const mes = /^\d{4}-\d{2}$/.test(texto(fd, "mes")) ? texto(fd, "mes") : new Date().toISOString().slice(0, 7);
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.salvar_meta_empresa($1, $2, $3, $4, $5, $6)",
      [`${mes}-01`, numero(fd, "vendas_brl"), numero(fd, "vendas_gs"), numero(fd, "compras_brl"), numero(fd, "lucro_brl"), texto(fd, "obs") || null]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/financeiro");
  redirect(`/financeiro?aba=metas&mes=${mes}&${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Metas do mês salvas.")}`);
}
