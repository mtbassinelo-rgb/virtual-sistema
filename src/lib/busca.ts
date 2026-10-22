/**
 * Busca da loja nos dois idiomas: o cliente digita em português ou espanhol e acha o produto
 * como quer que ele esteja cadastrado (ex.: "jabón" acha "Sabonete", "champú" acha "Shampoo").
 * Cada grupo junta palavras equivalentes (sem acento, minúsculas).
 */
const GRUPOS: string[][] = [
  // tipos de produto
  ["sabonete", "sabao", "jabon", "jaboncito"],
  ["shampoo", "xampu", "champu", "champoo"],
  ["condicionador", "acondicionador", "condicionante", "balsamo"],
  ["mascara", "mascarilla", "mascarila"],
  ["creme", "crema", "cremes"],
  ["oleo", "aceite", "oil"],
  ["tintura", "tinta", "tinte", "coloracao", "coloracion", "coloração"],
  ["descolorante", "decolorante", "descoloracao", "decoloracion"],
  ["oxidante", "revelador", "agua oxigenada", "oxigenada"],
  ["alisante", "alisador", "alisado", "progressiva", "alisamento", "alisamiento", "lacio", "liso"],
  ["escova", "cepillo"],
  ["pente", "peine"],
  ["unha", "una", "unhas", "unas"],
  ["removedor", "acetona", "quitaesmalte"],
  ["perfume", "colonia", "fragancia", "fragrancia", "body splash", "splash"],
  ["hidratante", "humectante", "hidratacion", "hidratacao"],
  ["protetor", "protector", "bloqueador", "filtro solar"],
  ["batom", "labial", "pintalabios", "lapiz labial"],
  ["brilho", "brillo", "gloss"],
  ["po", "polvo"],
  ["rimel", "mascara de pestanas"],
  ["cilios", "pestanas", "pestana"],
  ["sobrancelha", "sobrancelhas", "ceja", "cejas"],
  ["lenco", "lencos", "toallita", "toallitas"],
  ["fralda", "fraldas", "panal", "panales"],
  ["algodao", "algodon"],
  ["dental", "dente", "dentes", "dientes", "dentifrico"],
  ["absorvente", "toalla higienica", "compresa"],
  ["barbear", "barba", "afeitar", "afeitadora"],
  ["lamina", "cuchilla", "gilete", "gillette"],
  ["ativador", "activador"],
  ["cacho", "cachos", "cacheado", "cacheados", "rizo", "rizos", "rizado", "rizados", "rulo", "rulos", "crespo", "crespos", "ondulado", "ondulados"],
  ["pentear", "peinar", "peinado"],
  ["finalizador", "finalizante"],
  ["ponta", "pontas", "punta", "puntas"],
  ["reparador", "reparacion", "reparacao", "reconstrucao", "reconstruccion", "reconstrutor", "reconstructor"],
  ["matizador", "matizante", "violeta", "desamarelador"],
  ["queda", "caida", "anticaida", "antiqueda"],
  ["caspa", "anticaspa"],
  ["loiro", "loira", "loiros", "rubio", "rubia", "rubios", "blond", "blonde"],
  ["ruivo", "ruiva", "pelirrojo", "pelirroja", "cobre", "cobrizo"],
  ["preto", "preta", "negro", "negra", "black"],
  ["castanho", "castanha", "castano", "castana", "marrom", "marron"],
  ["cabelo", "cabelos", "cabello", "cabellos", "capilar", "pelo"],
  ["tratamento", "tratamiento"],
  ["nutricao", "nutricion", "nutritivo", "nutritiva"],
  ["pomada", "unguento"],
  ["tonico", "tonica"],
  ["esfoliante", "exfoliante", "esfoliacao", "exfoliacion", "scrub"],
  ["banho", "bano", "ducha"],
  ["corpo", "corporal", "cuerpo"],
  ["rosto", "facial", "rostro"],
  ["mao", "maos", "mano", "manos"],
  ["pe", "pes", "pie", "pies"],
  ["infantil", "crianca", "criancas", "nino", "ninos", "nina", "kids"],
  ["bebe", "bebes", "baby"],
  ["masculino", "homem", "homens", "hombre", "hombres", "men"],
  ["feminino", "mulher", "mulheres", "mujer", "mujeres", "women"],
  ["mecha", "mechas", "reflejo", "reflejos", "luzes"],
  ["luva", "luvas", "guante", "guantes"],
  ["touca", "gorro", "gorra"],
  ["tesoura", "tijera", "tijeras"],
  ["chapinha", "prancha", "plancha", "planchita"],
  ["elastico", "elasticos", "xuxinha", "colita", "colitas", "gomita", "gomitas"],
  ["caixa", "caja", "box"],
  ["desodorante", "antitranspirante", "deo"],
  ["sabonete liquido", "jabon liquido"],
  ["esmalte", "esmaltes", "pintura de unas"],
  ["maquiagem", "maquillaje"],
  ["demaquilante", "desmaquillante"],
  ["espuma", "mousse"],
  // ingredientes e aromas
  ["morango", "frutilla", "fresa", "strawberry"],
  ["abacate", "palta", "aguacate"],
  ["mel", "miel"],
  ["babosa", "aloe", "sabila"],
  ["maracuja", "maracuya", "mburucuya"],
  ["limao", "limon"],
  ["laranja", "naranja"],
  ["cebola", "cebolla"],
  ["alho", "ajo"],
  ["ovo", "huevo"],
  ["leite", "leche"],
  ["manteiga", "manteca", "butter"],
  ["pimenta", "pimienta"],
  ["argila", "arcilla"],
  ["lama", "barro", "lodo"],
  ["carvao", "carbon"],
  ["baunilha", "vainilla"],
  ["amendoa", "amendoas", "almendra", "almendras"],
  ["alecrim", "romero"],
  ["camomila", "manzanilla"],
  ["hortela", "menta"],
  ["gengibre", "jengibre"],
  ["ricino", "castor"],
  ["queratina", "keratina"],
  ["melancia", "sandia"],
  ["maca", "manzana"],
  ["pessego", "durazno", "melocoton"],
  ["abacaxi", "anana", "pina"],
  ["framboesa", "frambuesa"],
  ["cereja", "cereza"],
  ["girassol", "girasol"],
  ["oliva", "azeite", "aceite de oliva"],
  ["semente", "sementes", "semilla", "semillas"],
  ["flor", "flores"],
  ["agua", "water"],
];

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const INDICE = new Map<string, string[]>();
for (const g of GRUPOS) {
  const norm = g.map(semAcento);
  for (const w of norm) if (!w.includes(" ")) INDICE.set(w, [...new Set([...(INDICE.get(w) ?? []), ...norm])]);
}
const PALAVRAS = [...INDICE.keys()];

/** Equivalentes de uma palavra digitada (inclui a própria). Aceita plural e a palavra ainda sendo digitada. */
export function equivalentes(termo: string): string[] {
  const t = semAcento(termo);
  const out = new Set<string>([t]);
  if (t.length < 2) return [t];
  const candidatos = [t, t.replace(/es$/, ""), t.replace(/s$/, "")];
  for (const c of candidatos) for (const alt of INDICE.get(c) ?? []) out.add(alt);
  // palavra pela metade (4+ letras): "jabo" → jabon → sabonete
  if (out.size === 1 && t.length >= 4) for (const w of PALAVRAS) if (w.startsWith(t)) for (const alt of INDICE.get(w)!) out.add(alt);
  return [...out];
}

/** Palavras de ligação que não precisam estar no nome ("jabón de frutilla", "creme para cabelo"). */
const LIGACAO = new Set(["de", "da", "do", "das", "dos", "del", "con", "com", "para", "pra", "y", "e", "la", "el", "los", "las", "o", "a", "en", "no", "na", "sin", "sem", "por"]);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Monta o filtro da busca: cada palavra digitada precisa aparecer no texto do produto,
 * nela mesma ou em algum equivalente no outro idioma (equivalente conta só no começo de palavra).
 */
export function filtroBusca(q: string): (texto: string) => boolean {
  const todas = semAcento(q).split(/[\s,;/+]+/).filter(Boolean);
  const uteis = todas.filter((t) => !LIGACAO.has(t));
  const termos = (uteis.length ? uteis : todas).map((t) => {
    const alts = equivalentes(t).filter((a) => a !== t);
    // palavras curtas (pe, mel, ajo…) só valem como palavra inteira; as outras, no começo de palavra
    const re = alts.length ? new RegExp(`(^|[^a-z0-9])(${alts.map((a) => a.length <= 3 ? `${esc(a)}(?![a-z0-9])` : esc(a)).join("|")})`) : null;
    // palavra curta digitada (ex.: "mel") vale no começo de palavra, para não achar "caramelo"
    const curta = /^[a-z]{1,3}$/.test(t) ? new RegExp(`(^|[^a-z0-9])${esc(t)}`) : null;
    return { t, re, curta };
  });
  return (texto: string) => {
    const x = semAcento(texto);
    return termos.every(({ t, re, curta }) => (curta ? curta.test(x) : x.includes(t)) || (re !== null && re.test(x)));
  };
}
