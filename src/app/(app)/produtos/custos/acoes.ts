"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";

const num = (v: FormDataEntryValue | null) => {
  let s = String(v ?? "").trim().replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Grava só as linhas marcadas: ok:<codigo> = "1", custo:<codigo> = novo custo por unidade (R$). */
export async function corrigirCustos(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null, n = 0;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono corrige custos.");
    const linhas: { codigo: string; custo: number; origem: string }[] = [];
    for (const [k] of fd.entries()) {
      const m = k.match(/^ok:(.+)$/);
      if (!m) continue;
      const c = num(fd.get(`custo:${m[1]}`));
      if (c == null) throw new Error(`Informe o custo do código ${m[1]}.`);
      linhas.push({ codigo: m[1], custo: Math.round(c * 10000) / 10000, origem: "Revisão de custos (custo da caixa ÷ unidades)" });
    }
    if (!linhas.length) throw new Error("Marque pelo menos um produto para corrigir.");
    const r = await comUsuario(u.id, (c) => c.query("select app.importar_custos($1::jsonb, 'Revisão de custos') r", [JSON.stringify(linhas)]));
    n = Number(r.rows[0]?.r?.custos ?? 0);
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/produtos/custos");
  revalidatePath("/financeiro");
  redirect(`/produtos/custos?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(`${n} custo(s) corrigido(s).`)}`);
}
