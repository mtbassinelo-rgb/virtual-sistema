"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarInventario } from "./acoes";

export type ItemInventario = { id: string; codigo: string; nome: string; marca: string | null; gtin: string | null; foto: string | null; kits?: string | null; saldo: number; caixa: number | null; codigos: string[] };

type Modo = "unidade" | "caixa";

/** Por unidade: "12" → 12 peças. Por caixa: "2" → 2 caixas (× peças da caixa).
 *  Nos dois modos: "2cx" → 2 caixas · "2x12" → 24 · "2cx+5" → 2 caixas e 5 peças soltas. */
function quantidade(v: string, caixa: number | null, modo: Modo = "unidade"): number | null {
  const t = v.trim().toLowerCase().replace(",", ".");
  if (!t) return null;
  let m = t.match(/^(\d+)\s*(?:cx|caixa|caixas|c)\s*\+\s*(\d+)$/);
  if (m) return caixa ? Number(m[1]) * caixa + Number(m[2]) : null;
  m = t.match(/^(\d+(?:\.\d+)?)\s*(cx|caixa|caixas|c)$/);
  if (m) return caixa ? Math.round(Number(m[1]) * caixa) : null;
  m = t.match(/^(\d+)\s*[x*]\s*(\d+)$/);
  if (m) return Number(m[1]) * Number(m[2]);
  if (!/^\d+$/.test(t)) return null;
  if (modo === "caixa") return caixa ? Number(t) * caixa : Number(t); // produto sem caixa: conta em peças
  return Number(t);
}

/**
 * Contagem de estoque: bipe cada peça com o leitor (soma 1) ou digite a quantidade contada.
 * A contagem fica guardada neste aparelho até salvar, para não perder se a página fechar.
 */
export function Contagem({ deposito, itens }: { deposito: string; itens: ItemInventario[] }) {
  const router = useRouter();
  const chave = `vc_inventario_${deposito}`;
  const [contado, setContado] = useState<Record<string, string>>({});
  const [modo, setModo] = useState<Modo>("unidade");
  // substituir: o estoque fica igual ao contado · somar: o contado entra em cima do que já está (carregar aos poucos)
  const [acao, setAcao] = useState<"substituir" | "somar">("substituir");
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

  useEffect(() => { try { setContado(JSON.parse(localStorage.getItem(chave) ?? "{}")); setBases(JSON.parse(localStorage.getItem(chave + "_base") ?? "{}")); setModo(localStorage.getItem(chave + "_modo") === "caixa" ? "caixa" : "unidade"); setAcao(localStorage.getItem(chave + "_acao") === "somar" ? "somar" : "substituir"); } catch { /* sem armazenamento */ } }, [chave]);
  useEffect(() => { try { localStorage.setItem(chave, JSON.stringify(contado)); localStorage.setItem(chave + "_base", JSON.stringify(bases)); localStorage.setItem(chave + "_modo", modo); localStorage.setItem(chave + "_acao", acao); } catch { /* sem armazenamento */ } }, [contado, bases, modo, acao, chave]);
  /** Quanto o estoque muda ao salvar: somar → tudo o que foi contado entra; substituir → contado menos o saldo. */
  const mudanca = (i: ItemInventario, q: number) => acao === "somar" ? q : q - (bases[i.id] ?? i.saldo);
  const marcarBase = (id: string) => setBases((b) => b[id] !== undefined ? b : { ...b, [id]: itens.find((i) => i.id === id)?.saldo ?? 0 });
  const valor = (i: ItemInventario) => contado[i.id] !== undefined && contado[i.id] !== "" ? quantidade(contado[i.id], i.caixa, modo) : null;

  const marcas = useMemo(() => [...new Set(itens.map((i) => i.marca ?? ""))].sort(), [itens]);
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return itens.filter((i) => (!marca || (i.marca ?? "") === marca)
      && (!q || i.nome.toLowerCase().includes(q) || i.codigo.toLowerCase().includes(q) || i.gtin === q)
      && (so === "todos" || (so === "contados" ? contado[i.id] !== undefined && contado[i.id] !== "" : so === "faltam" ? !contado[i.id] : valor(i) != null && mudanca(i, valor(i)!) !== 0)));
  }, [itens, busca, marca, so, contado, modo, acao]); // eslint-disable-line react-hooks/exhaustive-deps
  const feitos = Object.values(contado).filter((v) => v !== "").length;
  const resumo = useMemo(() => { let mais = 0, menos = 0; for (const i of itens) { const q = valor(i); if (q == null) continue; const d = mudanca(i, q); if (d > 0) mais += d; else menos -= d; } return { mais, menos }; }, [itens, contado, bases, modo, acao]); // eslint-disable-line react-hooks/exhaustive-deps

  function bipar(codigo: string) {
    const c = codigo.trim();
    const p = itens.find((i) => i.gtin === c || i.codigo.toLowerCase() === c.toLowerCase() || i.codigos?.some((x) => x.toLowerCase() === c.toLowerCase()));
    if (!p) { setMsg({ erro: `Código ${c} não encontrado. Procure pelo nome e digite a quantidade.` }); return; }
    marcarBase(p.id);
    // bipe soma 1 no modo escolhido: 1 peça (por unidade) ou 1 caixa (por caixa)
    setContado((m) => ({ ...m, [p.id]: /^\d*$/.test((m[p.id] ?? "").trim()) ? String(Number(m[p.id] || 0) + 1) : m[p.id] }));
    setUltimo(p.id); setMsg({}); setBipe("");
  }

  function salvar() {
    const ruins = itens.filter((i) => contado[i.id] && valor(i) == null);
    if (ruins.length) { setMsg({ erro: `Quantidade inválida em: ${ruins.slice(0, 3).map((i) => i.nome).join(", ")}${ruins[0]?.caixa ? "" : " (produto sem peças por caixa: digite em peças)"}` }); return; }
    // somar: manda "base + contado", e o servidor lança só o contado em cima do saldo
    const linhas = itens.filter((i) => valor(i) != null).map((i) => { const base = bases[i.id] ?? i.saldo; return { produto_id: i.id, contado: acao === "somar" ? base + valor(i)! : valor(i)!, base }; });
    if (!window.confirm(acao === "somar"
      ? `Somar ${resumo.mais} peça(s) ao estoque desta unidade (${linhas.length} produto(s))?`
      : `Salvar a contagem de ${linhas.length} produto(s)? O estoque desta unidade fica igual ao contado.`)) return;
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
        <div className="linha" role="group" aria-label="Contar em" style={{ alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <b>Contar em:</b>
          <button type="button" className={modo === "unidade" ? "principal" : ""} aria-pressed={modo === "unidade"} disabled={feitos > 0 && modo !== "unidade"}
                  onClick={() => setModo("unidade")}>Unidades (peças)</button>
          <button type="button" className={modo === "caixa" ? "principal" : ""} aria-pressed={modo === "caixa"} disabled={feitos > 0 && modo !== "caixa"}
                  onClick={() => setModo("caixa")}>Caixas fechadas</button>
          <span className="pequeno suave">{modo === "unidade"
            ? <>Digite quantas <b>peças</b> contou (ex.: 30). Também aceita 2cx ou 2cx+5.</>
            : <>Digite quantas <b>caixas</b> contou (ex.: 2). Para caixas e peças soltas: 2+5 vira 2cx+5. Produto sem caixa conta em peças.</>}
            {feitos > 0 ? " Para trocar o modo, salve ou recomece a contagem." : ""}</span>
        </div>
        <div className="linha" role="group" aria-label="Ao salvar" style={{ alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <b>Ao salvar:</b>
          <button type="button" className={acao === "somar" ? "principal" : ""} aria-pressed={acao === "somar"} disabled={feitos > 0 && acao !== "somar"}
                  onClick={() => setAcao("somar")}>Somar ao estoque</button>
          <button type="button" className={acao === "substituir" ? "principal" : ""} aria-pressed={acao === "substituir"} disabled={feitos > 0 && acao !== "substituir"}
                  onClick={() => setAcao("substituir")}>Substituir pelo contado</button>
          <span className="pequeno suave">{acao === "somar"
            ? <><b>Carregar aos poucos:</b> o que você contar entra em cima do que já está. Salvou 12 e depois mais 12 = 24.</>
            : <><b>Conferir a prateleira:</b> o estoque fica igual ao que você contou agora (salvar 12 duas vezes = 12).</>}</span>
        </div>
        <label>Leitor de código de barras: bipe cada {modo === "unidade" ? "peça" : "caixa"} (soma 1)
          <input ref={campoBipe} value={bipe} autoFocus onChange={(e) => setBipe(e.target.value)} placeholder="Bipe aqui"
                 onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (bipe.trim()) bipar(bipe); } }} />
        </label>
        {ult && <div className="aviso-caixa ok" style={{ display: "flex", gap: 10, alignItems: "center" }}>{ult.foto && <img src={ult.foto} alt="" width={44} height={44} style={{ objectFit: "contain", background: "#fff", borderRadius: 6 }} />}<span>+1 {ult.nome} · contado: <b>{contado[ult.id]}</b></span></div>}
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
        <thead><tr><th>Produto</th><th className="num">No sistema</th><th className="num">Contado</th><th className="num">{acao === "somar" ? "Vai entrar" : "Diferença"}</th></tr></thead>
        <tbody>{lista.slice(0, 400).map((i) => {
          const v = contado[i.id];
          const q = valor(i);
          const dif = q != null ? mudanca(i, q) : null;
          return (
            <tr key={i.id} className={i.id === ultimo ? "linha-destaque" : ""}>
              <td>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {/* foto para reconhecer o produto na prateleira (clique para ver grande) */}
                  {i.foto
                    ? <a href={i.foto} target="_blank" rel="noopener noreferrer" style={{ flex: "none" }}><img src={i.foto} alt="" width={56} height={56} loading="lazy" style={{ objectFit: "contain", background: "#fff", borderRadius: 8, border: "1px solid var(--linha)", display: "block" }} /></a>
                    : <div style={{ width: 56, height: 56, flex: "none", borderRadius: 8, background: "var(--afundado)", display: "grid", placeItems: "center", fontSize: 10, textAlign: "center" }} className="suave">sem foto</div>}
                  <div>{i.nome}<div className="pequeno suave">{i.codigo}{i.marca ? ` · ${i.marca}` : ""}{i.caixa ? ` · caixa com ${i.caixa}` : ""}</div>{i.kits && <div className="pequeno" title={i.kits}>🧩 Peça de kit: {i.kits.length > 70 ? i.kits.slice(0, 70) + "…" : i.kits}</div>}</div>
                </div>
              </td>
              <td className="num">{i.saldo.toLocaleString("pt-BR")} pç{i.caixa && i.caixa > 1 ? <div className="pequeno suave">{Math.floor(i.saldo / i.caixa)} cx{i.saldo % i.caixa ? ` + ${i.saldo % i.caixa} pç` : ""}</div> : null}</td>
              <td className="num"><input value={v ?? ""} style={{ width: 80 }} aria-label={`Contado de ${i.nome}`} placeholder={modo === "caixa" && i.caixa ? "caixas" : "peças"}
                    onChange={(e) => { marcarBase(i.id); setContado((m) => ({ ...m, [i.id]: e.target.value.replace(/[^\dcxaiCXAI.,*+\s]/g, "").replace(/^(\d+)\+/, modo === "caixa" ? "$1cx+" : "$1+") })); }} />
                {v && q != null && String(q) !== v.trim() && <div className="pequeno suave">= {q} pç</div>}
                {v && q == null && <div className="pequeno texto-erro">inválido</div>}</td>
              <td className={`num ${dif && acao === "substituir" ? "texto-erro" : ""}`}>{dif == null ? "" : dif > 0 ? `+${dif}` : dif}</td>
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
        <span className="pequeno suave">Só os produtos contados mudam. Produto não contado continua como está.{acao === "somar" ? " Depois de salvar, pode continuar contando e salvar de novo: soma outra vez." : ""}</span>
      </div>
    </>
  );
}
