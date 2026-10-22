/**
 * Leitura do XML da NF-e (modelo 55) do fornecedor: emitente, número, chave, data, itens, totais e duplicatas.
 * Sem dependências: o XML da NF-e é regular, então basta procurar as tags (com ou sem prefixo de namespace).
 */
export type ItemNfe = { codigo: string; ean: string | null; descricao: string; unidade: string; quantidade: number; valor_unit: number; total: number };
export type Duplicata = { numero: string; vencimento: string; valor: number };
export type Nfe = {
  chave: string | null; numero: string | null; serie: string | null; data: string | null;
  fornecedor: { cnpj: string | null; nome: string };
  destinatario: string | null;
  itens: ItemNfe[]; duplicatas: Duplicata[];
  valor_produtos: number; frete: number; desconto: number; ipi: number; st: number; outros: number; valor_nota: number;
};

const T = (nome: string) => `<(?:[\\w-]+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nome}>`;
const bloco = (xml: string, nome: string) => xml.match(new RegExp(T(nome)))?.[1] ?? "";
const blocos = (xml: string, nome: string) => [...xml.matchAll(new RegExp(T(nome), "g"))].map((m) => m[1]);
const ent = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
const txt = (xml: string, nome: string) => { const b = bloco(xml, nome); return b ? ent(b) : ""; };
const num = (xml: string, nome: string) => { const v = Number(txt(xml, nome)); return Number.isFinite(v) ? v : 0; };

export function lerNfe(xml: string): Nfe {
  if (!/infNFe/i.test(xml)) throw new Error("Este arquivo não parece ser o XML de uma NF-e.");
  const chave = xml.match(/<(?:[\w-]+:)?infNFe[^>]*\sId="NFe(\d{44})"/)?.[1] ?? (txt(xml, "chNFe") || null);
  const ide = bloco(xml, "ide"), emit = bloco(xml, "emit"), dest = bloco(xml, "dest"), tot = bloco(xml, "ICMSTot");
  const dataEmi = (txt(ide, "dhEmi") || txt(ide, "dEmi")).slice(0, 10) || null;
  const itens: ItemNfe[] = blocos(xml, "det").map((det) => {
    const prod = bloco(det, "prod"), imp = bloco(det, "imposto");
    const q = num(prod, "qCom") || num(prod, "qTrib");
    const vProd = num(prod, "vProd");
    // custo do item: produtos + IPI + ST do item (o desconto da nota entra depois, em %)
    const extra = num(bloco(imp, "IPI"), "vIPI") + num(bloco(imp, "ICMS"), "vICMSST");
    const ean = txt(prod, "cEAN") || txt(prod, "cEANTrib");
    return {
      codigo: txt(prod, "cProd"), ean: /^\d{8,14}$/.test(ean) ? ean : null, descricao: txt(prod, "xProd").slice(0, 200),
      unidade: txt(prod, "uCom").toUpperCase(), quantidade: q,
      valor_unit: q > 0 ? Math.round(((vProd + extra) / q) * 10000) / 10000 : num(prod, "vUnCom"), total: vProd + extra,
    };
  }).filter((i) => i.quantidade > 0 && i.descricao);
  const duplicatas: Duplicata[] = blocos(bloco(xml, "cobr"), "dup").map((d) => ({
    numero: txt(d, "nDup"), vencimento: txt(d, "dVenc").slice(0, 10), valor: num(d, "vDup"),
  })).filter((d) => d.valor > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d.vencimento));
  return {
    chave, numero: txt(ide, "nNF") || null, serie: txt(ide, "serie") || null, data: dataEmi,
    fornecedor: { cnpj: txt(emit, "CNPJ") || null, nome: txt(emit, "xFant") && txt(emit, "xNome").length > 60 ? txt(emit, "xFant") : txt(emit, "xNome") },
    destinatario: txt(dest, "xNome") || null,
    itens, duplicatas,
    valor_produtos: num(tot, "vProd"), frete: num(tot, "vFrete"), desconto: num(tot, "vDesc"), ipi: num(tot, "vIPI"),
    st: num(tot, "vST"), outros: num(tot, "vOutro"), valor_nota: num(tot, "vNF"),
  };
}

/** Unidades que já são "peça" (as outras, como CX ou FD, pedem conferência da quantidade). */
export const UNIDADE_PECA = /^(UN|UND|UNID|UNIDADE|PC|PÇ|PCS|PEC|PECA|PEÇA|U)$/;
