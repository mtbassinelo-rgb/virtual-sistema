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
  ["rosto", /facial|rosto|skin ?care|serum|micelar|protetor solar|olheira|demaquil|labial|\blabios?\b|peel off|black mask|tonico adstringente/],
  ["corpo", /hidratante|body|splash|sabonete|jabon|esfoliant|corporal|desodorant|\bmaos?\b|\bpes\b|intimo|massage|oleo de massagem|oleo (de )?banho|sebo de carneiro|creme dental|pomada|clareador|higiene|leite de rosas|body spray|oleo (de )?rosa mosqueta|oleo corporal/],
  ["cabelo", /shampoo|condicionador|mascara|capilar|cabelo|leave|finaliz|gelatina|ativador|cachos|progressiva|tonico|queratina|reconstru|hidrata..o capilar|pentear|oleo|escova|mechas|siliconizado|pontas|protetor termico|tintura|coloracao|descolor/],
];

// Sex shop: linha íntima/sensual e tudo da Sexy Fantasy (inclusive kits)
const SEXSHOP = /perfume (de|para) calcinha|desodorante (de|para) calcinha|calcinha|lubrificante|excitante|retardante|adstringente (intimo|vaginal)|vibrador|estimulante (intimo|feminino|masculino|sexual)|sensual|afrodisiac|beijavel|comestivel|esquenta|gel (intimo )?(hot|ice|quente|gelado)|\bsex\b|sexy fantasy|erotic|sex ?shop|bolinha|aromatizante|yummy|\bfantasy\b|gel (hid[^ ]* )?(bab[^ ]* )?sexy|\bgoze\b|anestesico intimo|dessensibilizante/;

export function linhaDe(nome: string, marca?: string | null, tipo?: string | null): string {
  const n = sem(nome);
  const m = sem(marca ?? "");
  if (/sexy fantasy|fantasy sexy/.test(m) || SEXSHOP.test(n)) return "sexshop";
  if (tipo === "kit") return "kits";
  for (const [chave, re] of REGRAS) {
    // maquiagem só se não for hidratante/corpo/cabelo (ex.: "hidratante corporal iluminador" é Corpo e banho)
    if (chave === "maquiagem" && /condicionante|reparador|capilar|cabelo|corporal|\bcorpo\b|shampoo|splash|desodorante|hid\./.test(n)) continue;
    // cabelo antes de corpo quando o nome é claramente de cabelo (ex.: "protetor térmico spray rosa mosqueta", "máscara ... rosa mosqueta")
    if (chave === "corpo" && /protetor termico|shampoo|condicionador|\bmascara\b(?! de cilios)|capilar|cabelo/.test(n) && !/intim|corporal|facial|sabonete|corpo/.test(n)) continue;
    if (re.test(n)) return chave;
  }
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
export const SUBLINHAS: Record<string, { chave: string; nome: string; es: string; re: RegExp; p?: number }[]> = {
  cabelo: [
    { chave: "ativador", nome: "Ativador de cachos", es: "Activador de rizos", re: /ativador|cachos/, p: 6 },
    { chave: "pentear", nome: "Creme para pentear", es: "Crema para peinar", re: /pentear|para peinar/ },
    { chave: "leite", nome: "Leite siliconizado", es: "Leche siliconada", re: /leite|siliconizad/ },
    { chave: "protetor", nome: "Protetor térmico", es: "Protector térmico", re: /protetor termico|termoprotetor|protetor term/, p: 3 },
    { chave: "pontas", nome: "Reparador de pontas", es: "Reparador de puntas", re: /reparador|pontas/, p: 3 },
    { chave: "spray", nome: "Spray condicionante", es: "Spray acondicionador", re: /spray/, p: 4 },
    { chave: "gelatina", nome: "Gelatina capilar", es: "Gelatina capilar", re: /gelatina/ },
    { chave: "shampoo", nome: "Shampoos", es: "Champús", re: /shampoo/ },
    { chave: "escova", nome: "Escova de pentear", es: "Cepillo", re: /escova(?! progressiva)|pente\b/ },
    { chave: "serum", nome: "Sérum capilar", es: "Sérum capilar", re: /serum/ },
    { chave: "mechas", nome: "Papel para mechas", es: "Papel para mechas", re: /mechas|papel/ },
    { chave: "mascara", nome: "Máscaras", es: "Mascarillas", re: /mascara/, p: 4 },
    { chave: "condicionador", nome: "Condicionadores", es: "Acondicionadores", re: /condicionador/ },
    { chave: "oleo", nome: "Óleos capilares", es: "Aceites capilares", re: /oleo|oil/ },
  ],
  // Ordem = ordem dos botões; "p" = prioridade na hora de classificar (menor ganha; sem p = 5, empate pela ordem)
  corpo: [
    { chave: "splash", nome: "Body splash", es: "Body splash", re: /splash|body mist|body spray/, p: 2 },
    { chave: "oleo", nome: "Óleo corporal", es: "Aceite corporal", re: /\boleo\b/, p: 6 },
    { chave: "skin", nome: "Skin care", es: "Skin care", re: /skin ?care|serum|vitamina c|niacinamida|retinol|olheira|acne|micelar|tonico|acido hialuronico/, p: 4 },
    { chave: "hidratante", nome: "Hidratante facial / corporal", es: "Hidratante facial / corporal", re: /hidratante|hidrantante|hid\.|locao|creme corporal|creme facial|manteiga|sebo de carneiro/, p: 7 },
    { chave: "esfoliante", nome: "Esfoliante facial / corporal", es: "Exfoliante facial / corporal", re: /esfolia/, p: 3 },
    { chave: "geleia", nome: "Geleia corporal", es: "Jalea corporal", re: /geleia/, p: 1 },
    { chave: "sab_intimo", nome: "Sabonete íntimo", es: "Jabón íntimo", re: /sabonete.*intim|intim.*sabonete|higiene intim/, p: 1 },
    { chave: "sabonete", nome: "Sabonete facial / corporal", es: "Jabón facial / corporal", re: /sabonete|jabon/, p: 4 },
    { chave: "barra", nome: "Sabonete em barra", es: "Jabón en barra", re: /sabonete.*barra|\bbarra\b/, p: 2 },
    { chave: "oleo_banho", nome: "Óleo de banho", es: "Aceite de baño", re: /oleo (de )?banho/, p: 1 },
    { chave: "tratamento", nome: "Tratamento corpo e rosto", es: "Tratamiento cuerpo y rostro", re: /tratamento|redutor|celulite|estria|clareador|firmador|colageno|cartilagem|arnica|\bgel\b|massag|leite de rosas/, p: 8 },
    { chave: "spa", nome: "Linha spa", es: "Línea spa", re: /\bspa\b|parafina|sais? de banho|ofuro/, p: 2 },
    { chave: "pes", nome: "Pés, mãos, cotovelos, axilas e virilha", es: "Pies, manos, codos, axilas e ingles", re: /\bpes\b|\bmaos\b|cotovelo|axila|virilha|cuticula|calcanhar|rachadura|aspereza/, p: 2 },
    { chave: "perf_intimo", nome: "Perfume íntimo", es: "Perfume íntimo", re: /perfume (de |para )?(calcinha|intim)/, p: 1 },
    { chave: "perf_capilar", nome: "Perfume capilar", es: "Perfume capilar", re: /perfume capilar|hair (perfume|splash|mist)/, p: 0 },
    { chave: "deo_intimo", nome: "Desodorante íntimo", es: "Desodorante íntimo", re: /desodorante (de |para )?(intim|calcinha)/, p: 1 },
    { chave: "pomada", nome: "Pomada massageadora", es: "Pomada masajeadora", re: /pomada/, p: 1 },
  ],
  kits: [
    { chave: "matizador", nome: "Kit matizadores", es: "Kit matizadores", re: /\bmatiz|ativador de tons|desamarel|blond|platin|violet|loiro/ },
    { chave: "alisamento", nome: "Kit alisamento capilar", es: "Kit alisado capilar", re: /alisa|progressiva|escova progressiva|selagem|liso|botox capilar|definitiva/ },
    { chave: "intimo", nome: "Kit íntimo", es: "Kit íntimo", re: /intim|calcinha|sexy|sensual|lubrific|excitante/ },
    { chave: "spa", nome: "Kit spa", es: "Kit spa", re: /\bspa\b|\bpes\b|\bmaos\b|parafina|cuticula|manicure|pedicure|relax|podolog/ },
    { chave: "skin", nome: "Kit skin care", es: "Kit skin care", re: /skin|facial|rosto|serum|mousse|micelar|olheira|acne|vitamina c|niacinamida|colageno/ },
    { chave: "corporal", nome: "Kit corporal", es: "Kit corporal", re: /hidratante|sabonete|corpo|corporal|body|splash|locao|desodorante|colonia|glow|iluminador|esfoliante/ },
    { chave: "tratamento", nome: "Kit tratamento capilar", es: "Kit tratamiento capilar", re: /tratamento|reconstru|hidratac|nutric|cronograma|\bsos\b|queratina|ampola|terapia|repara|antiqueda|crescimento|biotina|recupera|\d passos/ },
    { chave: "diario", nome: "Kit capilar de uso diário", es: "Kit capilar de uso diario", re: /shampoo|condicionador|mascara|capilar|cabelo|cachos|leave/ },
  ],
};

export type SubLinha = { chave: string; nome: string; es: string; re: RegExp; p?: number };
export type SubLinhaDb = { linha: string; chave: string; nome: string; nome_es: string | null; palavras: string | null; ativo: boolean };

/** Subcategorias valendo: as do programa + as criadas/renomeadas pela equipe (Produtos → Categorias do site). */
export function sublinhasEfetivas(db: SubLinhaDb[] = []): Record<string, SubLinha[]> {
  const r: Record<string, SubLinha[]> = {};
  for (const [l, subs] of Object.entries(SUBLINHAS)) r[l] = subs.map((x) => ({ ...x }));
  const palavrasRe = (txt: string | null) => {
    const ps = (txt ?? "").split(/[,;\n]/).map((x) => sem(x).trim()).filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return ps.length ? new RegExp(ps.join("|")) : null;
  };
  for (const d of db) {
    const lista = (r[d.linha] ??= []);
    const i = lista.findIndex((x) => x.chave === d.chave);
    if (!d.ativo) { if (i >= 0) lista.splice(i, 1); continue; }
    const re = palavrasRe(d.palavras);
    if (i >= 0) lista[i] = { ...lista[i], nome: d.nome, es: d.nome_es || d.nome, ...(re ? { re, p: 2 } : {}) };
    else lista.push({ chave: d.chave, nome: d.nome, es: d.nome_es || d.nome, re: re ?? /$^/, p: re ? 2 : 9 });
  }
  return r;
}

export function subLinhaDe(linha: string, nome: string, mapa: Record<string, SubLinha[]> = SUBLINHAS): string | null {
  const subs = mapa[linha];
  if (!subs) return null;
  const n = sem(nome);
  let melhor: string | null = null, pm = 99;
  for (const s of subs) if ((s.p ?? 5) < pm && s.re.test(n)) { melhor = s.chave; pm = s.p ?? 5; }
  return melhor ?? (linha === "kits" ? "diario" : "outros");   // kit sem pista no nome é o kit capilar comum
}

/** Linhas a mais em que o produto também aparece (ex.: perfume de calcinha fica em Sex shop e também em Corpo e banho). */
export function linhasExtras(nome: string, linha: string): string[] {
  const n = sem(nome);
  if (linha !== "corpo" && linha !== "kits" && /splash|body mist|perfume capilar|hair (perfume|mist)|perfume (de |para )?(calcinha|intim)|desodorante (de |para )?(intim|calcinha)|sabonete.*intim/.test(n)) return ["corpo"];
  return [];
}

/** Categorias do produto no site: as fixadas à mão (Produtos → Categorias do site) ou as automáticas pelo nome. */
export function categoriasDe(nome: string, marca: string | null | undefined, tipo: string | null | undefined, manual?: string[] | null): { linha: string; extras: string[] } {
  if (manual && manual.length) {
    const validas = manual.filter((c) => /^[a-z0-9-]{2,30}$/.test(c));
    if (validas.length) return { linha: validas[0], extras: validas.slice(1) };
  }
  const linha = linhaDe(nome, marca, tipo);
  return { linha, extras: linhasExtras(nome, linha) };
}

/** Sugestão de categoria para quem o site deixou em "Outros" (a equipe confirma na tela Categorias do site). */
export function sugerirCategoria(nome: string): string | null {
  const n = sem(nome);
  const regras: [string, RegExp][] = [
    ["sexshop", /garganta|lubrific|excitante|retardante|vibrador|sensual/],
    ["matizadores", /\bmtox\b|matiz|desamarel/],
    ["maquiagem", /base liquida|paleta|sombra|batom|rimel|mascara de cilios|blush|corretivo|po compacto|delineador|primer/],
    ["rosto", /argila|lenco|mosqueta|facial|micelar|tonico|acne|olheira/],
    ["cabelo", /\bmask\b|mascara capilar|capilar|cabelo|spray (condicionante|desembara)|desembaracante|escova|esvova|raquete|chapinha|tonalizante/],
    ["corpo", /cera depil|depila|creme|gel|hid\.? ?corp|hidratante|firmador|redutor|nivea|locao|oleo corporal|sabonete|desodorante|massage|pomada/],
    ["perfumaria", /perfume|colonia|body splash|eau de/],
  ];
  for (const [c, re] of regras) if (re.test(n)) return c;
  return null;
}

export type CategoriaDb = { chave: string; nome: string; nome_es: string | null; ordem: number; ativo: boolean };
/** Categorias principais valendo: as do programa (renomeadas/escondidas pela equipe) + as criadas pela equipe, antes de "Outros". */
export function linhasEfetivas(db: CategoriaDb[] = [], es = false): { lista: Linha[]; nomes: Record<string, string> } {
  const porChave = new Map(db.map((d) => [d.chave, d]));
  const base = LINHAS.filter((l) => porChave.get(l.chave)?.ativo !== false).map((l) => {
    const d = porChave.get(l.chave);
    return d ? { chave: l.chave, nome: (es && d.nome_es) || d.nome } : l;
  });
  const novas = db.filter((d) => d.ativo && !LINHAS.some((l) => l.chave === d.chave)).sort((a, b) => a.ordem - b.ordem)
    .map((d) => ({ chave: d.chave, nome: (es && d.nome_es) || d.nome }));
  const i = base.findIndex((l) => l.chave === "outros");
  const lista = i >= 0 ? [...base.slice(0, i), ...novas, ...base.slice(i)] : [...base, ...novas];
  return { lista, nomes: Object.fromEntries(db.filter((d) => d.ativo).map((d) => [d.chave, (es && d.nome_es) || d.nome])) };
}
