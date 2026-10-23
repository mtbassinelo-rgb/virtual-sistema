/** Sugestão de produto para cada linha da lista de inventário (por nome, marca e tamanho). */

export type ProdutoBase = { id: string; nome: string; marca: string | null; ativo: boolean; tipo: string };
export type Sugestao = { id: string; nota: number };

const STOP = new Set(["DE", "DA", "DO", "DOS", "DAS", "E", "COM", "PARA", "A", "O", "EM", "Y", "C", "P"]);
const SINONIMO: Record<string, string> = {
  COND: "CONDICIONADOR", CONDIC: "CONDICIONADOR", MASC: "MASCARA", SHAMP: "SHAMPOO", SH: "SHAMPOO", SHAMPO: "SHAMPOO",
  ANTIRRESIDUO: "ANTIRESIDUO", ANTIRRESIDUOS: "ANTIRESIDUO", ANTIRESIDUOS: "ANTIRESIDUO", TRANSLUCIDO: "TRANSLUCIDO",
};
const TIPOS = ["SHAMPOO", "CONDICIONADOR", "MASCARA", "CREME", "GEL", "SERUM", "REPARADOR", "SABONETE", "POMADA", "PERFUME", "SPLASH", "MOUSSE", "PO"];

function norm(s: string): string {
  let t = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  // tamanhos: "1 L" e "1000ml" → TAM1000, "1KG" → TAM1000, "300 ml" → TAM300
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*(ML|GR|G|KG|LT|LITROS?|L)\b/g, (_m, n: string, u: string) => {
    const v = Number(n.replace(",", "."));
    // ml e g contam como o mesmo tamanho (1 L de shampoo e 1 kg de máscara são o "1000" do kit)
    const total = u === "KG" || u === "L" || u === "LT" || u.startsWith("LITRO") ? v * 1000 : v;
    return ` TAM${Math.round(total)} `;
  });
  t = t.replace(/ANTI\s*-?\s*RES[IÍ]DUOS?/g, "ANTIRESIDUO").replace(/ANTI\s*-?\s*QUEDA/g, "ANTIQUEDA").replace(/ON\s*\/?\s*OFF/g, "ONOFF");
  return t.replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(" ").map((t) => SINONIMO[t] ?? t).filter((t) => t.length > 1 && !STOP.has(t)));
}
const tamanho = (ts: Set<string>) => [...ts].filter((t) => /^TAM\d+$/.test(t));
const tipo = (ts: Set<string>) => TIPOS.filter((t) => ts.has(t));

/** As melhores opções do cadastro para a descrição (até `max`), da mais provável para a menos. */
export function sugerirProdutos(descricao: string, marca: string | null, produtos: ProdutoBase[], max = 6): Sugestao[] {
  const a = tokens(descricao);
  const marcaA = marca ? tokens(marca) : new Set<string>();
  const tamA = tamanho(a), tipoA = tipo(a);
  const kitA = a.has("KIT");
  const lista: Sugestao[] = [];
  for (const p of produtos) {
    const b = tokens(`${p.nome} ${p.marca ?? ""}`);
    if (!b.size) continue;
    let comum = 0;
    a.forEach((t) => { if (b.has(t)) comum++; });
    if (comum === 0) continue;
    let nota = comum / a.size;
    const tamB = tamanho(b), tipoB = tipo(b);
    if (tamA.length && tamB.length && !tamA.some((t) => tamB.includes(t))) nota -= 0.3;
    if (tipoA.length && tipoB.length && !tipoA.some((t) => tipoB.includes(t))) nota -= 0.4;
    if (marcaA.size && p.marca) {
      const mb = tokens(p.marca);
      if (![...marcaA].some((t) => mb.has(t))) nota -= 0.25;
    }
    if (kitA !== (b.has("KIT") || p.tipo === "kit")) nota -= 0.15;
    if (!p.ativo) nota -= 0.05;
    if (nota >= 0.3) lista.push({ id: p.id, nota });
  }
  return lista.sort((x, y) => y.nota - x.nota).slice(0, max);
}

/** Pré-escolhe só quando a primeira opção é boa e bem à frente da segunda. */
export function sugestaoSegura(s: Sugestao[]): string | null {
  if (!s.length || s[0].nota < 0.7) return null;
  if (s.length > 1 && s[1].nota > s[0].nota - 0.08) return null;
  return s[0].id;
}
