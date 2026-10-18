import type { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { LINHAS, interno, marcaDe } from "@/lib/vitrine";

export const dynamic = "force-dynamic";

// Mapa do site para o Google: início, marcas, categorias e páginas fixas da loja.
export async function GET(req: NextRequest) {
  const base = `https://${req.headers.get("host") ?? "distribuidoravirtualcosmeticos.com"}`;
  const produtos = (await pool.query("select nome, marca from app.vitrine_publica()")).rows as { nome: string; marca: string | null }[];
  const marcas = [...new Set(produtos.filter((p) => !interno(p.nome)).map((p) => marcaDe(p.nome, p.marca)).filter((m): m is string => Boolean(m)))];
  const urls = ["/loja", "/loja/marcas", "/loja/quem-somos", "/loja/cadastro", "/loja?promocao=1",
    ...LINHAS.map((l) => `/loja?linha=${l.chave}`), ...marcas.map((m) => `/loja?marca=${encodeURIComponent(m)}`)];
  const hoje = new Date().toISOString().slice(0, 10);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) =>
    `  <url><loc>${base}${u.replace(/&/g, "&amp;")}</loc><lastmod>${hoje}</lastmod></url>`).join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
