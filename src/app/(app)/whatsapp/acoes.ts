"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { texto } from "@/lib/formato";

/** Assumir a conversa (vendedora) ou escolher a vendedora responsável (gerente/dono; vazio = tirar). */
export async function atribuirConversa(fd: FormData) {
  const u = await exigirUsuario();
  const vend = texto(fd, "vendedora_id") || (texto(fd, "assumir") ? u.vendedora_id ?? "" : "");
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.whatsapp_atribuir($1, $2, nullif($3, '')::uuid)",
      [texto(fd, "conexao_id"), texto(fd, "contato"), vend]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  const volta = texto(fd, "volta");
  const destino = volta.startsWith("/") && !volta.startsWith("//") ? volta : "/whatsapp";
  revalidatePath("/whatsapp");
  revalidatePath("/desempenho");
  redirect(`${destino}${destino.includes("?") ? "&" : "?"}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(vend ? "Conversa atribuída." : "Conversa sem vendedora.")}`);
}
