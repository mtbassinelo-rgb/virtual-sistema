"use client";

import { useRef, useState } from "react";
import { BuscaLista } from "../../busca-lista";
import { estoqueUnidades, precoTabela } from "../acoes";

type Opcao = { v: string; t: string; d?: string };
type Piso = { preco: number | null; piso: number | null; moeda: "GS" | "BRL" | null };

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
 * Preço por peça é opcional: vazio = tabela do cliente. A vendedora pode baixar até o VIP, nunca menos (o banco confere).
 */
export function LinhasItens({ opcoes, inicial = 10, podeBaixar = false, unidades = [], iniciais = [], caixa = {} }: {
  opcoes: Opcao[]; inicial?: number; podeBaixar?: boolean; unidades?: { id: string; nome: string }[];
  /** Itens já preenchidos (repetir um pedido anterior): produto e caixas ou peças. */
  iniciais?: { produto: string; cx?: number | null; qtd?: number | null }[];
  /** Peças por caixa de cada produto (para a soma parcial). */
  caixa?: Record<string, number>;
}) {
  const [n, setN] = useState(Math.max(inicial, iniciais.length + 3));
  // Caixas e peças digitadas em cada linha: só para mostrar a soma parcial (o banco recalcula tudo ao criar)
  const [qtds, setQtds] = useState<Record<number, { cx: string; qtd: string }>>(() =>
    Object.fromEntries(iniciais.map((x, i) => [i, { cx: x.cx ? String(x.cx) : "", qtd: x.qtd ? String(x.qtd) : "" }])));
  const mudarQtd = (i: number, campo: "cx" | "qtd", v: string) => setQtds((q) => ({ ...q, [i]: { cx: q[i]?.cx ?? "", qtd: q[i]?.qtd ?? "", [campo]: v } }));
  const [estoques, setEstoques] = useState<Record<number, { produto: string; lista: { id: string; nome: string; saldo: number }[] }>>({});
  const [pisos, setPisos] = useState<Record<number, Piso & { chave: string }>>({});
  const [precos, setPrecos] = useState<Record<number, string>>({});
  const tabela = useRef<HTMLTableElement>(null);

  // Lê cliente, moeda e produto da linha direto do formulário e busca o preço de tabela
  async function consultar(i: number) {
    const form = tabela.current?.closest("form");
    if (!form) return;
    const v = (nome: string) => (form.elements.namedItem(nome) as HTMLInputElement | null)?.value ?? "";
    const cliente = v("cliente_id"), moeda = v("moeda"), produto = v(`produto_${i}`);
    if (unidades.length > 1 && produto && estoques[i]?.produto !== produto) {
      estoqueUnidades(produto).then((lista) => setEstoques((e) => ({ ...e, [i]: { produto, lista } }))).catch(() => undefined);
    }
    const chave = `${cliente}|${moeda}|${produto}`;
    if (!cliente || !produto) { setPisos((p) => ({ ...p, [i]: { preco: null, piso: null, moeda: null, chave } })); return; }
    if (pisos[i]?.chave === chave) return;
    const r = await precoTabela(cliente, moeda, produto);
    setPisos((p) => ({ ...p, [i]: { ...r, chave } }));
  }

  // Soma parcial: peças × (preço digitado ou preço de tabela). Só aparece quando há preço conhecido.
  let pecas = 0, caixas = 0, total = 0, semPreco = 0, moedaTotal: "GS" | "BRL" | null = null;
  for (let i = 0; i < n; i++) {
    const q = qtds[i]; if (!q) continue;
    const produto = pisos[i]?.chave.split("|")[2] ?? "";
    const cx = num(q.cx), pc = num(q.qtd);
    const un = pc > 0 ? pc : cx * (caixa[produto] ?? 1);
    if (un <= 0) continue;
    pecas += un; if (cx > 0 && !(pc > 0)) caixas += cx;
    const preco = num(precos[i] ?? "") || pisos[i]?.preco || 0;
    if (preco > 0) { total += un * preco; moedaTotal = moedaTotal ?? pisos[i]?.moeda ?? null; } else semPreco++;
  }

  return (
    <>
      <table ref={tabela} style={{ minWidth: 520 }} data-sem-filtro>
        <thead><tr><th style={{ width: 36 }}>#</th><th>Produto</th><th style={{ width: 100 }}>Caixas</th><th style={{ width: 100 }}>ou peças</th>
          <th style={{ width: 150 }}>Preço por peça</th>{unidades.length > 1 && <th style={{ width: 150 }}>Sai de</th>}</tr></thead>
        <tbody>
          {Array.from({ length: n }, (_, i) => {
            const piso = pisos[i];
            const valor = num(precos[i] ?? "");
            const minimo = piso?.piso ?? piso?.preco ?? null;
            const abaixo = !podeBaixar && minimo != null && valor > 0 && valor < minimo;
            return (
              <tr key={i}>
                <td className="num suave">{i + 1}</td>
                <td>
                  <BuscaLista name={`produto_${i}`} opcoes={opcoes} ariaLabel={`Produto ${i + 1}`} placeholder="Digite nome ou código (ex.: sha%uva)" defaultValue={iniciais[i]?.produto} />
                  {estoques[i]?.lista.length ? (
                    <div className="pequeno suave">Estoque: {estoques[i].lista.map((x) => `${x.nome} ${x.saldo.toLocaleString("pt-BR")}`).join(" · ")}</div>
                  ) : null}
                </td>
                <td><input name={`cx_${i}`} inputMode="numeric" aria-label={`Caixas ${i + 1}`} onFocus={() => consultar(i)}
                  defaultValue={iniciais[i]?.cx ? String(iniciais[i].cx) : undefined} onChange={(e) => { mudarQtd(i, "cx", e.target.value); consultar(i); }} /></td>
                <td><input name={`qtd_${i}`} inputMode="decimal" aria-label={`Peças ${i + 1}`} onFocus={() => consultar(i)}
                  defaultValue={iniciais[i]?.qtd ? String(iniciais[i].qtd) : undefined} onChange={(e) => { mudarQtd(i, "qtd", e.target.value); consultar(i); }} /></td>
                <td>
                  <input name={`preco_${i}`} inputMode="decimal" aria-label={`Preço por peça ${i + 1}`} value={precos[i] ?? ""}
                    placeholder={piso?.preco != null ? fmt(piso.preco, piso.moeda) : "da tabela"}
                    onFocus={() => consultar(i)} onChange={(e) => setPrecos((p) => ({ ...p, [i]: e.target.value }))}
                    style={abaixo ? { borderColor: "var(--erro)" } : undefined} aria-invalid={abaixo || undefined} />
                  {abaixo && <div className="pequeno texto-erro">Mínimo (VIP) {fmt(minimo!, piso!.moeda)}</div>}
                  {!abaixo && !podeBaixar && minimo != null && piso?.preco != null && minimo < piso.preco && (
                    <div className="pequeno suave">pode baixar até {fmt(minimo, piso.moeda)}</div>)}
                </td>
                {unidades.length > 1 && (
                  <td>
                    <select name={`origem_${i}`} defaultValue="" aria-label={`De onde sai o produto ${i + 1}`} onFocus={() => consultar(i)}>
                      <option value="">Depósito do pedido</option>
                      {unidades.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                    </select>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {pecas > 0 && (
        <div className="aviso-caixa info linha entre" style={{ marginTop: 8 }} aria-live="polite">
          <span><b>{pecas.toLocaleString("pt-BR")}</b> peça(s){caixas > 0 ? <> · <b>{caixas.toLocaleString("pt-BR")}</b> caixa(s)</> : null}</span>
          <span>{total > 0 ? <>Total estimado <b className="num">{fmt(total, moedaTotal)}</b></> : "Escolha o cliente para ver o total"}
            {semPreco > 0 && total > 0 ? <span className="pequeno suave"> · {semPreco} linha(s) sem preço ainda</span> : null}</span>
        </div>
      )}
      <div className="linha" style={{ marginTop: 8, gap: 8 }}>
        <button type="button" onClick={() => setN((x) => Math.min(x + 1, 300))}>+ Adicionar produto</button>
        <button type="button" className="discreto" onClick={() => setN((x) => Math.min(x + 10, 300))}>+ 10 linhas</button>
        <span className="pequeno suave">{n} linhas · linhas vazias são ignoradas · preço vazio = tabela do cliente
          {podeBaixar ? "" : " · pode baixar até o preço VIP, nunca menos"}
          {unidades.length > 1 ? " · \"Sai de\": produto de outra unidade vira pedido entre unidades automático" : ""}</span>
      </div>
    </>
  );
}
