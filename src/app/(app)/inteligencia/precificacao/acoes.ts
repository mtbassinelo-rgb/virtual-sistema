"use server";

import { rm } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { pastaFotos } from "@/lib/arquivos";
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

/** Inativar ou excluir produtos direto da precificação. Excluir: quem já teve pedido ou estoque fica só inativo (histórico mantido). */
export async function produtosLotePrecificacao(ids: string[], op: "inativar" | "excluir"): Promise<{ ok?: string; erro?: string }> {
  const u = await exigirUsuario();
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono inativa ou exclui produtos.");
    const lista = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
    if (!lista.length) throw new Error("Nenhum produto escolhido.");
    if (op !== "inativar" && op !== "excluir") throw new Error("Operação inválida.");
    const r = await comUsuario(u.id, async (c) => (await c.query("select app.produtos_em_lote($1::uuid[], $2) as r", [lista, op])).rows[0].r as
      { excluidos?: number; inativados_por_historico?: number; fotos?: string[] } | number);
    if (op === "excluir" && r && typeof r === "object")
      for (const f of r.fotos ?? []) await rm(path.join(pastaFotos(), path.basename(f)), { force: true });
    revalidatePath("/inteligencia/precificacao"); revalidatePath("/produtos"); revalidatePath("/loja");
    if (op === "inativar") return { ok: `${lista.length} produto(s) inativado(s). Para voltar: Produtos → filtro Inativos.` };
    const o = r as { excluidos?: number; inativados_por_historico?: number };
    return { ok: `${o.excluidos ?? 0} excluído(s)${o.inativados_por_historico ? `; ${o.inativados_por_historico} já tinham pedido ou estoque e ficaram só inativos` : ""}.` };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

/** Edição em massa: troca a marca dos produtos escolhidos. */
export async function marcaEmMassa(ids: string[], marca: string): Promise<{ ok?: string; erro?: string }> {
  const u = await exigirUsuario();
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono altera a marca.");
    const m = marca.trim().toUpperCase();
    if (m.length < 1 || m.length > 80) throw new Error("Informe a marca.");
    const lista = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 1000);
    if (!lista.length) throw new Error("Nenhum produto escolhido.");
    const n = await comUsuario(u.id, async (c) => (await c.query("update app.produtos set marca = $2 where id = any($1::uuid[]) and marca is distinct from $2", [lista, m])).rowCount ?? 0);
    revalidatePath("/inteligencia/precificacao"); revalidatePath("/produtos"); revalidatePath("/loja");
    return { ok: `Marca ${m} aplicada em ${n} produto(s).` };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}
