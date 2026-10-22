import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TEXTOS, idiomaAtual } from "@/lib/idioma";
import { CATEGORIAS_SEM_INDICE, MARCAS_SEM_INDICE, SEO, trilha, urlMarca } from "@/lib/seo";
import { catalogoSeo, principais } from "@/lib/seo-dados";
import { Vitrine, type Filtros } from "../../vitrine";

// Página de marca (ex.: /loja/marcas/maycrene): o catálogo da marca com título e texto próprios para o Google.
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Filtros> };

async function dados(s: string) {
  const idioma = await idiomaAtual();
  const { marcas, cats } = await catalogoSeo(idioma === "es");
  const m = marcas.find((x) => x.slug === s);
  if (!m) return null;
  const nomes = { ...TEXTOS[idioma].linhas, ...cats.nomes };
  const linhas = principais(m.linhas, 4).filter((l) => !CATEGORIAS_SEM_INDICE.has(l)).map((l) => (nomes[l] ?? l).toLowerCase());
  return { m, idioma, seo: SEO[idioma], linhas };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await dados((await params).slug);
  if (!d) return { title: "Marca", robots: { index: false } };
  return {
    title: { absolute: d.seo.tituloMarca(d.m.nome) },
    description: d.seo.descricaoMarca(d.m.nome, d.m.total),
    alternates: { canonical: urlMarca(d.m.nome) },
    openGraph: { title: d.seo.tituloMarca(d.m.nome), description: d.seo.descricaoMarca(d.m.nome, d.m.total), url: urlMarca(d.m.nome) },
    ...(MARCAS_SEM_INDICE.has(d.m.nome) ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function PaginaMarca({ params, searchParams }: Props) {
  const d = await dados((await params).slug);
  if (!d) notFound();
  const f = await searchParams;
  const json = trilha([[TEXTOS[d.idioma].inicio, "/loja"], [TEXTOS[d.idioma].marcas, "/loja/marcas"], [d.m.nome, urlMarca(d.m.nome)]]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }} />
      <Vitrine f={{ vista: f.vista, pagina: f.pagina, marca: d.m.nome }}
               cabecalho={{ h1: d.seo.h1Marca(d.m.nome), texto: d.seo.textoMarca(d.m.nome, d.m.total, d.linhas) }} />
    </>
  );
}
