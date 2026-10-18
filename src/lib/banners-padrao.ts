import type { Idioma } from "./idioma";

export type Banner = { id: string; titulo: string; subtitulo: string | null; imagem: string | null; link: string | null };

/** Banners do site enquanto a equipe não cadastrar os próprios (Loja online → Banners e destaques). */
export function bannersPadrao(idioma: Idioma, cliente: boolean): Banner[] {
  const es = idioma === "es";
  const lista: Banner[] = [
    { id: "p-maycrene", imagem: "/banners/kits-maycrene.webp", link: "/loja?marca=Maycrene",
      titulo: es ? "Kits capilares Maycrene" : "Kits capilares Maycrene",
      subtitulo: es ? "Champú, acondicionador y máscara. Caja cerrada con 12 kits." : "Shampoo, condicionador e máscara. Caixa fechada com 12 kits." },
    { id: "p-atacado", imagem: "/banners/atacado-caixa.webp", link: cliente ? "/loja#catalogo" : "/loja/cadastro",
      titulo: es ? "Precio mayorista por caja cerrada" : "Preço de atacado na caixa fechada",
      subtitulo: cliente
        ? (es ? "Vea el precio de la caja y de la unidad en cada producto." : "Veja o preço da caixa e da unidade em cada produto.")
        : (es ? "Salones, perfumerías y revendedoras. Pida su acceso." : "Salões, perfumarias e revendedoras. Peça o seu acesso.") },
    { id: "p-marylife", imagem: "/banners/mary-life-paises.webp", link: "/loja?q=mary%20life",
      titulo: es ? "Body Splash Mary Life" : "Body Splash Mary Life",
      subtitulo: es ? "Dubái, Madrid, París, Río, Las Vegas y Tokio. Cabello y cuerpo." : "Dubai, Madri, Paris, Rio, Las Vegas e Tóquio. Cabelo e corpo." },
    { id: "p-rhenuks", imagem: "/banners/rhenuks.webp", link: "/loja?marca=Rhenuks",
      titulo: es ? "Rhenuks: kits y perfumería árabe" : "Rhenuks: kits e perfumaria árabe",
      subtitulo: es ? "Argan Oils, Babosa y los body splash inspirados en grandes perfumes." : "Argan Oils, Babosa e os body splash inspirados em grandes perfumes." },
  ];
  return lista;
}
