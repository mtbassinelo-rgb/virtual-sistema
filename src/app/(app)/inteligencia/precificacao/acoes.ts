"use server";

import { revalidatePath } from "next/cache";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";

type Linha = { id: string; codigo: string; custo?: number | null; origem?: string; frete?: number | null; caixa?: number | null; normal?: number | null; vip?: number | null };

/** Grava o que mudou na tela de precificação: custo/frete (R$), peças por caixa e preços PY Normal/VIP (Gs). */
export async function salvarPrecificacao(fd: FormData): Promise<{ ok?: string; erro?: string }> {
  const u = await exigirUsuario();
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono altera custos e preços.");
    const dados = JSON.parse(String(fd.get("dados") ?? "[]")) as Linha[];
    if (!Array.isArray(dados) || dados.length === 0) throw new Error("Nada para salvar.");
    if (dados.length > 2000) throw new Error("Alterações demais de uma vez.");
    for (const d of dados) {
      if (d.custo != null && (d.custo < 0 || d.custo > 100000)) throw new Error(`Custo inválido em ${d.codigo}.`);
      if (d.frete != null && (d.frete < 0 || d.frete > 10000)) throw new Error(`Frete inválido em ${d.codigo}.`);
      if (d.caixa != null && (!Number.isInteger(d.caixa) || d.caixa < 1 || d.caixa > 1000)) throw new Error(`Peças por caixa de ${d.codigo}: número inteiro de 1 a 1000.`);
      for (const p of [d.normal, d.vip]) if (p != null && (p < 500 || p > 100000000)) throw new Error(`Preço inválido em ${d.codigo} (em Gs, ex.: 15000).`);
      if (d.normal != null && d.vip != null && d.vip > d.normal) throw new Error(`O VIP de ${d.codigo} ficou maior que o Normal.`);
    }
    const r = await comUsuario(u.id, async (c) => {
      const custos = dados.filter((d) => d.custo != null || d.frete != null)
        .map((d) => ({ codigo: d.codigo, custo: d.custo ?? null, frete: d.frete ?? null, origem: d.custo != null ? (d.origem ?? "Editado na precificação") : null }));
      const caixas = dados.filter((d) => d.caixa != null).map((d) => ({ codigo: d.codigo, unidades: String(d.caixa) }));
      const precos = dados.flatMap((d) => [
        ...(d.normal != null ? [{ codigo: d.codigo, tabela: "py_normal", valor: d.normal }] : []),
        ...(d.vip != null ? [{ codigo: d.codigo, tabela: "py_vip", valor: d.vip }] : []),
      ]);
      const rc = custos.length ? (await c.query("select app.importar_custos($1::jsonb, 'Editado na precificação') r", [JSON.stringify(custos)])).rows[0].r : { custos: 0, fretes: 0 };
      const nc = caixas.length ? Number((await c.query("select app.definir_caixas($1::jsonb) n", [JSON.stringify(caixas)])).rows[0].n) : 0;
      const np = precos.length ? Number((await c.query("select app.importar_precos($1::jsonb) r", [JSON.stringify(precos)])).rows[0].r.alterados) : 0;
      return { custos: Number(rc.custos), fretes: Number(rc.fretes), nc, np };
    });
    revalidatePath("/inteligencia/precificacao");
    revalidatePath("/produtos");
    const partes = [r.custos && `${r.custos} custo(s)`, r.fretes && `${r.fretes} frete(s)`, r.nc && `${r.nc} caixa(s)`, r.np && `${r.np} preço(s)`].filter(Boolean);
    return { ok: partes.length ? `Salvo: ${partes.join(", ")}.` : "Nada mudou." };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}
