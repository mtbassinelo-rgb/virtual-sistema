// SEO do site da loja: endereço oficial, URLs limpas de marca e categoria e os textos que o Google lê.
// Palavra-chave principal: "distribuidora de cosméticos em Foz do Iguaçu".
// Regra do site público: não citar o Paraguai nem a loja de CDE.

import type { Idioma } from "./idioma";

export const SITE = "https://distribuidoravirtualcosmeticos.com";
export const WHATSAPP_SITE = "+55 45 99997-2092";

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "Bio Instinto e Mary Life" → "bio-instinto-e-mary-life" */
export function slug(texto: string): string {
  return sem(texto).replace(/&/g, " e ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export const urlMarca = (marca: string) => `/loja/marcas/${slug(marca)}`;
export const urlCategoria = (chave: string) => `/loja/categorias/${chave}`;

/** Categoria e marcas de conteúdo adulto ficam fora do Google (o SafeSearch pode filtrar o site inteiro). */
export const CATEGORIAS_SEM_INDICE = new Set(["sexshop", "outros"]);
export const MARCAS_SEM_INDICE = new Set(["Sexy Fantasy"]);

type Bloco = { titulo: string; paragrafos: string[] };

export const SEO = {
  pt: {
    tituloInicio: "Distribuidora de Cosméticos em Foz do Iguaçu | Virtual Cosméticos",
    descricaoInicio: "Distribuidora de cosméticos direto de fábrica em Foz do Iguaçu. Atacado em caixa fechada: Maycrene, Rhenuks, Soul, Bio Instinto e mais. Peça pelo WhatsApp.",
    h1Inicio: "Distribuidora de cosméticos em Foz do Iguaçu, direto de fábrica",
    blocoInicio: (marcas: string[]): Bloco => ({
      titulo: "Atacado de cosméticos em Foz do Iguaçu",
      paragrafos: [
        `A Virtual Cosméticos é uma distribuidora de cosméticos em Foz do Iguaçu que vende direto de fábrica para salões de beleza, perfumarias, farmácias e revendedoras. Trabalhamos no atacado em caixa fechada, com as marcas que mais giram: ${lista(marcas, "e")}.`,
        "No catálogo você encontra kits capilares (shampoo, condicionador e máscara), matizadores, body splash, cremes hidratantes, sabonetes íntimos, skin care, maquiagem e produtos para unhas e cílios. Monte o pedido no site, envie pelo WhatsApp e receba o total com o preço de atacado. Enviamos a partir de Foz do Iguaçu para todo o Brasil.",
      ],
    }),
    tituloMarca: (m: string) => `${m} no Atacado | Distribuidora em Foz do Iguaçu`,
    descricaoMarca: (m: string, n: number) => `${m} no atacado direto da distribuidora em Foz do Iguaçu: ${n} produtos em caixa fechada para salões, perfumarias e revendedoras. Peça pelo WhatsApp.`,
    h1Marca: (m: string) => `${m} no atacado`,
    textoMarca: (m: string, n: number, linhas: string[]) => [
      `Compre ${m} no atacado na Virtual Cosméticos, distribuidora de cosméticos direto de fábrica em Foz do Iguaçu. São ${n} produtos ${m}${linhas.length ? ` nas linhas ${lista(linhas, "e")}` : ""}, vendidos em caixa fechada para salões de beleza, perfumarias, farmácias e revendedoras.`,
      "Monte o pedido aqui, envie pelo WhatsApp e a nossa equipe confirma o estoque e o preço de atacado. Clientes cadastrados veem o preço da unidade e da caixa direto no site.",
    ],
    tituloCategoria: (c: string) => `${c} no Atacado | Distribuidora de Cosméticos em Foz do Iguaçu`,
    descricaoCategoria: (c: string, n: number) => `${c} no atacado em caixa fechada: ${n} produtos direto da distribuidora de cosméticos em Foz do Iguaçu. Para salões, perfumarias e revendedoras.`,
    h1Categoria: (c: string) => `${c} no atacado`,
    textoCategoria: (c: string, n: number, marcas: string[]) => [
      `${c} no atacado na Virtual Cosméticos, distribuidora de cosméticos em Foz do Iguaçu: ${n} produtos em caixa fechada${marcas.length ? ` das marcas ${lista(marcas, "e")}` : ""}.`,
      "Escolha os produtos, envie o pedido pelo WhatsApp e receba o total com preço de atacado. Enviamos a partir de Foz do Iguaçu.",
    ],
    tituloMarcas: "Marcas de Cosméticos no Atacado | Virtual Cosméticos Foz do Iguaçu",
    descricaoMarcas: "Todas as marcas da distribuidora Virtual Cosméticos em Foz do Iguaçu: Maycrene, Rhenuks, Soul, Bio Instinto e Mary Life, Phalle Beauty e mais, no atacado.",
  },
  es: {
    tituloInicio: "Distribuidora de Cosméticos en Foz do Iguaçu | Virtual Cosméticos",
    descricaoInicio: "Distribuidora de cosméticos directo de fábrica en Foz do Iguaçu. Venta al por mayor en caja cerrada: Maycrene, Rhenuks, Soul y más. Pedidos por WhatsApp.",
    h1Inicio: "Distribuidora de cosméticos en Foz do Iguaçu, directo de fábrica",
    blocoInicio: (marcas: string[]): Bloco => ({
      titulo: "Cosméticos al por mayor en Foz do Iguaçu",
      paragrafos: [
        `Virtual Cosméticos es una distribuidora de cosméticos en Foz do Iguaçu que vende directo de fábrica a salones de belleza, perfumerías, farmacias y revendedoras. Vendemos al por mayor en caja cerrada las marcas brasileñas que más se venden: ${lista(marcas, "y")}.`,
        "En el catálogo encontrará kits capilares (champú, acondicionador y máscara), matizadores, body splash, cremas hidratantes, jabones íntimos, skin care, maquillaje y productos para uñas y pestañas. Arme el pedido en el sitio, envíelo por WhatsApp y reciba el total con el precio mayorista.",
      ],
    }),
    tituloMarca: (m: string) => `${m} al por Mayor | Distribuidora en Foz do Iguaçu`,
    descricaoMarca: (m: string, n: number) => `${m} al por mayor directo de la distribuidora en Foz do Iguaçu: ${n} productos en caja cerrada para salones, perfumerías y revendedoras.`,
    h1Marca: (m: string) => `${m} al por mayor`,
    textoMarca: (m: string, n: number, linhas: string[]) => [
      `Compre ${m} al por mayor en Virtual Cosméticos, distribuidora de cosméticos directo de fábrica en Foz do Iguaçu. Son ${n} productos ${m}${linhas.length ? ` en las líneas ${lista(linhas, "y")}` : ""}, en caja cerrada para salones de belleza, perfumerías, farmacias y revendedoras.`,
      "Arme el pedido aquí, envíelo por WhatsApp y nuestro equipo confirma el stock y el precio mayorista.",
    ],
    tituloCategoria: (c: string) => `${c} al por Mayor | Distribuidora de Cosméticos en Foz do Iguaçu`,
    descricaoCategoria: (c: string, n: number) => `${c} al por mayor en caja cerrada: ${n} productos directo de la distribuidora de cosméticos en Foz do Iguaçu.`,
    h1Categoria: (c: string) => `${c} al por mayor`,
    textoCategoria: (c: string, n: number, marcas: string[]) => [
      `${c} al por mayor en Virtual Cosméticos, distribuidora de cosméticos en Foz do Iguaçu: ${n} productos en caja cerrada${marcas.length ? ` de las marcas ${lista(marcas, "y")}` : ""}.`,
      "Elija los productos, envíe el pedido por WhatsApp y reciba el total con precio mayorista.",
    ],
    tituloMarcas: "Marcas de Cosméticos al por Mayor | Virtual Cosméticos Foz do Iguaçu",
    descricaoMarcas: "Todas las marcas de la distribuidora Virtual Cosméticos en Foz do Iguaçu: Maycrene, Rhenuks, Soul, Bio Instinto y Mary Life, Phalle Beauty y más, al por mayor.",
  },
} satisfies Record<Idioma, unknown>;

function lista(itens: string[], e: string): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} ${e} ${itens[itens.length - 1]}`;
}

/** Dados da empresa para o Google (empresa local atacadista). */
export const DADOS_EMPRESA = {
  "@context": "https://schema.org",
  "@type": "WholesaleStore",
  "@id": `${SITE}/#empresa`,
  name: "Virtual Cosméticos",
  url: `${SITE}/loja`,
  logo: `${SITE}/marca/logo.png`,
  image: `${SITE}/marca/og-banner.jpg`,
  description: "Distribuidora de cosméticos direto de fábrica em Foz do Iguaçu. Atacado para salões, perfumarias e revendedores.",
  telephone: WHATSAPP_SITE,
  // Endereço completo (rua, número e CEP) entra aqui quando estiver definido; tem que ser igual ao do Google Meu Negócio.
  address: { "@type": "PostalAddress", addressLocality: "Foz do Iguaçu", addressRegion: "PR", addressCountry: "BR" },
  areaServed: { "@type": "Country", name: "Brasil" },
  knowsLanguage: ["pt-BR", "es"],
  sameAs: ["https://www.instagram.com/distribuidoravirtualcosmeticos", "https://www.facebook.com/share/1BHjxdgnRH/"],
};

/** Trilha "Início › Marcas › Maycrene" para o Google. */
export function trilha(itens: [string, string][]) {
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: itens.map(([nome, url], i) => ({ "@type": "ListItem", position: i + 1, name: nome, item: `${SITE}${url}` })),
  };
}
