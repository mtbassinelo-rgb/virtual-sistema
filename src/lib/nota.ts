/** Leitura do texto de uma nota/pedido de fornecedor colado do PDF e casamento com produtos já cadastrados. */

export type ItemNota = { codigo: string; descricao: string; quantidade: number; valor_unit: number | null };

const numBR = (s: string) => {
  const t = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/\.(?=\d{3}\b)/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const ehNum = (s: string) => /^\d[\d.]*(,\d+)?$/.test(s);

/**
 * Cada linha de item: código, descrição e números no fim.
 * Layout com 7 números (ST, IPI, Qtd, Vlr. Unit, Qtd CX, Vlr CX, Total): usa Qtd e Vlr. Unit.
 * Outros layouts: os três últimos números são quantidade, valor unitário e total.
 */
export function lerItens(texto: string): ItemNota[] {
  const itens: ItemNota[] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    const tk = bruta.trim().split(/\s+/);
    if (tk.length < 5) continue;
    let k = tk.length;
    while (k > 1 && ehNum(tk[k - 1])) k--;
    const nums = tk.slice(k).map(numBR);
    if (nums.length < 3 || nums.some((n) => n === null)) continue;
    const codigo = tk[0];
    const descricao = tk.slice(1, k).join(" ");
    if (!descricao || /total|itens|peso/i.test(descricao)) continue;
    const [qtd, unit] = nums.length >= 7 ? [nums[2]!, nums[3]!] : [nums[nums.length - 3]!, nums[nums.length - 2]!];
    if (qtd <= 0) continue;
    itens.push({ codigo, descricao, quantidade: qtd, valor_unit: unit });
  }
  return itens;
}

export function lerDesconto(texto: string): number | null {
  const m = texto.match(/([\d.,]+)\s*%\s*DESC/i);
  return m ? numBR(m[1]) : null;
}
export function lerNumeroPedido(texto: string): string | null {
  const m = texto.match(/\b(?:PV|NF-?e?|N[º°o]\.?)\s*[:.]?\s*(\d{3,})/i);
  return m ? m[1] : null;
}

const STOP = new Set(["DE", "DA", "DO", "E", "COM", "PARA", "A", "O", "EM", "Y", "ML", "G", "KIT"]);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const toks = (s: string) => new Set(norm(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t)));

/** Melhor produto para a descrição da nota (entre os produtos da marca). Devolve null se não tiver segurança. */
export function casarProduto(descricao: string, produtos: { id: string; nome: string }[]): { id: string; nota: number } | null {
  const a = toks(descricao);
  const kitA = /\bKIT\b/.test(norm(descricao));
  let melhor: { id: string; nota: number } | null = null;
  for (const p of produtos) {
    const b = toks(p.nome);
    if (!a.size || !b.size) continue;
    let comum = 0;
    a.forEach((t) => { if (b.has(t)) comum++; });
    let nota = comum / a.size - Math.max(0, b.size - comum) * 0.03;
    if (kitA !== /\bKIT\b/.test(norm(p.nome))) nota -= 0.3;
    if (!melhor || nota > melhor.nota) melhor = { id: p.id, nota };
  }
  return melhor && melhor.nota >= 0.75 ? melhor : null;
}
