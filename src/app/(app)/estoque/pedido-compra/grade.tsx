"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarCusto, salvarQuantidade, zerarPedido } from "./acoes";
import type { LinhaCompra } from "./dados";

/** "2,34" → 2.34 · "1.200" → 1200 */
const num = (s: string): number | null => {
  let t = s.replace(/\s|R\$/gi, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const custoTxt = (v: number | null) => (v == null ? "" : v.toFixed(2).replace(".", ","));
const inteiro = (v: number) => v.toLocaleString("pt-BR");

type Estado = "salvando" | "ok" | "erro";

export function GradeCompra({ marca, linhas }: { marca: string; linhas: LinhaCompra[] }) {
  const router = useRouter();
  const [qtd, setQtd] = useState<Record<string, string>>(() => Object.fromEntries(linhas.map((l) => [l.produto_id, l.quantidade ? String(l.quantidade) : ""])));
  const [custo, setCusto] = useState<Record<string, string>>(() => Object.fromEntries(linhas.map((l) => [l.produto_id, custoTxt(l.custo)])));
  const [salvo, setSalvo] = useState<Record<string, number>>(() => Object.fromEntries(linhas.map((l) => [l.produto_id, l.quantidade])));
  const [custoSalvo, setCustoSalvo] = useState<Record<string, number | null>>(() => Object.fromEntries(linhas.map((l) => [l.produto_id, l.custo])));
  const [estado, setEstado] = useState<Record<string, Estado>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [mostrar, setMostrar] = useState("todos");
  const [ordem, setOrdem] = useState("nome");
  const [copiado, setCopiado] = useState(false);
  const [zerando, iniciar] = useTransition();

  const q = (id: string) => { const n = num(qtd[id] ?? ""); return n != null && n > 0 ? Math.round(n) : 0; };
  const c = (id: string) => num(custo[id] ?? "");

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const r = linhas.filter((l) => (!t || `${l.codigo} ${l.nome}`.toLowerCase().includes(t))
      && (mostrar === "todos" || (mostrar === "pedido" && (salvo[l.produto_id] ?? 0) > 0) || (mostrar === "sem-estoque" && l.saldo <= 0)
        || (mostrar === "sem-custo" && custoSalvo[l.produto_id] == null)));
    const totalDe = (l: LinhaCompra) => (salvo[l.produto_id] ?? 0) * (custoSalvo[l.produto_id] ?? 0);
    const ord: Record<string, (a: LinhaCompra, b: LinhaCompra) => number> = {
      nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
      estoque: (a, b) => a.saldo - b.saldo || a.nome.localeCompare(b.nome, "pt-BR"),
      total: (a, b) => totalDe(b) - totalDe(a) || a.nome.localeCompare(b.nome, "pt-BR"),
      custo: (a, b) => (custoSalvo[b.produto_id] ?? -1) - (custoSalvo[a.produto_id] ?? -1),
    };
    return [...r].sort(ord[ordem] ?? ord.nome);
    // a ordem e o filtro usam o que já foi salvo, para a linha não "pular" enquanto digita
  }, [linhas, busca, mostrar, ordem, salvo, custoSalvo]);

  const noPedido = linhas.filter((l) => q(l.produto_id) > 0);
  const totUn = noPedido.reduce((s, l) => s + q(l.produto_id), 0);
  const totCx = noPedido.reduce((s, l) => s + (l.caixa && l.caixa > 1 ? q(l.produto_id) / l.caixa : 0), 0);
  const total = noPedido.reduce((s, l) => s + q(l.produto_id) * (c(l.produto_id) ?? 0), 0);
  const semCusto = noPedido.filter((l) => c(l.produto_id) == null).length;
  const pendente = linhas.some((l) => q(l.produto_id) !== (salvo[l.produto_id] ?? 0)) || Object.values(estado).includes("salvando");

  async function gravarQtd(l: LinhaCompra) {
    const id = l.produto_id;
    const n = num(qtd[id] ?? "");
    if (n != null && (n < 0 || !Number.isInteger(n))) { setErro(`${l.nome}: quantidade em unidades inteiras.`); setEstado((e) => ({ ...e, [id]: "erro" })); return; }
    const v = n ?? 0;
    if (v === (salvo[id] ?? 0)) return;
    setEstado((e) => ({ ...e, [id]: "salvando" }));
    const r = await salvarQuantidade(id, v);
    if (r.erro) { setErro(`${l.nome}: ${r.erro}`); setEstado((e) => ({ ...e, [id]: "erro" })); return; }
    setErro(null); setSalvo((s) => ({ ...s, [id]: v })); setEstado((e) => ({ ...e, [id]: "ok" }));
  }

  async function gravarCusto(l: LinhaCompra) {
    const id = l.produto_id;
    const n = num(custo[id] ?? "");
    if (n == null) { setCusto((m) => ({ ...m, [id]: custoTxt(custoSalvo[id]) })); return; }
    if (n === custoSalvo[id]) return;
    setEstado((e) => ({ ...e, [id]: "salvando" }));
    const r = await salvarCusto(id, n);
    if (r.erro) { setErro(`${l.nome}: ${r.erro}`); setEstado((e) => ({ ...e, [id]: "erro" })); return; }
    setErro(null); setCustoSalvo((s) => ({ ...s, [id]: n })); setCusto((m) => ({ ...m, [id]: custoTxt(n) })); setEstado((e) => ({ ...e, [id]: "ok" }));
  }

  const caixas = (l: LinhaCompra) => {
    const n = q(l.produto_id);
    if (!n || !l.caixa || l.caixa <= 1) return "";
    const cx = n / l.caixa;
    return Number.isInteger(cx) ? `${cx} cx` : `${cx.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} cx ⚠`;
  };
  const texto = `Pedido ${marca}\n` + noPedido.map((l) => {
    const n = q(l.produto_id);
    const cx = l.caixa && l.caixa > 1 && n % l.caixa === 0 ? `${n / l.caixa} cx (${n} un)` : `${n} un`;
    return `• ${cx} — ${l.nome}${l.codigo ? ` [${l.codigo}]` : ""}`;
  }).join("\n");

  const zerar = () => {
    if (!confirm(`Zerar todas as quantidades do pedido ${marca}? Faça isso depois de exportar e mandar ao fornecedor.`)) return;
    iniciar(async () => {
      const r = await zerarPedido(marca);
      if (r.erro) { setErro(r.erro); return; }
      setQtd({}); setSalvo({}); setEstado({}); router.refresh();
    });
  };

  return (
    <section className="painel">
      <div className="resumo-compra">
        <div><small>Produtos no pedido</small><b>{noPedido.length}</b><span className="suave pequeno">de {linhas.length}</span></div>
        <div><small>Quantidade</small><b>{inteiro(totUn)} un</b><span className="suave pequeno">{totCx.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} caixas</span></div>
        <div><small>Total sem frete</small><b>{brl(total)}</b>{semCusto > 0 && <span className="texto-erro pequeno">{semCusto} sem custo</span>}</div>
      </div>

      <div className="linha" style={{ margin: "10px 0", flexWrap: "wrap", gap: 8 }}>
        <input placeholder="Buscar produto ou código" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 220 }} />
        <select value={mostrar} onChange={(e) => setMostrar(e.target.value)} aria-label="Mostrar">
          <option value="todos">Todos os produtos</option>
          <option value="pedido">Só o que está no pedido</option>
          <option value="sem-estoque">Sem estoque</option>
          <option value="sem-custo">Sem custo</option>
        </select>
        <select value={ordem} onChange={(e) => setOrdem(e.target.value)} aria-label="Ordenar">
          <option value="nome">Nome (A-Z)</option>
          <option value="estoque">Menor estoque</option>
          <option value="total">Maior total no pedido</option>
          <option value="custo">Maior custo</option>
        </select>
        <span style={{ flex: 1 }} />
        {noPedido.length > 0 && <>
          {pendente ? <span className="botao" aria-disabled title="Espere salvar">Salvando…</span>
            : <a className="botao principal" href={`/estoque/pedido-compra/planilha?marca=${encodeURIComponent(marca)}`}>Exportar planilha</a>}
          <button type="button" onClick={async () => { await navigator.clipboard.writeText(texto); setCopiado(true); }}>{copiado ? "Lista copiada ✓" : "Copiar lista"}</button>
          <a className="botao whatsapp" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
          <button type="button" onClick={zerar} disabled={zerando}>{zerando ? "Zerando…" : "Zerar pedido"}</button>
        </>}
      </div>
      {erro && <div className="aviso-caixa erro" style={{ marginBottom: 8 }}>{erro}</div>}
      <p className="suave pequeno" style={{ margin: "0 0 8px" }}>Quantidade em <b>unidades</b> (a coluna Caixas confere). Mudar o custo aqui muda o custo sem frete do produto no sistema; preço de venda não muda.</p>

      <div className="tabela"><table className="tabela-produtos">
        <thead><tr><th>Produto</th><th className="num">Estoque</th><th className="num">Un./cx</th><th className="num">Custo (R$)</th><th className="num">Quantidade</th><th className="num">Caixas</th><th className="num">Total</th><th></th></tr></thead>
        <tbody>{filtradas.map((l) => {
          const id = l.produto_id, n = q(id), cu = c(id);
          return (
            <tr key={id}>
              <td><Link href={`/produtos/${id}`}>{l.nome}</Link><div className="pequeno suave">{l.codigo}{l.tipo === "kit" ? " · kit" : ""}</div></td>
              <td className="num"><span className={`estoque-num ${l.saldo <= 0 ? "zerado" : ""}`}>{inteiro(l.saldo)}</span></td>
              <td className="num">{l.caixa ?? "—"}</td>
              <td className="num"><input className={`celula ${cu == null ? "mudou" : ""}`} inputMode="decimal" size={6} value={custo[id] ?? ""} placeholder="sem custo"
                onChange={(e) => setCusto((m) => ({ ...m, [id]: e.target.value }))} onBlur={() => gravarCusto(l)} aria-label={`Custo de ${l.nome}`} /></td>
              <td className="num"><input className={`celula ${n > 0 ? "mudou" : ""}`} inputMode="numeric" size={6} value={qtd[id] ?? ""} placeholder="0"
                onChange={(e) => setQtd((m) => ({ ...m, [id]: e.target.value }))} onBlur={() => gravarQtd(l)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} aria-label={`Quantidade de ${l.nome}`} /></td>
              <td className="num">{caixas(l)}</td>
              <td className="num">{n > 0 && cu != null ? brl(n * cu) : ""}</td>
              <td className="pequeno">{estado[id] === "salvando" ? <span className="suave">salvando…</span> : estado[id] === "ok" ? <span className="suave">✓</span>
                : estado[id] === "erro" ? <span className="texto-erro">erro</span> : null}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </section>
  );
}
