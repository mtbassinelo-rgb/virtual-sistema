"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";

async function executar(ok: string, fn: (uid: string) => Promise<unknown>) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    await fn(u.id);
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/promocoes");
  redirect(`/promocoes?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
}

export async function proporPromocao(fd: FormData) {
  await executar("Promoção enviada para aprovação.", async (uid) => {
    const paises = texto(fd, "pais") === "ambos" ? ["PY", "BR"] : [texto(fd, "pais")];
    await comUsuario(uid, async (c) => {
      for (const pais of paises) {
        await c.query(
          `insert into app.promocoes (produto_id, pais, desconto_pct, inicio, fim, limite_qtd, motivo, origem)
           values ($1, $2::app.pais, $3, $4::date, $5::date, $6, nullif($7,''), $8)`,
          [texto(fd, "produto_id"), pais, numero(fd, "desconto"), texto(fd, "inicio"), texto(fd, "fim"),
           numero(fd, "limite"), texto(fd, "motivo"), texto(fd, "origem") === "sugestao_giro" ? "sugestao_giro" : "manual"]);
      }
    });
  });
}

export async function decidirPromocao(fd: FormData) {
  const aprovar = texto(fd, "decisao") === "aprovar";
  await executar(aprovar ? "Promoção aprovada: já aparece para os clientes." : "Promoção recusada.", (uid) =>
    comUsuario(uid, (c) => c.query("select app.decidir_promocao($1, $2, nullif($3,''))", [texto(fd, "id"), aprovar, texto(fd, "motivo")])));
}

export async function encerrarPromocao(fd: FormData) {
  await executar("Promoção encerrada.", (uid) =>
    comUsuario(uid, (c) => c.query("update app.promocoes set status = 'encerrada' where id = $1 and status in ('proposta','aprovada')", [texto(fd, "id")])));
}
