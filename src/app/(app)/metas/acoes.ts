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
  revalidatePath("/metas");
  redirect(`/metas?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
}

export async function proporMeta(fd: FormData) {
  await executar("Meta enviada para aprovação do gerente.", async (uid) => {
    const meta = numero(fd, "valor_meta");
    const premio = numero(fd, "valor_premio");
    if (!meta || !premio) throw new Error("Informe o valor da meta e do prêmio.");
    await comUsuario(uid, (c) => c.query(
      `insert into app.metas_cliente (cliente_id, vendedora_id, inicio, fim, moeda, valor_meta, tipo_premio, valor_premio, descricao_premio)
       select c.id, c.vendedora_id, $2::date, $3::date, c.moeda, $4, $5::app.tipo_premio, $6, nullif($7,'')
         from app.clientes c where c.id = $1`,
      [texto(fd, "cliente_id"), texto(fd, "inicio"), texto(fd, "fim"), meta, texto(fd, "tipo_premio") || "mercadoria", premio, texto(fd, "descricao_premio")]));
  });
}

export async function decidirMeta(fd: FormData) {
  const aprovar = texto(fd, "decisao") === "aprovar";
  await executar(aprovar ? "Meta aprovada." : "Meta recusada.", (uid) =>
    comUsuario(uid, (c) => c.query("select app.decidir_meta($1, $2, nullif($3,''))", [texto(fd, "meta_id"), aprovar, texto(fd, "motivo")])));
}

export async function cancelarMeta(fd: FormData) {
  await executar("Proposta cancelada.", (uid) =>
    comUsuario(uid, (c) => c.query("update app.metas_cliente set status = 'cancelada' where id = $1 and status = 'proposta'", [texto(fd, "meta_id")])));
}

export async function avaliarMetas() {
  await executar("Metas vencidas avaliadas.", (uid) => comUsuario(uid, (c) => c.query("select app.avaliar_metas()")));
}

export async function entregarPremio(fd: FormData) {
  await executar("Entrega do prêmio registrada.", (uid) =>
    comUsuario(uid, (c) => c.query("select app.entregar_premio($1, null, nullif($2,''))", [texto(fd, "meta_id"), texto(fd, "observacao")])));
}
