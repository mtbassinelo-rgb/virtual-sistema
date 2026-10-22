"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { texto } from "@/lib/formato";

const valor = (v: FormDataEntryValue | null) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : null; };
const volta = (fd: FormData, erro: string | null, ok: string) => {
  revalidatePath("/produtos/precos-cde");
  const v = texto(fd, "volta") || "/produtos/precos-cde";
  redirect(`${v}${v.includes("?") ? "&" : "?"}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
};

/** Salva os preços digitados: campos n:<codigo> (CDE Normal) e v:<codigo> (CDE VIP); só os que mudaram. */
export async function salvarPrecosCde(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null, n = 0;
  try {
    const linhas: { codigo: string; tabela: string; valor: number }[] = [];
    for (const [k, v] of fd.entries()) {
      const m = k.match(/^([nv]):(.+)$/);
      if (!m) continue;
      const novo = valor(v), antes = valor(fd.get(`a${m[1]}:${m[2]}`));
      if (novo != null && novo !== antes) linhas.push({ codigo: m[2], tabela: m[1] === "n" ? "cde_normal" : "cde_vip", valor: novo });
    }
    if (!linhas.length) throw new Error("Nenhum preço mudou.");
    await comUsuario(u.id, (c) => c.query("select app.importar_precos($1::jsonb)", [JSON.stringify(linhas)]));
    n = linhas.length;
  } catch (e) {
    erro = mensagemErro(e);
  }
  volta(fd, erro, `${n} preço(s) de CDE salvos.`);
}

/** CDE = preço do Paraguai + X% para os produtos do filtro (só preenche os que não têm, ou todos se marcar). */
export async function preencherPrecosCde(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null, n = 0;
  try {
    const pct = Number(String(texto(fd, "pct")).replace(",", "."));
    if (!Number.isFinite(pct) || pct < -50 || pct > 300) throw new Error("Informe o percentual (ex.: 10 para 10% acima do Paraguai).");
    const ids = String(fd.get("ids") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    if (!ids.length) throw new Error("Nenhum produto no filtro.");
    const todos = fd.get("sobrescrever") === "1";
    n = await comUsuario(u.id, async (c) => {
      const r = await c.query(`
        select p.codigo, t.dest tabela, app.arredondar_preco(pr.valor * (1 + $2::numeric / 100), 'GS') valor
          from app.produtos p
          cross join (values ('py_normal', 'cde_normal'), ('py_vip', 'cde_vip')) t(orig, dest)
          join lateral (select valor from app.precos z where z.produto_id = p.id and z.tabela = t.orig and z.vigente_desde <= current_date
                         order by vigente_desde desc limit 1) pr on true
         where p.id = any($1::uuid[]) and p.codigo is not null
           and ($3 or not exists (select 1 from app.precos z where z.produto_id = p.id and z.tabela = t.dest))`, [ids, pct, todos]);
      if (!r.rows.length) return 0;
      await c.query("select app.importar_precos($1::jsonb)", [JSON.stringify(r.rows.map((x) => ({ codigo: x.codigo, tabela: x.tabela, valor: Number(x.valor) })))]);
      return r.rows.length;
    });
  } catch (e) {
    erro = mensagemErro(e);
  }
  volta(fd, erro, n ? `${n} preço(s) de CDE preenchidos a partir do Paraguai.` : "Nada a preencher (já tinham preço de CDE).");
}
