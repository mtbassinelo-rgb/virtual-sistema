"use client";

import { useRef, useState } from "react";
import { BuscaLista } from "../../busca-lista";
import { precoTabela } from "../acoes";

type Opcao = { v: string; t: string; d?: string };
type Piso = { preco: number | null; moeda: "GS" | "BRL" | null };

const fmt = (v: number, m: "GS" | "BRL" | null) =>
  m === "BRL" ? `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `Gs ${Math.round(v).toLocaleString("es-PY")}`;
const num = (s: string) => {
  let t = s.replace(/\s|R\$|Gs/gi, "");
  if (!t) return 0;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Linhas de produtos do pedido: começa com 10 e o botão acrescenta mais.
 * Preço por peça é opcional: vazio = tabela do cliente. A vendedora pode cobrar mais, nunca menos (o banco confere).
 */
export function LinhasItens({ opcoes, inicial = 10, podeBaixar = false }: { opcoes: Opcao[]; inicial?: number; podeBaixar?: boolean }) {
  const [n, setN] = useState(inicial);
  const [pisos, setPisos] = useState<Record<number, Piso & { chave: string }>>({});
  const [precos, setPrecos] = useState<Record<number, string>>({});
  const tabela = useRef<HTMLTableElement>(null);

  // Lê cliente, moeda e produto da linha direto do formulário e busca o preço de tabela
  async function consultar(i: number) {
    const form = tabela.current?.closest("form");
    if (!form) return;
    const v = (nome: string) => (form.elements.namedItem(nome) as HTMLInputElement | null)?.value ?? "";
    const cliente = v("cliente_id"), moeda = v("moeda"), produto = v(`produto_${i}`);
    const chave = `${cliente}|${moeda}|${produto}`;
    if (!cliente || !produto) { setPisos((p) => ({ ...p, [i]: { preco: null, moeda: null, chave } })); return; }
    if (pisos[i]?.chave === chave) return;
    const r = await precoTabela(cliente, moeda, produto);
    setPisos((p) => ({ ...p, [i]: { ...r, chave } }));
  }

  return (
    <>
      <table ref={tabela} style={{ minWidth: 520 }} data-sem-filtro>
        <thead><tr><th style={{ width: 36 }}>#</th><th>Produto</th><th style={{ width: 100 }}>Caixas</th><th style={{ width: 100 }}>ou peças</th>
          <th style={{ width: 150 }}>Preço por peça</th></tr></thead>
        <tbody>
          {Array.from({ length: n }, (_, i) => {
            const piso = pisos[i];
            const valor = num(precos[i] ?? "");
            const abaixo = !podeBaixar && piso?.preco != null && valor > 0 && valor < piso.preco;
            return (
              <tr key={i}>
                <td className="num suave">{i + 1}</td>
                <td>
                  <BuscaLista name={`produto_${i}`} opcoes={opcoes} ariaLabel={`Produto ${i + 1}`} placeholder="Digite nome ou código (ex.: sha%uva)" />
                </td>
                <td><input name={`cx_${i}`} inputMode="numeric" aria-label={`Caixas ${i + 1}`} onFocus={() => consultar(i)} /></td>
                <td><input name={`qtd_${i}`} inputMode="decimal" aria-label={`Peças ${i + 1}`} onFocus={() => consultar(i)} /></td>
                <td>
                  <input name={`preco_${i}`} inputMode="decimal" aria-label={`Preço por peça ${i + 1}`} value={precos[i] ?? ""}
                    placeholder={piso?.preco != null ? fmt(piso.preco, piso.moeda) : "da tabela"}
                    onFocus={() => consultar(i)} onChange={(e) => setPrecos((p) => ({ ...p, [i]: e.target.value }))}
                    style={abaixo ? { borderColor: "var(--erro)" } : undefined} aria-invalid={abaixo || undefined} />
                  {abaixo && <div className="pequeno texto-erro">Mínimo {fmt(piso!.preco!, piso!.moeda)}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="linha" style={{ marginTop: 8, gap: 8 }}>
        <button type="button" onClick={() => setN((x) => Math.min(x + 1, 300))}>+ Adicionar produto</button>
        <button type="button" className="discreto" onClick={() => setN((x) => Math.min(x + 10, 300))}>+ 10 linhas</button>
        <span className="pequeno suave">{n} linhas · linhas vazias são ignoradas · preço vazio = tabela do cliente
          {podeBaixar ? "" : " · pode cobrar mais que a tabela, nunca menos"}</span>
      </div>
    </>
  );
}
