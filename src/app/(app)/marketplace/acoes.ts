"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { texto } from "@/lib/formato";

/** Marca ou desmarca um produto como de marketplace (sai/volta para as telas de preço e catálogo). */
export async function marcarMarketplace(fd: FormData) {
  let erro: string | null = null;
  const valor = texto(fd, "valor") === "1";
  let nome = "";
  try {
    const u = await exigirUsuario();
    if (!ehGestao(u)) throw new Error("Só gerente ou dono muda isso.");
    const codigo = texto(fd, "codigo").split(" · ")[0].trim();
    if (!codigo) throw new Error("Informe o código do produto.");
    nome = await comUsuario(u.id, async (c) => {
      const r = await c.query("update app.produtos set marketplace = $2 where codigo = $1 returning nome", [codigo, valor]);
      if (!r.rowCount) throw new Error(`Produto "${codigo}" não encontrado.`);
      return String(r.rows[0].nome);
    });
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/marketplace");
  const ok = valor ? `${nome} agora fica só no Marketplace.` : `${nome} voltou para o catálogo da distribuidora.`;
  redirect(`/marketplace?aba=anuncios&${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
}
