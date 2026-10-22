import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TEXTOS, idiomaAtual } from "@/lib/idioma";
import { CATEGORIAS_SEM_INDICE, MARCAS_SEM_INDICE, SEO, trilha, urlCategoria } from "@/lib/seo";
import { catalogoSeo, principais } from "@/lib/seo-dados";
import { Vitrine, type Filtros } from "../../vitrine";

// Página de categoria (ex.: /loja/categorias/kits): o catálogo da categoria com título e texto próprios para o Google.
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Filtros> };

async function dados(s: string) {
  const idioma = await idiomaAtual();
  const { categorias } = await catalogoSeo(idioma === "es");
  const c = categorias.find((x) => x.slug === s);
  if (!c) return null;
  const marcas = principais(c.marcas, 5).filter((m) => !MARCAS_SEM_INDICE.has(m));
  return { c, idioma, seo: SEO[idioma], marcas };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await dados((await params).slug);
  if (!d) return { title: "Categoria", robots: { index: false } };
  return {
    title: { absolute: d.seo.tituloCategoria(d.c.nome) },
    description: d.seo.descricaoCategoria(d.c.nome, d.c.total),
    alternates: { canonical: urlCategoria(d.c.slug) },
    openGraph: { title: d.seo.tituloCategoria(d.c.nome), description: d.seo.descricaoCategoria(d.c.nome, d.c.total), url: urlCategoria(d.c.slug) },
    ...(CATEGORIAS_SEM_INDICE.has(d.c.slug) ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function PaginaCategoria({ params, searchParams }: Props) {
  const d = await dados((await params).slug);
  if (!d) notFound();
  const f = await searchParams;
  const json = trilha([[TEXTOS[d.idioma].inicio, "/loja"], [TEXTOS[d.idioma].categorias, "/loja"], [d.c.nome, urlCategoria(d.c.slug)]]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }} />
      <Vitrine f={{ vista: f.vista, pagina: f.pagina, sub: f.sub, linha: d.c.slug }}
               cabecalho={{ h1: d.seo.h1Categoria(d.c.nome), texto: d.seo.textoCategoria(d.c.nome, d.c.total, d.marcas) }} />
    </>
  );
}
