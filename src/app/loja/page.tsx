import type { Metadata } from "next";
import { idiomaAtual } from "@/lib/idioma";
import { CATEGORIAS_SEM_INDICE, MARCAS_SEM_INDICE, SEO, urlCategoria, urlMarca } from "@/lib/seo";
import { Vitrine, type Filtros } from "./vitrine";

type Props = { searchParams: Promise<Filtros> };

/**
 * Título e descrição para o Google. Filtro só de marca ou só de categoria aponta (canonical) para a página limpa
 * (/loja/marcas/..., /loja/categorias/...); busca não entra no Google.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const f = await searchParams;
  const seo = SEO[await idiomaAtual()];
  const outros = Boolean(f.q || f.promocao || f.novidade || f.sub);
  if (f.marca && !f.linha && !outros) {
    return { title: { absolute: seo.tituloMarca(f.marca) }, alternates: { canonical: urlMarca(f.marca) },
      ...(MARCAS_SEM_INDICE.has(f.marca) ? { robots: { index: false, follow: true } } : {}) };
  }
  if (f.linha && !f.marca && !outros) {
    return { alternates: { canonical: urlCategoria(f.linha) },
      ...(CATEGORIAS_SEM_INDICE.has(f.linha) ? { robots: { index: false, follow: true } } : {}) };
  }
  if (f.q || f.marca || f.linha) return { title: { absolute: seo.tituloInicio }, robots: { index: false, follow: true }, alternates: { canonical: "/loja" } };
  return { title: { absolute: seo.tituloInicio }, description: seo.descricaoInicio, alternates: { canonical: "/loja" } };
}

export default async function PaginaLoja({ searchParams }: Props) {
  return <Vitrine f={await searchParams} />;
}
