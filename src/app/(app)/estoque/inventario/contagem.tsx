"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarInventario } from "./acoes";

export type ItemInventario = { id: string; codigo: string; nome: string; marca: string | null; gtin: string | null; saldo: number; caixa: number | null; codigos: string[] };

/** "12" → 12 · "2cx" → 2 × peças da caixa · "2x12" → 24 */
function quantidade(v: string, caixa: number | null): number | null {
  const t = v.trim().toLowerCase().replace(",", ".");
  if (!t) return null;
  let m = t.match(/^(\d+(?:\.\d+)?)\s*(cx|caixa|caixas|c)$/);
  if (m) return caixa ? Math.round(Number(m[1]) * caixa) : null;
  m = t.match(/^(\d+)\s*[x*]\s*(\d+)$/);
  if (m) return Number(m[1]) * Number(m[2]);
  return /^\d+$/.test(t) ? Number(t) : null;
}

/**
 * Contagem de estoque: bipe cada peça com o leitor (soma 1) ou digite a quantidade contada.
 * A contagem fica guardada neste aparelho até salvar, para não perder se a página fechar.
 */
export function Contagem({ deposito, itens }: { deposito: string; itens: ItemInventario[] }) {
  const router = useRouter();
  const chave = `vc_inventario_${deposito}`;
  const [contado, setContado] = useState<Record<string, string>>({});
  // saldo do sistema quando cada produto começou a ser contado (venda no meio da contagem não é desfeita)
  const [bases, setBases] = useState<Record<string, number>>({});
  const [busca, setBusca] = useState("");
  const [marca, setMarca] = useState("");
  const [so, setSo] = useState<"todos" | "contados" | "faltam" | "diferenca">("todos");
  const [bipe, setBipe] = useState("");
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; erro?: string }>({});
  const [salvando, iniciar] = useTransition();
  const campoBipe = useRef<HTMLInputElement>(null);

  useEffect(() => { try { setContado(JSON.parse(localStorage.getItem(chave) ?? "{}")); setBases(JSON.parse(localStorage.getItem(chave + "_base") ?? "{}")); } catch { /* sem armazenamento */ } }, [chave]);
  useEffect(() => { try { localStorage.setItem(chave, JSON.stringify(contado)); localStorage.setItem(chave + "_base", JSON.stringify(bases)); } catch { /* sem armazenamento */ } }, [contado, bases, chave]);
  const marcarBase = (id: string) => setBases((b) => b[id] !== undefined ? b : { ...b, [id]: itens.find((i) => i.id === id)?.saldo ?? 0 });
  const valor = (i: ItemInventario) => contado[i.id] !== undefined && contado[i.id] !== "" ? quantidade(contado[i.id], i.caixa) : null;

  const marcas = useMemo(() => [...new Set(itens.map((i) => i.marca ?? ""))].sort(), [itens]);
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return itens.filter((i) => (!marca || (i.marca ?? "") === marca)
      && (!q || i.nome.toLowerCase().includes(q) || i.codigo.toLowerCase().includes(q) || i.gtin === q)
      && (so === "todos" || (so === "contados" ? contado[i.id] !== undefined && contado[i.id] !== "" : so === "faltam" ? !contado[i.id] : valor(i) != null && valor(i) !== (bases[i.id] ?? i.saldo))));
  }, [itens, busca, marca, so, contado]);
  const feitos = Object.values(contado).filter((v) => v !== "").length;
  const resumo = useMemo(() => { let mais = 0, menos = 0; for (const i of itens) { const q = valor(i); if (q == null) continue; const d = q - (bases[i.id] ?? i.saldo); if (d > 0) mais += d; else menos -= d; } return { mais, menos }; }, [itens, contado, bases]); // eslint-disable-line react-hooks/exhaustive-deps

  function bipar(codigo: string) {
    const c = codigo.trim();
    const p = itens.find((i) => i.gtin === c || i.codigo.toLowerCase() === c.toLowerCase() || i.codigos?.some((x) => x.toLowerCase() === c.toLowerCase()));
    if (!p) { setMsg({ erro: `Código ${c} não encontrado. Procure pelo nome e digite a quantidade.` }); return; }
    marcarBase(p.id);
    setContado((m) => ({ ...m, [p.id]: String((quantidade(m[p.id] ?? "", p.caixa) ?? 0) + 1) }));
    setUltimo(p.id); setMsg({}); setBipe("");
  }

  function salvar() {
    const ruins = itens.filter((i) => contado[i.id] && valor(i) == null);
    if (ruins.length) { setMsg({ erro: `Quantidade inválida em: ${ruins.slice(0, 3).map((i) => i.nome).join(", ")}${ruins[0]?.caixa ? "" : " (produto sem peças por caixa: digite em peças)"}` }); return; }
    const linhas = itens.filter((i) => valor(i) != null).map((i) => ({ produto_id: i.id, contado: valor(i)!, base: bases[i.id] ?? i.saldo }));
    if (!window.confirm(`Salvar a contagem de ${linhas.length} produto(s)? O estoque desta unidade fica igual ao contado.`)) return;
    iniciar(async () => {
      const r = await salvarInventario(deposito, linhas);
      setMsg(r);
      if (!r.erro) { setContado({}); setBases({}); router.refresh(); }
    });
  }

  const ult = itens.find((i) => i.id === ultimo);
  return (
    <>
      <section className="painel">
        <label>Leitor de código de barras: bipe cada peça (soma 1)
          <input ref={campoBipe} value={bipe} autoFocus onChange={(e) => setBipe(e.target.value)} placeholder="Bipe aqui"
                 onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (bipe.trim()) bipar(bipe); } }} />
        </label>
        {ult && <div className="aviso-caixa ok">+1 {ult.nome} · contado: <b>{contado[ult.id]}</b></div>}
        <div className="painel filtros" style={{ padding: 0, border: 0 }}>
          <label className="filtro-busca">Procurar<input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, código ou código de barras" /></label>
          <label>Marca<select value={marca} onChange={(e) => setMarca(e.target.value)}><option value="">Todas</option>{marcas.map((m) => <option key={m} value={m}>{m || "(sem marca)"}</option>)}</select></label>
          <label>Mostrar<select value={so} onChange={(e) => setSo(e.target.value as typeof so)}>
            <option value="todos">Todos</option><option value="faltam">Falta contar</option><option value="contados">Já contados</option><option value="diferenca">Com diferença</option>
          </select></label>
        </div>
        <div className="pequeno suave">{feitos} produto(s) contado(s) neste aparelho · {lista.length} na lista{feitos > 0 ? ` · ao salvar: +${resumo.mais} / −${resumo.menos} peças` : ""}</div>
      </section>
      <div className="tabela"><table>
        <thead><tr><th>Produto</th><th className="num">No sistema</th><th className="num">Contado</th><th className="num">Diferença</th></tr></thead>
        <tbody>{lista.slice(0, 400).map((i) => {
          const v = contado[i.id];
          const q = valor(i);
          const dif = q != null ? q - (bases[i.id] ?? i.saldo) : null;
          return (
            <tr key={i.id} className={i.id === ultimo ? "linha-destaque" : ""}>
              <td>{i.nome}<div className="pequeno suave">{i.codigo}{i.marca ? ` · ${i.marca}` : ""}{i.caixa ? ` · caixa com ${i.caixa}` : ""}</div></td>
              <td className="num">{i.saldo.toLocaleString("pt-BR")}</td>
              <td className="num"><input value={v ?? ""} style={{ width: 80 }} aria-label={`Contado de ${i.nome}`} placeholder={i.caixa ? "ex.: 2cx" : ""}
                    onChange={(e) => { marcarBase(i.id); setContado((m) => ({ ...m, [i.id]: e.target.value.replace(/[^\dcxaiCXAI.,*\s]/g, "") })); }} />
                {v && q != null && String(q) !== v.trim() && <div className="pequeno suave">= {q} pç</div>}
                {v && q == null && <div className="pequeno texto-erro">inválido</div>}</td>
              <td className={`num ${dif ? "texto-erro" : ""}`}>{dif == null ? "" : dif > 0 ? `+${dif}` : dif}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      {lista.length > 400 && <p className="pequeno suave">Mostrando 400 de {lista.length}: use a busca ou a marca para achar os outros.</p>}
      <div className="salvar-fixo">
        <button type="button" className="principal" disabled={salvando || feitos === 0} onClick={salvar}>{salvando ? "Salvando…" : `Salvar contagem (${feitos})`}</button>
        {feitos > 0 && <button type="button" className="discreto" onClick={() => { if (window.confirm("Apagar a contagem deste aparelho?")) setContado({}); }}>Recomeçar</button>}
        {msg.erro && <span className="texto-erro">{msg.erro}</span>}
        {msg.ok && <span>{msg.ok}</span>}
        <span className="pequeno suave">Só os produtos contados mudam. Produto não contado continua como está.</span>
      </div>
    </>
  );
}
