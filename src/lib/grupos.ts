/**
 * Sugestão de grupos de fragrância: produtos da mesma marca que são o mesmo item em fragrâncias, tons ou sabores
 * diferentes viram um grupo (um cartão só no site). As sugestões passam pela aprovação do gerente antes de valer.
 */
export type ProdutoGrupo = { id: string; nome: string; marca: string | null; tipo: string };
export type GrupoSugerido = { chave: string; nome: string; itens: { id: string; nome: string; variante: string }[] };

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Palavras do nome como aparecem (com acento), sem lote/validade e pontuação solta. */
const palavras = (nome: string) => nome.replace(/\s*-?\s*Lote:.*$/i, "").replace(/[|()+,]/g, " ").replace(/\s-\s/g, " ")
  .replace(/\s+/g, " ").trim().split(" ").filter((x) => x && x !== "-");
const tokens = (nome: string) => palavras(nome).map((w) => semAcento(w).toUpperCase());
const TAMANHO = /^\d+([.,]\d+)?(ML|G|KG|L|GR)?$|^(ML|G|KG|L|GR)$/;

// Famílias que o cliente procura por linha: dentro da marca, tudo que tiver estas palavras vira um grupo
const FAMILIAS: { nome: string; teste: (n: string, tipo: string) => boolean }[] = [
  { nome: "MATIZADORES", teste: (n, t) => t !== "kit" && /\bMATIZADOR|\bMATIZADORA|\bM-?TOX\b/.test(n) && !/\bKIT\b/.test(n) },
  { nome: "KITS CAPILARES", teste: (n) => /\bKIT\b/.test(n) && /(SHAMPOO|CAPILAR|CONDICIONADOR|MASCARA)/.test(n) && !/MATIZADOR/.test(n) },
  { nome: "KITS MATIZADORES", teste: (n) => /\bKIT\b/.test(n) && /MATIZADOR/.test(n) },
  { nome: "BODY SPLASH", teste: (n) => /BODY SPLASH|HAIR SPLASH|\bSPLASH\b|COLONIA/.test(n) },
  { nome: "SABONETE INTIMO", teste: (n) => /SABONETE\s+(LIQUIDO\s+)?INTIMO|SABONETE INTIMO/.test(n) && !/\bKIT\b/.test(n) },
  { nome: "DESODORANTE INTIMO", teste: (n) => /DESODORANTE\s+INTIMO/.test(n) },
  { nome: "PERFUME DE CALCINHA", teste: (n) => /PERFUME DE CALCINHA|DESODORANTE DE CALCINHA/.test(n) },
];

/** Fragrância = o que sobra do nome depois de tirar as palavras que todos do grupo têm (e a marca). */
function variantes(itens: ProdutoGrupo[], marca: string): string[] {
  const toks = itens.map((p) => tokens(p.nome));
  const comuns = new Set(toks[0].filter((t) => toks.every((x) => x.includes(t))));
  const daMarca = new Set(tokens(marca));
  return itens.map((p, i) => {
    const ws = palavras(p.nome);
    const resto = ws.filter((_, k) => !comuns.has(toks[i][k]) && !daMarca.has(toks[i][k]));
    const txt = resto.join(" ").trim() || p.nome;
    return txt.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).replace(/\b(De|Da|Do|E|Com)\b/g, (w) => w.toLowerCase());
  });
}

/** Nome da fragrância de um produto que entra num grupo que já existe (o que o nome dele tem de diferente dos outros). */
export function varianteNoGrupo(nomesDoGrupo: string[], novo: ProdutoGrupo): string {
  const outros = nomesDoGrupo.map((nome, i) => ({ id: `x${i}`, nome, marca: novo.marca, tipo: novo.tipo }));
  if (!outros.length) return novo.nome;
  return variantes([...outros, novo], novo.marca ?? "").at(-1) ?? novo.nome;
}

export function sugerirGrupos(produtos: ProdutoGrupo[]): GrupoSugerido[] {
  const porMarca = new Map<string, ProdutoGrupo[]>();
  for (const p of produtos) if (p.marca) porMarca.set(p.marca, [...(porMarca.get(p.marca) ?? []), p]);
  const saida: GrupoSugerido[] = [];

  for (const [marca, lista] of porMarca) {
    const livres = new Set(lista.map((p) => p.id));
    const add = (nome: string, itens: ProdutoGrupo[]) => {
      if (itens.length < 2) return;
      const vs = variantes(itens, marca);
      saida.push({ chave: `${marca}|${nome}`, nome: `${nome} ${marca}`.replace(/\s+/g, " ").trim(),
        itens: itens.map((p, i) => ({ id: p.id, nome: p.nome, variante: vs[i] })).sort((a, b) => a.variante.localeCompare(b.variante, "pt-BR")) });
      for (const p of itens) livres.delete(p.id);
    };

    // 1) famílias conhecidas
    for (const f of FAMILIAS) add(f.nome, lista.filter((p) => livres.has(p.id) && f.teste(tokens(p.nome).join(" "), p.tipo)));

    // 2) o resto: mesmo nome trocando um trecho de 1 a 4 palavras (não a primeira, que é o tipo do produto; tamanho igual)
    const resto = lista.filter((p) => livres.has(p.id));
    const chaves = new Map<string, ProdutoGrupo[]>();
    const cand = new Map<string, string[]>();
    for (const p of resto) {
      const t = tokens(p.nome);
      const ks: string[] = [];
      for (let ini = 1; ini < t.length; ini++) for (let len = 1; len <= 4 && ini + len <= t.length; len++) {
        const trecho = t.slice(ini, ini + len);
        if (trecho.some((x) => TAMANHO.test(x))) break;
        const k = [...t.slice(0, ini), "*", ...t.slice(ini + len)].join(" ");
        if (k.split(" ").length < 3) continue;
        ks.push(k);
        chaves.set(k, [...(chaves.get(k) ?? []), p]);
      }
      cand.set(p.id, ks);
    }
    // grupos maiores primeiro; cada produto entra em um só
    const ordem = [...chaves.entries()].filter(([, v]) => v.length >= 2).sort((a, b) => b[1].length - a[1].length || b[0].length - a[0].length);
    for (const [k, v] of ordem) {
      const itens = v.filter((p) => livres.has(p.id));
      if (itens.length < 2) continue;
      const nome = k.replace(" * ", " ").replace(/\s\*$/, "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
      add(nome.includes(semAcento(marca).toUpperCase()) ? nome.replace(semAcento(marca).toUpperCase(), "").trim() : nome, itens);
    }
  }
  return saida.sort((a, b) => b.itens.length - a.itens.length || a.nome.localeCompare(b.nome, "pt-BR"));
}
