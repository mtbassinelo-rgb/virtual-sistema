"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type LinhaPrec = {
  produto_id: string; codigo: string; nome: string; marca: string | null; foto: string | null; tipo: string; caixa: number | null;
  custo_brl: string | null; custo_origem: string | null; frete_brl: string | null; planilha_custo: string | null; planilha_origem: string | null;
  preco_normal: string | null; preco_vip: string | null; alvo_normal: string; alvo_vip: string;
  vendido_90: string; saldo: string | null; motor: boolean; papel: string; situacao: string;
};
export type Premissas = { cambio: number; imposto: number; entregaCaixa: number; margemMin: number; arred: number };
type Edit = { custo?: string; frete?: string; caixa?: string; normal?: string; vip?: string };

const SIT: Record<string, { t: string; cor: string }> = {
  sem_custo: { t: "Sem custo", cor: "erro" },
  abaixo_minimo: { t: "Abaixo do mínimo", cor: "erro" },
  sem_preco: { t: "Sem preço", cor: "aviso" },
  margem_baixa: { t: "Margem abaixo do alvo", cor: "aviso" },
  margem_alta: { t: "Margem acima do alvo", cor: "info" },
  ok: { t: "No alvo", cor: "ok" },
};

/** "20.000" → 20000 · "2,34" → 2.34 */
const num = (s: string | null | undefined): number | null => {
  if (s == null) return null;
  let t = String(s).replace(/\s|R\$|Gs/gi, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const brl = (v: number | null) => (v == null ? "" : v.toFixed(2).replace(".", ","));
const gsTxt = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("es-PY"));
const pctTxt = (v: number | null) => (v == null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

function calcular(l: LinhaPrec, e: Edit, p: Premissas) {
  const custo = e.custo !== undefined ? num(e.custo) : num(l.custo_brl);
  const frete = e.frete !== undefined ? num(e.frete) : num(l.frete_brl);
  const caixa = e.caixa !== undefined ? num(e.caixa) : l.caixa;
  const normal = e.normal !== undefined ? num(e.normal) : num(l.preco_normal);
  const vip = e.vip !== undefined ? num(e.vip) : num(l.preco_vip);
  const imp = p.imposto / 100;
  const real = custo != null ? (custo + (frete ?? 0)) * p.cambio : null;
  const ent = caixa ? p.entregaCaixa / caixa : null;
  const base = real != null && ent != null ? real + ent : null;
  const arred = (v: number) => Math.ceil(v / p.arred) * p.arred;
  const minimo = base != null && 1 - imp - p.margemMin / 100 > 0 ? arred(base / (1 - imp - p.margemMin / 100)) : null;
  const sug = (alvo: number) => (base != null && 1 - imp - alvo > 0 ? Math.max(minimo ?? 0, arred(base / (1 - imp - alvo))) : null);
  const contrib = (pr: number | null) => (pr && base != null ? (pr * (1 - imp) - base) / pr : null);
  const lucro = (pr: number | null) => (pr && real != null ? (pr - real) / pr : null);
  const sugN = sug(Number(l.alvo_normal)), sugV = sug(Number(l.alvo_vip));
  return { custo, frete, caixa, normal, vip, real, base, minimo, sugN, sugV, custoFrete: custo != null ? custo + (frete ?? 0) : null,
    mN: contrib(normal), mV: contrib(vip), lN: lucro(normal), lV: lucro(vip), lSN: lucro(sugN), lSV: lucro(sugV), mSN: contrib(sugN), mSV: contrib(sugV),
    semFrete: frete == null };
}

export function GradePrecificacao({ linhas, premissas, acao }: {
  linhas: LinhaPrec[]; premissas: Premissas;
  acao: (fd: FormData) => Promise<{ ok?: string; erro?: string }>;
}) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [marca, setMarca] = useState("");
  const [sit, setSit] = useState("");
  const [soMotor, setSoMotor] = useState(false);
  const [soPlanilha, setSoPlanilha] = useState(false);
  const [ordem, setOrdem] = useState("vendas");
  const [limite, setLimite] = useState(150);
  const [msg, setMsg] = useState<{ ok?: string; erro?: string } | null>(null);
  const [salvando, iniciar] = useTransition();

  const marcas = useMemo(() => [...new Set(linhas.map((l) => l.marca ?? "Sem marca"))].sort(), [linhas]);
  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    const r = linhas.filter((l) => (!t || `${l.codigo} ${l.nome} ${l.marca ?? ""}`.toLowerCase().includes(t))
      && (!marca || (l.marca ?? "Sem marca") === marca) && (!sit || l.situacao === sit)
      && (!soMotor || l.motor) && (!soPlanilha || l.planilha_custo != null));
    const ord: Record<string, (a: LinhaPrec, b: LinhaPrec) => number> = {
      vendas: (a, b) => Number(b.vendido_90) - Number(a.vendido_90),
      nome: (a, b) => a.nome.localeCompare(b.nome),
      marca: (a, b) => (a.marca ?? "").localeCompare(b.marca ?? "") || a.nome.localeCompare(b.nome),
    };
    return r.sort(ord[ordem]);
  }, [linhas, q, marca, sit, soMotor, soPlanilha, ordem]);

  const contagem = useMemo(() => linhas.reduce<Record<string, number>>((a, l) => { a[l.situacao] = (a[l.situacao] ?? 0) + 1; return a; }, {}), [linhas]);
  const alterados = Object.entries(edits).filter(([, e]) => Object.keys(e).length > 0);
  const selecionados = filtradas.filter((l) => sel[l.produto_id]);

  const editar = (id: string, campo: keyof Edit, valor: string) => setEdits((m) => ({ ...m, [id]: { ...m[id], [campo]: valor } }));
  const usarSugestao = (ls: LinhaPrec[]) => setEdits((m) => {
    const n = { ...m };
    for (const l of ls) {
      const c = calcular(l, n[l.produto_id] ?? {}, premissas);
      if (c.sugN != null && c.sugV != null) n[l.produto_id] = { ...n[l.produto_id], normal: String(c.sugN), vip: String(c.sugV) };
    }
    return n;
  });
  const usarPlanilha = (ls: LinhaPrec[]) => setEdits((m) => {
    const n = { ...m };
    for (const l of ls) if (l.planilha_custo != null) n[l.produto_id] = { ...n[l.produto_id], custo: brl(Number(l.planilha_custo)) };
    return n;
  });
  const desfazer = () => { setEdits({}); setMsg(null); };

  function salvar() {
    const dados = alterados.map(([id, e]) => {
      const l = linhas.find((x) => x.produto_id === id)!;
      const mudou = (novo: string | undefined, antigo: number | string | null) => novo !== undefined && num(novo) !== (antigo == null ? null : Number(antigo));
      return {
        id, codigo: l.codigo,
        custo: mudou(e.custo, l.custo_brl) ? num(e.custo) : undefined,
        origem: e.custo !== undefined && l.planilha_custo != null && num(e.custo) === Number(l.planilha_custo) ? `Planilha PRODUCTOS VC › ${l.planilha_origem?.replace(/^parecido: /, "")}` : undefined,
        frete: mudou(e.frete, l.frete_brl) ? num(e.frete) : undefined,
        caixa: mudou(e.caixa, l.caixa) ? num(e.caixa) : undefined,
        normal: mudou(e.normal, l.preco_normal) ? num(e.normal) : undefined,
        vip: mudou(e.vip, l.preco_vip) ? num(e.vip) : undefined,
      };
    }).filter((d) => d.custo !== undefined || d.frete !== undefined || d.caixa !== undefined || d.normal !== undefined || d.vip !== undefined);
    if (!dados.length) { setMsg({ erro: "Nada mudou." }); return; }
    const fd = new FormData();
    fd.set("dados", JSON.stringify(dados));
    iniciar(async () => {
      const r = await acao(fd);
      setMsg(r);
      if (r.ok) { setEdits({}); setSel({}); router.refresh(); }
    });
  }

  const visiveis = filtradas.slice(0, limite);
  const todosSel = visiveis.length > 0 && visiveis.every((l) => sel[l.produto_id]);

  return (
    <>
      <nav className="abas" aria-label="Situação">
        <a href="#" onClick={(e) => { e.preventDefault(); setSit(""); }} aria-current={sit === "" ? "page" : undefined}>Todos ({linhas.length})</a>
        {Object.entries(SIT).map(([k, s]) => (
          <a key={k} href="#" onClick={(e) => { e.preventDefault(); setSit(k); }} aria-current={sit === k ? "page" : undefined}>{s.t} ({contagem[k] ?? 0})</a>
        ))}
      </nav>

      <section className="painel filtros">
        <label style={{ flex: 2, minWidth: 200 }}>Buscar<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, código ou marca" /></label>
        <label>Marca<select value={marca} onChange={(e) => setMarca(e.target.value)}>
          <option value="">Todas</option>{marcas.map((m) => <option key={m} value={m}>{m}</option>)}
        </select></label>
        <label>Ordenar<select value={ordem} onChange={(e) => setOrdem(e.target.value)}>
          <option value="vendas">Mais vendidos (90 dias)</option><option value="marca">Marca</option><option value="nome">Nome</option>
        </select></label>
        <label className="pequeno" style={{ alignSelf: "end" }}><input type="checkbox" checked={soMotor} onChange={(e) => setSoMotor(e.target.checked)} /> Só marcas do motor</label>
        <label className="pequeno" style={{ alignSelf: "end" }}><input type="checkbox" checked={soPlanilha} onChange={(e) => setSoPlanilha(e.target.checked)} /> Custo da planilha para conferir</label>
        <span className="pequeno suave" style={{ alignSelf: "end" }}>{filtradas.length} produto(s)</span>
      </section>

      {selecionados.length > 0 && (
        <section className="painel linha" style={{ flexWrap: "wrap", gap: 8 }}>
          <b>{selecionados.length} selecionado(s)</b>
          <button type="button" onClick={() => usarSugestao(selecionados)}>Usar preço sugerido</button>
          <button type="button" onClick={() => usarPlanilha(selecionados)}>Usar custo da planilha</button>
          <button type="button" onClick={() => setSel({})}>Limpar seleção</button>
          <span className="pequeno suave">Só preenche a tabela. Nada é gravado até você clicar em Salvar.</span>
        </section>
      )}

      <section className="painel" style={{ padding: 0 }}>
        <div className="tabela precos-grade"><table>
          <thead><tr>
            <th style={{ width: 32 }}><input type="checkbox" aria-label="Selecionar todos os visíveis" checked={todosSel}
              onChange={(e) => setSel((s) => { const n = { ...s }; visiveis.forEach((l) => { n[l.produto_id] = e.target.checked; }); return n; })} /></th>
            <th>Produto</th>
            <th title="Custo por unidade em R$, sem frete">Custo R$</th>
            <th title="Frete de compra por unidade em R$">Frete R$</th>
            <th title="Custo + frete, em R$ e convertido no câmbio de custo">Custo c/ frete</th>
            <th title="Peças por caixa (a entrega do pasero é por caixa)">Caixa</th>
            <th>Preço Normal Gs<div className="pequeno suave">margem de lucro</div></th>
            <th>Preço VIP Gs<div className="pequeno suave">margem de lucro</div></th>
            <th title="Preço que o motor recomenda pela margem-alvo, nunca abaixo do mínimo">Motor sugere<div className="pequeno suave">preço e margem</div></th>
            <th>Vendido 90d</th><th>Situação</th>
          </tr></thead>
          <tbody>{visiveis.map((l) => {
            const e = edits[l.produto_id] ?? {};
            const c = calcular(l, e, premissas);
            const val = (campo: keyof Edit, original: string) => (e[campo] !== undefined ? e[campo]! : original);
            const cls = (campo: keyof Edit) => (e[campo] !== undefined ? "mudou" : "");
            const corM = (m: number | null) => (m == null ? "" : m < 0 ? "var(--erro, #c0392b)" : m < Number(l.alvo_vip) - 0.03 ? "var(--aviso, #b9770e)" : "var(--ok, #1e8449)");
            return (
              <tr key={l.produto_id}>
                <td><input type="checkbox" checked={!!sel[l.produto_id]} aria-label={`Selecionar ${l.nome}`}
                  onChange={(ev) => setSel((s) => ({ ...s, [l.produto_id]: ev.target.checked }))} /></td>
                <td style={{ minWidth: 240 }}>
                  <Link href={`/produtos/${l.produto_id}`}>{l.nome}</Link>
                  <div className="pequeno suave">{l.codigo} · {l.marca ?? "Sem marca"}{l.tipo === "kit" ? " · kit" : ""}{l.motor ? " · motor" : ""}</div>
                  {l.custo_origem && <div className="pequeno suave" title={l.custo_origem}>Custo: {l.custo_origem.length > 60 ? l.custo_origem.slice(0, 60) + "…" : l.custo_origem}</div>}
                </td>
                <td style={{ width: 110 }}>
                  <input className={cls("custo")} value={val("custo", brl(num(l.custo_brl)))} inputMode="decimal" placeholder="—"
                    onChange={(ev) => editar(l.produto_id, "custo", ev.target.value)} aria-label={`Custo de ${l.nome}`} />
                  {l.planilha_custo != null && e.custo === undefined && (
                    <button type="button" className="pequeno" style={{ marginTop: 2, padding: "1px 6px" }} title={l.planilha_origem ?? ""}
                      onClick={() => usarPlanilha([l])}>Planilha: {brl(Number(l.planilha_custo))}</button>)}
                </td>
                <td style={{ width: 90 }}>
                  <input className={cls("frete")} value={val("frete", brl(num(l.frete_brl)))} inputMode="decimal" placeholder="—"
                    onChange={(ev) => editar(l.produto_id, "frete", ev.target.value)} aria-label={`Frete de ${l.nome}`} />
                </td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>{c.custoFrete == null ? "—" : <><b>R$ {brl(c.custoFrete)}</b><div className="pequeno suave">Gs {gsTxt(c.real)}</div></>}</td>
                <td style={{ width: 70 }}>
                  <input className={cls("caixa")} value={val("caixa", l.caixa ? String(l.caixa) : "")} inputMode="numeric" placeholder="—"
                    onChange={(ev) => editar(l.produto_id, "caixa", ev.target.value)} aria-label={`Peças por caixa de ${l.nome}`} />
                </td>
                <td style={{ width: 120 }}>
                  <input className={cls("normal")} value={val("normal", l.preco_normal ? String(Math.round(Number(l.preco_normal))) : "")} inputMode="numeric" placeholder="—"
                    onChange={(ev) => editar(l.produto_id, "normal", ev.target.value)} aria-label={`Preço Normal de ${l.nome}`} />
                  <div className="pequeno" style={{ color: corM(c.mN) }}><b>{pctTxt(c.lN)}</b> <span className="suave">líq. {pctTxt(c.mN)}</span></div>
                </td>
                <td style={{ width: 120 }}>
                  <input className={cls("vip")} value={val("vip", l.preco_vip ? String(Math.round(Number(l.preco_vip))) : "")} inputMode="numeric" placeholder="—"
                    onChange={(ev) => editar(l.produto_id, "vip", ev.target.value)} aria-label={`Preço VIP de ${l.nome}`} />
                  <div className="pequeno" style={{ color: corM(c.mV) }}><b>{pctTxt(c.lV)}</b> <span className="suave">líq. {pctTxt(c.mV)}</span></div>
                </td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  {c.sugN == null ? <span className="pequeno suave">{c.custo == null ? "falta custo" : !c.caixa ? "falta caixa" : "—"}</span> : <>
                    <div>Normal <b>{gsTxt(c.sugN)}</b> <span className="pequeno">{pctTxt(c.lSN)}</span></div>
                    <div>VIP <b>{gsTxt(c.sugV)}</b> <span className="pequeno">{pctTxt(c.lSV)}</span></div>
                    <div><button type="button" className="pequeno" style={{ padding: "1px 6px" }} onClick={() => usarSugestao([l])}>Usar</button>
                      <span className="pequeno suave"> mín. {gsTxt(c.minimo)}</span></div>
                  </>}
                </td>
                <td className="num">{Number(l.vendido_90).toLocaleString("pt-BR")}</td>
                <td><span className={`selo ${SIT[l.situacao]?.cor ?? ""}`}>{SIT[l.situacao]?.t ?? l.situacao}</span>{c.semFrete && c.custo != null && <div className="pequeno suave">sem frete</div>}</td>
              </tr>);
          })}</tbody>
        </table></div>
        {filtradas.length > limite && (
          <div className="linha" style={{ justifyContent: "center", padding: 10 }}>
            <button type="button" onClick={() => setLimite((x) => x + 150)}>Mostrar mais ({filtradas.length - limite} restantes)</button>
          </div>)}
      </section>

      <div className={`salvar-fixo${msg?.erro ? " com-erro" : ""}`}>
        <button className="principal" type="button" disabled={alterados.length === 0 || salvando} onClick={salvar}>
          {salvando ? "Salvando…" : alterados.length ? `Salvar ${alterados.length} produto(s)` : "Nenhuma alteração"}</button>
        {alterados.length > 0 && <button type="button" onClick={desfazer} disabled={salvando}>Desfazer tudo</button>}
        <span className="pequeno suave">
          {msg?.ok ?? msg?.erro ?? "Edite direto na tabela: as margens se recalculam na hora. Nada é gravado até salvar. Preço novo vale a partir de hoje; o antigo fica no histórico."}
        </span>
      </div>
    </>
  );
}
