"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";

function voltar(erro: string | null, ok: string, mes?: string) {
  revalidatePath("/calendario");
  redirect(`/calendario?${mes ? `mes=${mes}&` : ""}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
}

/** Gerente/dono cadastra ou edita uma data (feriado, data comercial ou evento do mês). */
export async function salvarData(fd: FormData) {
  let erro: string | null = null;
  const mesVolta = texto(fd, "mes_volta");
  try {
    const u = await exigirUsuario();
    if (!ehGestao(u)) throw new Error("Só gerente ou dono edita o calendário.");
    const nome = texto(fd, "nome").trim();
    if (nome.length < 2) throw new Error("Informe o nome da data.");
    const pais = ["BR", "PY", "AMBOS"].includes(texto(fd, "pais")) ? texto(fd, "pais") : "AMBOS";
    const tipo = ["feriado", "comemorativa", "evento"].includes(texto(fd, "tipo")) ? texto(fd, "tipo") : "evento";
    const quando = texto(fd, "data");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(quando)) throw new Error("Informe a data.");
    const repete = fd.get("repete") === "on";
    const [, m, d] = quando.split("-").map(Number);
    const antecedencia = Math.max(0, Math.min(120, Math.trunc(numero(fd, "antecedencia") ?? 15)));
    const id = texto(fd, "id");
    const valores = [pais, nome.slice(0, 120), tipo, repete ? m : null, repete ? d : null, repete ? null : quando,
      texto(fd, "dica").trim().slice(0, 1000) || null, texto(fd, "produtos").trim().slice(0, 500) || null, antecedencia];
    await comUsuario(u.id, async (c) => {
      if (/^[0-9a-f-]{36}$/i.test(id)) {
        await c.query(`update app.datas_comerciais set pais=$1, nome=$2, tipo=$3, mes=$4, dia=$5, data=$6, dica=$7, produtos=$8, antecedencia=$9 where id=$10`,
          [...valores, id]);
      } else {
        await c.query(`insert into app.datas_comerciais (pais, nome, tipo, mes, dia, data, dica, produtos, antecedencia)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, valores);
      }
    });
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar(erro, "Data salva no calendário.", mesVolta);
}

export async function desativarData(fd: FormData) {
  let erro: string | null = null;
  const mesVolta = texto(fd, "mes_volta");
  try {
    const u = await exigirUsuario();
    if (!ehGestao(u)) throw new Error("Só gerente ou dono edita o calendário.");
    const id = texto(fd, "id");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Data inválida.");
    await comUsuario(u.id, (c) => c.query("update app.datas_comerciais set ativo = false where id = $1", [id]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar(erro, "Data removida do calendário.", mesVolta);
}
