// Organização da vitrine: linhas de produto, marca e a cor do "rótulo" de cada produto.
// O Bling não exporta categorias nem fotos, então a linha vem do nome do produto.

export type Linha = { chave: string; nome: string };

export const LINHAS: Linha[] = [
  { chave: "kits", nome: "Kits" },
  { chave: "matizadores", nome: "Matizadores" },
  { chave: "cabelo", nome: "Cabelo" },
  { chave: "corpo", nome: "Corpo e banho" },
  { chave: "rosto", nome: "Rosto" },
  { chave: "maquiagem", nome: "Maquiagem" },
  { chave: "unhas", nome: "Unhas e cílios" },
  { chave: "perfumaria", nome: "Perfumaria" },
  { chave: "sexshop", nome: "Sex shop" },
  { chave: "outros", nome: "Outros" },
];

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const REGRAS: [string, RegExp][] = [
  ["kits", /\bkits?\b/],
  ["matizadores", /\bmatiz|desamarel|tonaliz|platinad/],
  ["unhas", /unha|esmalte|cilio|\blash(es)?\b|alongamento|\btips?\b|cuticula|base coat|top coat|polygel|sculpt|\bgel\b.*real love|ultra bond/],
  ["maquiagem", /gloss|\blip\b|batom|\bpo solto|maquiagem|rimel|mascara de cilios|sobrancelha|delineador|blush|iluminador|corretivo/],
  ["perfumaria", /perfume|colonia|essencia|fragranc|body mist|deo colonia/],
  ["rosto", /facial|rosto|skin ?care|serum|micelar|protetor solar|olheira|demaquil|labial|\blabios?\b/],
  ["corpo", /hidratante|body|splash|sabonete|jabon|esfoliant|corporal|desodorant|\bmaos?\b|\bpes\b|intimo|massage|oleo de massagem|sebo de carneiro|creme dental|pomada|clareador|higiene|mosqueta|leite de rosas/],
  ["cabelo", /shampoo|condicionador|mascara|capilar|cabelo|leave|finaliz|gelatina|ativador|cachos|progressiva|tonico|queratina|reconstru|hidrata..o capilar|pentear|oleo|escova|mechas|siliconizado|pontas|protetor termico|tintura|coloracao|descolor/],
];

// Sex shop: linha íntima/sensual e tudo da Sexy Fantasy (inclusive kits)
const SEXSHOP = /perfume (de|para) calcinha|desodorante (de|para) calcinha|calcinha|lubrificante|excitante|retardante|adstringente (intimo|vaginal)|vibrador|estimulante (intimo|feminino|masculino|sexual)|sensual|afrodisiac|beijavel|comestivel|esquenta|gel (intimo )?(hot|ice|quente|gelado)|\bsex\b|sexy fantasy|erotic|sex ?shop|bolinha|aromatizante|gel (hid[^ ]* )?(bab[^ ]* )?sexy|\bgoze\b|anestesico intimo|dessensibilizante/;

export function linhaDe(nome: string, marca?: string | null, tipo?: string | null): string {
  const n = sem(nome);
  const m = sem(marca ?? "");
  if (/sexy fantasy|fantasy sexy/.test(m) || SEXSHOP.test(n)) return "sexshop";
  if (tipo === "kit") return "kits";
  for (const [chave, re] of REGRAS) if (re.test(n)) return chave;
  return "outros";
}

const MARCAS = ["Maycrene", "Rhenuks", "Soul", "Farmax", "Naxos", "Leite de Rosas", "Magic Color", "Makiaj", "Phalle Beauty",
  "Phale Beauty", "Real Love", "Fonte da Beleza", "Babasoul", "Salon Profesional", "Shine's", "San Jully", "Super Poderes", "Mary Life", "Bonequinha Japonesa"];

export function marcaDe(nome: string, marca?: string | null): string | null {
  const n = sem(`${nome} ${marca ?? ""}`).replace(/phallebeauty/g, "phalle beauty");
  if (/mary ?life|bio ?instinto/.test(n)) return "Bio Instinto e Mary Life";   // as duas marcas são uma só na loja
  const conhecida = MARCAS.find((m) => n.includes(sem(m)));
  if (conhecida) return conhecida === "Phale Beauty" ? "Phalle Beauty" : conhecida;
  if (!marca || /etiqueta|papel/i.test(marca)) return null;
  return marca.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
}

/** Itens de uso interno que não aparecem no site (embalagem, etiqueta, expositor…). */
export function interno(nome: string): boolean {
  return /impressao etiqueta|caixa de papelao|expositor|etiqueta marktplace|carretinha/.test(sem(nome));
}

/** Cor do rótulo: a cartela dos matizadores (o tom do produto) ou a cor da linha. */
export function corRotulo(nome: string, linha: string): { fundo: string; tinta: string } {
  const n = sem(nome);
  if (/marsala|vinho/.test(n)) return { fundo: "#7A2440", tinta: "#FBEFF3" };
  if (/ruivo|acobread|cobre|vermelh/.test(n)) return { fundo: "#B5532E", tinta: "#FFF3EC" };
  if (/azul|blue/.test(n)) return { fundo: "#34509C", tinta: "#EEF2FF" };
  if (/rosa|pink|rose/.test(n)) return { fundo: "#E6A3BD", tinta: "#3B1027" };
  if (/platin|prata|cinza|grafite/.test(n)) return { fundo: "#D5D8E2", tinta: "#2B1638" };
  if (/violet|roxo|lilas|matiz|desamarel/.test(n)) return { fundo: "#5E2B8C", tinta: "#F4EEFB" };
  if (/abacate|verde|menta|babosa|aloe/.test(n)) return { fundo: "#7FAF8E", tinta: "#13291B" };
  if (/mandioca|coco|leite|baunilha/.test(n)) return { fundo: "#EADFC8", tinta: "#3A2A12" };
  switch (linha) {
    case "kits": return { fundo: "#2B1638", tinta: "#E9CFA3" };
    case "cabelo": return { fundo: "#B4436C", tinta: "#FFF0F5" };
    case "corpo": return { fundo: "#E9CFA3", tinta: "#3A2410" };
    case "rosto": return { fundo: "#A9D6C6", tinta: "#123326" };
    case "unhas": return { fundo: "#E7889A", tinta: "#3A0E18" };
    case "perfumaria": return { fundo: "#BBA6DD", tinta: "#24123A" };
    case "sexshop": return { fundo: "#8E1F3F", tinta: "#FFE8EF" };
    default: return { fundo: "#E3DEEC", tinta: "#2B1638" };
  }
}

/** Nome curto para o rótulo: sem a marca e sem medidas repetidas. */
export function nomeCurto(nome: string, marca: string | null): string {
  let s = nome;
  if (marca) s = s.replace(new RegExp(marca.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "");
  s = s.replace(/\s*[-|–]\s*$/, "").replace(/\s{2,}/g, " ").trim();
  return s.length > 64 ? s.slice(0, 61).trimEnd() + "…" : s;
}

/** Cartela do topo do site: os tons de matizador que a distribuidora trabalha. */
export const CARTELA = [
  { nome: "Violeta", busca: "matizador violeta", fundo: "#5E2B8C", tinta: "#F4EEFB" },
  { nome: "Platinado", busca: "platinum", fundo: "#D5D8E2", tinta: "#2B1638" },
  { nome: "Azul", busca: "matizador azul", fundo: "#34509C", tinta: "#EEF2FF" },
  { nome: "Marsala", busca: "marsala", fundo: "#7A2440", tinta: "#FBEFF3" },
  { nome: "Ruivo acobreado", busca: "ruivo", fundo: "#B5532E", tinta: "#FFF3EC" },
  { nome: "Rosé", busca: "rosa", fundo: "#E6A3BD", tinta: "#3B1027" },
];

/** Cor fixa de cada marca nos blocos de "Marcas" (sempre a mesma para a mesma marca). */
const PALETA_MARCAS = [
  { fundo: "#822AA1", tinta: "#FFFFFF" }, { fundo: "#3A1250", tinta: "#E8D5F2" }, { fundo: "#F1E6F6", tinta: "#3A1250" },
  { fundo: "#B4436C", tinta: "#FFF0F5" }, { fundo: "#E9CFA3", tinta: "#3A2410" }, { fundo: "#A9D6C6", tinta: "#123326" },
  { fundo: "#34509C", tinta: "#EEF2FF" }, { fundo: "#D5D8E2", tinta: "#2B1638" },
];
export function corMarca(marca: string) {
  let h = 0;
  for (const ch of marca) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETA_MARCAS[h % PALETA_MARCAS.length];
}

/** Subcategorias dentro de uma linha (filtro de segundo nível no site). A ordem é a ordem dos botões; a primeira regra que bate vale. */
export const SUBLINHAS: Record<string, { chave: string; nome: string; es: string; re: RegExp }[]> = {
  cabelo: [
    { chave: "ativador", nome: "Ativador de cachos", es: "Activador de rizos", re: /ativador|cachos/ },
    { chave: "pentear", nome: "Creme para pentear", es: "Crema para peinar", re: /pentear|para peinar/ },
    { chave: "leite", nome: "Leite siliconizado", es: "Leche siliconada", re: /leite|siliconizad/ },
    { chave: "protetor", nome: "Protetor térmico", es: "Protector térmico", re: /protetor termico|termoprotetor|protetor term/ },
    { chave: "pontas", nome: "Reparador de pontas", es: "Reparador de puntas", re: /reparador|pontas/ },
    { chave: "spray", nome: "Spray condicionante", es: "Spray acondicionador", re: /spray/ },
    { chave: "gelatina", nome: "Gelatina capilar", es: "Gelatina capilar", re: /gelatina/ },
    { chave: "shampoo", nome: "Shampoos", es: "Champús", re: /shampoo/ },
    { chave: "escova", nome: "Escova de pentear", es: "Cepillo", re: /escova(?! progressiva)|pente\b/ },
    { chave: "serum", nome: "Sérum capilar", es: "Sérum capilar", re: /serum/ },
    { chave: "mechas", nome: "Papel para mechas", es: "Papel para mechas", re: /mechas|papel/ },
    { chave: "mascara", nome: "Máscaras", es: "Mascarillas", re: /mascara/ },
    { chave: "condicionador", nome: "Condicionadores", es: "Acondicionadores", re: /condicionador/ },
    { chave: "oleo", nome: "Óleos capilares", es: "Aceites capilares", re: /oleo|oil/ },
  ],
  kits: [
    { chave: "matizador", nome: "Kit matizadores", es: "Kit matizadores", re: /\bmatiz|ativador de tons|desamarel|blond|platin|violet|loiro/ },
    { chave: "alisamento", nome: "Kit alisamento capilar", es: "Kit alisado capilar", re: /alisa|progressiva|escova progressiva|selagem|liso|botox capilar|definitiva/ },
    { chave: "intimo", nome: "Kit íntimo", es: "Kit íntimo", re: /intim|calcinha|sexy|sensual|lubrific|excitante/ },
    { chave: "spa", nome: "Kit spa", es: "Kit spa", re: /\bspa\b|\bpes\b|\bmaos\b|parafina|esfoliante|cuticula|manicure|pedicure|relax/ },
    { chave: "skin", nome: "Kit skin care", es: "Kit skin care", re: /skin|facial|rosto|serum|mousse|micelar|olheira|acne|vitamina c|niacinamida|colageno/ },
    { chave: "corporal", nome: "Kit corporal", es: "Kit corporal", re: /hidratante|sabonete|corpo|corporal|body|splash|locao|desodorante|colonia/ },
    { chave: "tratamento", nome: "Kit tratamento capilar", es: "Kit tratamiento capilar", re: /tratamento|reconstru|hidratac|nutric|cronograma|\bsos\b|queratina|ampola|terapia|repara|antiqueda|crescimento|biotina|recupera|\d passos/ },
    { chave: "diario", nome: "Kit capilar de uso diário", es: "Kit capilar de uso diario", re: /shampoo|condicionador|mascara|capilar|cabelo|cachos|leave/ },
  ],
};

export function subLinhaDe(linha: string, nome: string): string | null {
  const subs = SUBLINHAS[linha];
  if (!subs) return null;
  const n = sem(nome);
  return subs.find((s) => s.re.test(n))?.chave ?? "outros";
}
