import "server-only";
import { cache } from "react";
import { pool } from "./db";
import { categoriasDe, interno, linhasEfetivas, marcaDe, type CategoriaDb, type Linha } from "./vitrine";
import { slug } from "./seo";

type Resumo = { nome: string; slug: string; total: number; linhas: Map<string, number>; marcas: Map<string, number> };

/** Marcas e categorias do site público, com contagem de produtos (para as páginas de marca/categoria e o sitemap). */
export const catalogoSeo = cache(async (es = false) => {
  const produtos = (await pool.query("select produto_id, nome, marca, tipo from app.vitrine_publica()")).rows as { produto_id: string; nome: string; marca: string | null; tipo: string }[];
  const manuais = new Map<string, string[] | null>(((await pool.query("select produto_id, categorias from app.vitrine_categorias()").catch(() => ({ rows: [] }))).rows as { produto_id: string; categorias: string[] | null }[]).map((r) => [r.produto_id, r.categorias]));
  const cats = linhasEfetivas((await pool.query("select * from app.categorias_publicas()").catch(() => ({ rows: [] }))).rows as CategoriaDb[], es);
  const marcas = new Map<string, Resumo>(), categorias = new Map<string, Resumo>();
  const novo = (nome: string, s: string): Resumo => ({ nome, slug: s, total: 0, linhas: new Map(), marcas: new Map() });
  for (const p of produtos) {
    if (interno(p.nome)) continue;
    const { linha, extras } = categoriasDe(p.nome, p.marca, p.tipo, manuais.get(p.produto_id));
    const m = marcaDe(p.nome, p.marca);
    if (m) {
      const r = marcas.get(m) ?? novo(m, slug(m)); marcas.set(m, r);
      r.total++; r.linhas.set(linha, (r.linhas.get(linha) ?? 0) + 1);
    }
    for (const l of [linha, ...extras]) {
      const nome = cats.lista.find((x: Linha) => x.chave === l)?.nome;
      if (!nome) continue;
      const r = categorias.get(l) ?? novo(nome, l); categorias.set(l, r);
      r.total++; if (m) r.marcas.set(m, (r.marcas.get(m) ?? 0) + 1);
    }
  }
  return { marcas: [...marcas.values()], categorias: [...categorias.values()], cats };
});

/** As chaves mais frequentes de um mapa de contagem. */
export const principais = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
