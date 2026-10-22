/**
 * Leitura do relatório de vendas da Shopee / Mercado Livre: CSV exportado ou linhas copiadas da planilha (Excel/Google).
 * Acha as colunas pelo nome do cabeçalho (português ou espanhol). Sem cabeçalho: SKU e quantidade nas duas primeiras colunas.
 * Junta as linhas por número do pedido; sem número, o dia inteiro vira um pedido (e o mesmo dia não entra duas vezes).
 */
export type PedidoRelatorio = { pedido: string; data: string | null; taxa: number | null; itens: { sku: string; quantidade: number; valor: number | null; descricao: string | null }[] };
export type Leitura = { pedidos: PedidoRelatorio[]; linhas: number; ignoradas: number; cancelados: number; colunas: Record<string, string | null> };

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();

const COLUNAS: Record<string, string[]> = {
  pedido: ["id do pedido", "n do pedido", "numero do pedido", "no do pedido", "n de venda", "numero de venda", "venda", "order id", "order sn", "pedido", "# de venda", "id da venda"],
  sku: ["numero de referencia sku", "referencia sku", "sku da variacao", "sku do anuncio", "sku principal", "sku", "codigo do produto", "codigo", "seller sku"],
  quantidade: ["quantidade", "unidades", "qtd", "qty", "cantidad"],
  valor: ["preco acordado", "preco unitario de venda do anuncio", "preco unitario", "valor unitario", "preco de venda", "precio unitario", "preco"],
  data: ["data de criacao do pedido", "data do pedido", "data de venda", "fecha de venta", "data"],
  taxa: ["tarifa de venda e impostos", "taxa de comissao", "taxa de servico", "comissao", "tarifa", "taxa"],
  status: ["status do pedido", "estado", "status"],
  descricao: ["nome do produto", "titulo do anuncio", "nome da variacao", "produto", "titulo", "descricao"],
};

function separar(linha: string, sep: string): string[] {
  const out: string[] = []; let atual = ""; let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') { if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas; }
    else if (c === sep && !aspas) { out.push(atual.trim()); atual = ""; }
    else atual += c;
  }
  out.push(atual.trim());
  return out;
}

/** "1.234,56" → 1234.56 · "1234.56" → 1234.56 · "R$ 15,90" → 15.9 · "-3,20" → -3.2 */
export function numeroBr(s: string | undefined): number | null {
  if (!s) return null;
  let t = s.replace(/[^\d,.-]/g, "");
  if (!t || t === "-") return null;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = t.replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function dataIso(s: string | undefined): string | null {
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const a = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  // "21 de outubro de 2026"
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  m = sem(s).match(/(\d{1,2}) de ([a-z]+) de (\d{4})/);
  if (m) { const k = meses.findIndex((x) => m![2].startsWith(x)); if (k >= 0) return `${m[3]}-${String(k + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return null;
}

export function lerRelatorio(texto: string, canal: string, dataPadrao: string): Leitura {
  const brutas = texto.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!brutas.length) throw new Error("O relatório está vazio.");
  // separador: o que mais aparece nas primeiras linhas
  const amostra = brutas.slice(0, 5).join("\n");
  const sep = ["\t", ";", ","].map((s) => [s, amostra.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const tabela = brutas.map((l) => separar(l, sep));
  // cabeçalho: a linha (entre as 10 primeiras) que tem coluna de SKU e de quantidade
  let cab = -1; const idx: Record<string, number> = {};
  for (let i = 0; i < Math.min(10, tabela.length) && cab < 0; i++) {
    const nomes = tabela[i].map(sem);
    const achar = (k: string) => { for (const alvo of COLUNAS[k]) { const j = nomes.findIndex((n) => n === alvo || n.startsWith(alvo + " ") || n.startsWith(alvo)); if (j >= 0) return j; } return -1; };
    const s = achar("sku"), q = achar("quantidade");
    if (s >= 0 && q >= 0) { cab = i; for (const k of Object.keys(COLUNAS)) { const j = achar(k); if (j >= 0) idx[k] = j; } idx.sku = s; idx.quantidade = q; }
  }
  if (cab < 0) { idx.sku = 0; idx.quantidade = 1; }
  const colunas = Object.fromEntries(Object.keys(COLUNAS).map((k) => [k, cab >= 0 && idx[k] != null ? tabela[cab][idx[k]] : null]));
  const porPedido = new Map<string, PedidoRelatorio>();
  let ignoradas = 0, cancelados = 0, linhas = 0;
  for (const linha of tabela.slice(cab + 1)) {
    const sku = (linha[idx.sku] ?? "").trim();
    const qtd = numeroBr(linha[idx.quantidade]);
    if (!sku || !qtd || qtd <= 0) { ignoradas++; continue; }
    if (idx.status != null && /cancel|devolv|reembols|nao pago|no pagado/.test(sem(linha[idx.status] ?? ""))) { cancelados++; continue; }
    linhas++;
    const data = dataIso(idx.data != null ? linha[idx.data] : undefined) ?? dataPadrao;
    const ref = (idx.pedido != null ? (linha[idx.pedido] ?? "").trim() : "") || `DIA-${data}-${canal}`;
    const p = porPedido.get(ref) ?? { pedido: ref, data, taxa: null, itens: [] };
    const taxa = idx.taxa != null ? numeroBr(linha[idx.taxa]) : null;
    if (taxa != null) p.taxa = (p.taxa ?? 0) + Math.abs(taxa);
    const ja = p.itens.find((i) => i.sku === sku);
    const valor = idx.valor != null ? numeroBr(linha[idx.valor]) : null;
    if (ja) ja.quantidade += qtd;
    else p.itens.push({ sku, quantidade: qtd, valor: valor != null ? Math.abs(valor) : null, descricao: idx.descricao != null ? (linha[idx.descricao] ?? "").slice(0, 200) || null : null });
    porPedido.set(ref, p);
  }
  return { pedidos: [...porPedido.values()], linhas, ignoradas, cancelados, colunas };
}
