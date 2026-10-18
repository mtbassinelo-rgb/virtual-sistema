"use server";

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";
import { copyFile } from "node:fs/promises";
import { pastaFotos, pastaFotosCatalogo, tipoImagem } from "@/lib/arquivos";
import { baixarFotoDoLink } from "@/lib/foto-link";

const TABELAS = ["py_normal", "py_vip", "br_normal", "br_vip"] as const;

/** Cria ou edita um produto: dados, preços (valem a partir de hoje) e foto, numa única ida. */
export async function salvarProduto(fd: FormData) {
  const u = await exigirUsuario();
  const idAtual = texto(fd, "id") || null;
  let destino: string;
  let fotoNova: string | null = null;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono cadastra produtos.");

    // Foto: confere o conteúdo antes de gravar qualquer coisa
    const arq = fd.get("foto");
    let bytes: Buffer | null = null, ext: string | null = null;
    if (arq instanceof File && arq.size > 0) {
      if (arq.size > 5 * 1024 * 1024) throw new Error("Foto grande demais: máximo 5 MB.");
      bytes = Buffer.from(await arq.arrayBuffer());
      ext = tipoImagem(bytes);
      if (!ext) throw new Error("A foto precisa ser JPG, PNG ou WEBP.");
    } else if (texto(fd, "foto_link")) {
      ({ bytes, ext } = await baixarFotoDoLink(texto(fd, "foto_link")));
    }

    const id = await comUsuario(u.id, async (c) => {
      const r = await c.query("select app.salvar_produto($1, $2, $3, $4, $5, $6, $7, $8) as id", [
        idAtual, texto(fd, "codigo"), texto(fd, "nome"), texto(fd, "marca"), texto(fd, "unidade"), texto(fd, "gtin"),
        numero(fd, "custo"), fd.get("ativo") === "on"]);
      const pid = String(r.rows[0].id);
      await c.query("select app.definir_destaque($1, $2)", [pid, fd.get("destaque") === "on"]);
      await c.query("select app.definir_novidade($1, $2)", [pid, fd.get("novidade") === "on"]);
      await c.query("select app.definir_mostrar_no_site($1::uuid[], $2)", [[pid], fd.get("mostrar_no_site") === "on"]);
      const cod = (await c.query("select codigo from app.produtos where id = $1", [pid])).rows[0].codigo;
      await c.query("select app.definir_caixas($1::jsonb)", [JSON.stringify([{ codigo: cod, unidades: texto(fd, "unidades_caixa").replace(/\D/g, "") }])]);
      const precos = TABELAS.map((t) => ({ codigo: cod, tabela: t, valor: numero(fd, t) })).filter((p) => p.valor != null);
      if (precos.length) await c.query("select app.importar_precos($1::jsonb)", [JSON.stringify(precos)]);
      // Kit: componentes digitados como "código — nome" (até 6 linhas)
      if (fd.get("kit") === "on") {
        const comps: { produto_id: string; quantidade: number }[] = [];
        for (let k = 0; k < 6; k++) {
          const cod = texto(fd, `comp_${k}`).split(" — ")[0].trim();
          if (!cod) continue;
          const q = Number(texto(fd, `qtd_${k}`).replace(",", ".")) || 1;
          const r = (await c.query("select id from app.produtos where codigo = $1", [cod])).rows[0];
          if (!r) throw new Error(`Produto do kit não encontrado: "${cod}". Escolha da lista.`);
          if (String(r.id) === pid) throw new Error("O kit não pode conter ele mesmo.");
          comps.push({ produto_id: String(r.id), quantidade: q });
        }
        if (comps.length === 0) throw new Error("Informe os produtos que formam o kit.");
        // kit não tem estoque próprio: zera o saldo que existir antes de virar kit (fica no histórico)
        for (const s of (await c.query("select deposito_id from app.estoque_saldos where produto_id = $1 and quantidade <> 0", [pid])).rows)
          await c.query("select app.ajustar_estoque($1, $2, 0, 'Produto virou kit: o estoque passa a ser dos produtos do kit')", [s.deposito_id, pid]);
        await c.query("select app.definir_kit($1, $2::jsonb)", [pid, JSON.stringify(comps)]);
      } else if ((await c.query("select 1 from app.kit_componentes where kit_id = $1 limit 1", [pid])).rowCount) {
        await c.query("select app.definir_kit($1, '[]'::jsonb)", [pid]);
      }
      // Foto vinda do catálogo (criar produto a partir da foto)
      const fc = texto(fd, "foto_catalogo");
      if (!bytes && /^p[0-9]{2}-[0-9]{2}$/.test(fc)) {
        await mkdir(pastaFotos(), { recursive: true });
        const nome = `${pid}-${Date.now()}.webp`;
        await copyFile(path.join(pastaFotosCatalogo(), `${fc}.webp`), path.join(pastaFotos(), nome));
        fotoNova = nome;
        const antiga = (await c.query("select app.definir_foto($1, $2) as antiga", [pid, `/fotos/${nome}`])).rows[0].antiga as string | null;
        await c.query("select app.decidir_foto_catalogo($1, 'aplicar', $2)", [fc, pid]);
        if (antiga) await rm(path.join(pastaFotos(), path.basename(antiga)), { force: true });
      }
      if (bytes && ext) {
        await mkdir(pastaFotos(), { recursive: true });
        const nome = `${pid}-${Date.now()}.${ext}`;
        await writeFile(path.join(pastaFotos(), nome), bytes);
        fotoNova = nome;
        const antiga = (await c.query("select app.definir_foto($1, $2) as antiga", [pid, `/fotos/${nome}`])).rows[0].antiga as string | null;
        if (antiga) await rm(path.join(pastaFotos(), path.basename(antiga)), { force: true });
      }
      return pid;
    });
    destino = `/produtos/${id}?ok=${encodeURIComponent(idAtual ? "Produto salvo." : "Produto criado.")}`;
  } catch (e) {
    if (fotoNova) await rm(path.join(pastaFotos(), fotoNova), { force: true });   // a transação voltou atrás: some o arquivo também
    destino = `${idAtual ? `/produtos/${idAtual}` : "/produtos/novo"}?erro=${encodeURIComponent(mensagemErro(e))}`;
  }
  revalidatePath("/produtos");
  revalidatePath("/loja");
  redirect(destino);
}

export async function removerFoto(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  let q = "ok=" + encodeURIComponent("Foto removida.");
  try {
    const antiga = await comUsuario(u.id, async (c) => (await c.query("select app.definir_foto($1, null) as antiga", [id])).rows[0].antiga as string | null);
    if (antiga) await rm(path.join(pastaFotos(), path.basename(antiga)), { force: true });
  } catch (e) {
    q = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  revalidatePath("/loja");
  redirect(`/produtos/${id}?${q}`);
}

/** Ativar, inativar ou excluir vários produtos de uma vez (lista de Produtos). */
export async function produtosEmLote(fd: FormData) {
  const u = await exigirUsuario();
  const ids = fd.getAll("ids").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const acao = texto(fd, "acao");
  const v = texto(fd, "volta");
  const volta = /^\/produtos(\?[\w=&%.+-]*)?$/.test(v) ? v : "/produtos";
  let q: string;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono altera produtos em lote.");
    if (!["ativar", "inativar", "excluir", "caixa"].includes(acao)) throw new Error("Escolha o que fazer com os produtos selecionados.");
    if (ids.length === 0) throw new Error("Marque pelo menos um produto.");
    if (acao === "caixa") {
      const unidades = texto(fd, "unidades").replace(/\D/g, "");
      if (!unidades) throw new Error("Informe quantas peças vêm na caixa.");
      const n = await comUsuario(u.id, async (c) => {
        const cods = (await c.query("select codigo from app.produtos where id = any($1::uuid[])", [ids])).rows.map((r) => ({ codigo: r.codigo, unidades }));
        return Number((await c.query("select app.definir_caixas($1::jsonb) as n", [JSON.stringify(cods)])).rows[0].n);
      });
      q = "ok=" + encodeURIComponent(`Caixa com ${unidades} peça(s) definida em ${n} produto(s).`);
    } else {
    const r = await comUsuario(u.id, async (c) => (await c.query("select app.produtos_em_lote($1::uuid[], $2) as r", [ids, acao])).rows[0].r as
      { ativados: number; inativados: number; excluidos: number; inativados_por_historico: number; fotos: string[] });
    for (const f of r.fotos) await rm(path.join(pastaFotos(), path.basename(f)), { force: true });
    const partes = [
      r.ativados && `${r.ativados} ativado(s)`,
      r.inativados && `${r.inativados} inativado(s)`,
      r.excluidos && `${r.excluidos} excluído(s)`,
      r.inativados_por_historico && `${r.inativados_por_historico} não podia(m) ser excluído(s) porque já tem pedido ou movimento de estoque, então ficou(aram) inativo(s)`,
    ].filter(Boolean);
    q = "ok=" + encodeURIComponent(partes.length ? partes.join(" · ") + "." : "Nada mudou: os produtos já estavam assim.");
    }
  } catch (e) {
    q = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  revalidatePath("/produtos");
  revalidatePath("/loja");
  redirect(`${volta}${volta.includes("?") ? "&" : "?"}${q}`);
}

/** Salva as peças por caixa digitadas direto na lista de Produtos (uma página inteira de uma vez). */
export async function salvarCaixas(fd: FormData) {
  const u = await exigirUsuario();
  const v = texto(fd, "volta");
  const volta = /^\/produtos(\?[\w=&%.+-]*)?$/.test(v) ? v : "/produtos";
  let q: string;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono altera produtos.");
    const pares: { id: string; unidades: string }[] = [];
    for (const [k, val] of fd.entries()) {
      const m = /^caixa:([0-9a-f-]{36})$/i.exec(k);
      if (m) pares.push({ id: m[1], unidades: String(val).replace(/\D/g, "") });
    }
    const n = await comUsuario(u.id, async (c) => {
      const cod = new Map((await c.query("select id::text, codigo from app.produtos where id = any($1::uuid[])", [pares.map((p) => p.id)])).rows.map((r) => [r.id, r.codigo]));
      const linhas = pares.filter((p) => cod.has(p.id)).map((p) => ({ codigo: cod.get(p.id), unidades: p.unidades }));
      return Number((await c.query("select app.definir_caixas($1::jsonb) as n", [JSON.stringify(linhas)])).rows[0].n);
    });
    q = "ok=" + encodeURIComponent(n ? `Peças por caixa salvas em ${n} produto(s).` : "Nada mudou.");
  } catch (e) {
    q = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  revalidatePath("/produtos");
  revalidatePath("/loja");
  redirect(`${volta}${volta.includes("?") ? "&" : "?"}${q}`);
}

/** Troca a foto na hora (arrastar, colar ou link), sem precisar salvar o resto do produto. */
export async function enviarFotoProduto(fd: FormData): Promise<{ erro?: string; foto?: string }> {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  let nome: string | null = null;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono altera fotos.");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Produto inválido.");
    let bytes: Buffer, ext: "jpg" | "png" | "webp" | null;
    const arq = fd.get("foto");
    if (arq instanceof File && arq.size > 0) {
      if (arq.size > 5 * 1024 * 1024) throw new Error("Foto grande demais: máximo 5 MB.");
      bytes = Buffer.from(await arq.arrayBuffer());
      ext = tipoImagem(bytes);
      if (!ext) throw new Error("A foto precisa ser JPG, PNG ou WEBP.");
    } else if (texto(fd, "foto_link")) {
      ({ bytes, ext } = await baixarFotoDoLink(texto(fd, "foto_link")));
    } else throw new Error("Arraste uma foto, cole uma imagem ou informe o link da foto.");
    await mkdir(pastaFotos(), { recursive: true });
    nome = `${id}-${Date.now()}.${ext}`;
    await writeFile(path.join(pastaFotos(), nome), bytes);
    const antiga = await comUsuario(u.id, async (c) => (await c.query("select app.definir_foto($1, $2) as antiga", [id, `/fotos/${nome}`])).rows[0].antiga as string | null);
    if (antiga) await rm(path.join(pastaFotos(), path.basename(antiga)), { force: true });
    revalidatePath("/produtos");
    revalidatePath("/loja");
    return { foto: `/fotos/${nome}` };
  } catch (e) {
    if (nome) await rm(path.join(pastaFotos(), nome), { force: true });
    return { erro: mensagemErro(e) };
  }
}

/** "20.000" → 20000 · "39,90" → 39.9 · vazio → null */
function valorDigitado(s: string): number | null {
  let t = s.replace(/\s|R\$|Gs/gi, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Valor inválido: "${s}". Use só números, como 15000 ou 9,90.`);
  return n;
}

/** Tabela de produtos: salva de uma vez preços, peças por caixa e estoque mínimo alterados (só gerente ou dono). */
export async function salvarGradeProdutos(fd: FormData) {
  const u = await exigirUsuario();
  const v = texto(fd, "volta");
  const volta = /^\/produtos(\?[\w=&%.+-]*)?$/.test(v) ? v : "/produtos";
  let q: string;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono altera preços, caixa e estoque mínimo.");
    const precos: { id: string; tabela: string; valor: number }[] = [];
    const caixas: { id: string; unidades: string }[] = [];
    const minimos: { id: string; minimo: string }[] = [];
    for (const [k, val] of fd.entries()) {
      const s = String(val);
      let m = /^p:([0-9a-f-]{36}):(py_normal|py_vip|br_normal|br_vip)$/i.exec(k);
      if (m) { const n = valorDigitado(s); if (n != null) precos.push({ id: m[1], tabela: m[2], valor: n }); continue; }
      m = /^caixa:([0-9a-f-]{36})$/i.exec(k);
      if (m) { caixas.push({ id: m[1], unidades: s.replace(/\D/g, "") }); continue; }
      m = /^min:([0-9a-f-]{36})$/i.exec(k);
      if (m) minimos.push({ id: m[1], minimo: s.replace(/\D/g, "") });
    }
    if (!precos.length && !caixas.length && !minimos.length) throw new Error("Nenhuma alteração para salvar.");
    const r = await comUsuario(u.id, async (c) => {
      const ids = [...new Set([...precos, ...caixas].map((x) => x.id))];
      const cod = new Map((await c.query("select id::text, codigo from app.produtos where id = any($1::uuid[])", [ids])).rows.map((x) => [x.id, x.codigo]));
      let nc = 0, np = 0, nm = 0;
      if (caixas.length) nc = Number((await c.query("select app.definir_caixas($1::jsonb) as n",
        [JSON.stringify(caixas.filter((x) => cod.has(x.id)).map((x) => ({ codigo: cod.get(x.id), unidades: x.unidades })))])).rows[0].n);
      if (precos.length) np = Number((await c.query("select app.importar_precos($1::jsonb) as r",
        [JSON.stringify(precos.filter((p) => cod.has(p.id)).map((p) => ({ codigo: cod.get(p.id), tabela: p.tabela, valor: p.valor })))])).rows[0].r.alterados);
      if (minimos.length) nm = Number((await c.query("select app.definir_estoque_minimo($1::jsonb) as n", [JSON.stringify(minimos)])).rows[0].n);
      return { nc, np, nm };
    });
    const partes = [r.np && `${r.np} preço(s)`, r.nc && `${r.nc} caixa(s)`, r.nm && `${r.nm} estoque(s) mínimo(s)`].filter(Boolean);
    q = "ok=" + encodeURIComponent(partes.length ? `Salvo: ${partes.join(", ")}.` : "Nada mudou.");
  } catch (e) {
    q = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  revalidatePath("/produtos");
  revalidatePath("/loja");
  redirect(`${volta}${volta.includes("?") ? "&" : "?"}${q}`);
}

/** Botão A/D da lista: ativa ou desativa um produto no site na hora. */
export async function alternarAtivo(id: string, ativar: boolean): Promise<{ erro?: string }> {
  const u = await exigirUsuario();
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono ativa ou desativa produtos.");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Produto inválido.");
    await comUsuario(u.id, (c) => c.query("select app.produtos_em_lote(array[$1::uuid], $2)", [id, ativar ? "ativar" : "inativar"]));
    revalidatePath("/produtos");
    revalidatePath("/loja");
    return {};
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

/** Botão E da lista: exclui o produto. Quem já teve pedido ou estoque fica inativo em vez de apagado. */
export async function excluirProduto(id: string): Promise<{ erro?: string; msg?: string }> {
  const u = await exigirUsuario();
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono exclui produtos.");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Produto inválido.");
    const r = await comUsuario(u.id, async (c) => (await c.query("select app.produtos_em_lote(array[$1::uuid], 'excluir') as r", [id])).rows[0].r as
      { excluidos: number; inativados_por_historico: number; fotos: string[] });
    for (const f of r.fotos) await rm(path.join(pastaFotos(), path.basename(f)), { force: true });
    revalidatePath("/produtos");
    revalidatePath("/loja");
    return { msg: r.excluidos ? "Produto excluído." : "Esse produto já tem pedido ou movimento de estoque, então não pode ser apagado: ficou desativado." };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}
