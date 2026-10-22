import type { NextRequest } from "next/server";
import { CATEGORIAS_SEM_INDICE, MARCAS_SEM_INDICE, urlCategoria, urlMarca } from "@/lib/seo";
import { catalogoSeo } from "@/lib/seo-dados";

export const dynamic = "force-dynamic";

// Mapa do site para o Google: início, páginas limpas de cada marca e categoria e páginas fixas da loja.
// Sex shop e "Outros" ficam fora (não entram no Google).
export async function GET(req: NextRequest) {
  const host = req.headers.get("host") ?? "distribuidoravirtualcosmeticos.com";
  if (/^(app|teste)\./.test(host)) return new Response("Not found", { status: 404 });
  const base = `https://${host}`;
  const { marcas, categorias } = await catalogoSeo();
  const urls: [string, string][] = [
    ["/loja", "1.0"], ["/loja/marcas", "0.8"], ["/loja/quem-somos", "0.6"], ["/loja/cadastro", "0.5"],
    ...categorias.filter((c) => !CATEGORIAS_SEM_INDICE.has(c.slug)).map((c) => [urlCategoria(c.slug), "0.8"] as [string, string]),
    ...marcas.filter((m) => !MARCAS_SEM_INDICE.has(m.nome)).sort((a, b) => b.total - a.total).map((m) => [urlMarca(m.nome), "0.8"] as [string, string]),
  ];
  const hoje = new Date().toISOString().slice(0, 10);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, p]) =>
    `  <url><loc>${base}${u}</loc><lastmod>${hoje}</lastmod><priority>${p}</priority></url>`).join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
