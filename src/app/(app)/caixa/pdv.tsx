"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { abrirCaixa, fecharCaixa, finalizarVenda, movimentoCaixa, precosParaVenda, receberPedido, type Resultado } from "./acoes";

export type ProdutoPdv = { id: string; codigo: string; nome: string; gtin: string | null; caixa: number | null; saldo: number };
export type ClientePdv = { id: string; nome: string; moeda: "GS" | "BRL" };
export type PedidoReceber = { id: string; rotulo: string; moeda: "GS" | "BRL"; falta: number; status: string };
export type ContaBancaria = { id: string; nome: string; moeda: "GS" | "BRL" };
type LinhaPag = { modalidade: string; valor: string; conta?: string; ref?: string };
const BANCARIA = ["transferencia", "pix", "deposito"];
const paraEnvio = (l: LinhaPag[]) => l.map((x) => ({ modalidade: x.modalidade, valor: num(x.valor), conta_bancaria_id: BANCARIA.includes(x.modalidade) ? x.conta || null : null, referencia: BANCARIA.includes(x.modalidade) ? x.ref || null : null }));

const MODALIDADES: [string, string][] = [
  ["efetivo", "Dinheiro (efetivo)"], ["pix", "Pix"], ["transferencia", "Transferência"], ["cartao", "Cartão"], ["deposito", "Depósito"], ["outro", "Outro"],
];
const fmt = (v: number, m: "GS" | "BRL") => m === "GS" ? `Gs ${Math.round(v).toLocaleString("es-PY")}` : `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "20.000" → 20000 · "39,90" → 39.9 */
const num = (s: string) => {
  let t = s.replace(/\s|R\$|Gs/gi, "");
  if (!t) return 0;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};

function Aviso({ r }: { r: Resultado }) {
  if (r.erro) return <div className="aviso-caixa erro" role="alert">{r.erro}</div>;
  if (r.ok) return <div className="aviso-caixa ok" role="status">{r.ok}</div>;
  return null;
}

/** Linhas de pagamento: forma + valor. Dinheiro mostra o troco a partir do valor entregue. */
function Pagamentos({ total, moeda, linhas, setLinhas, contas }: { total: number; moeda: "GS" | "BRL"; linhas: LinhaPag[]; setLinhas: (l: LinhaPag[]) => void; contas: ContaBancaria[] }) {
  const [entregue, setEntregue] = useState("");
  const pago = linhas.reduce((s, l) => s + num(l.valor), 0);
  const efetivo = linhas.filter((l) => l.modalidade === "efetivo").reduce((s, l) => s + num(l.valor), 0);
  const troco = num(entregue) - efetivo;
  const falta = total - pago;
  return (
    <div className="pdv-pagamentos">
      {linhas.map((l, i) => (
        <div key={i} className="linha" style={{ flexWrap: "nowrap" }}>
          <select value={l.modalidade} onChange={(e) => setLinhas(linhas.map((x, k) => k === i ? { ...x, modalidade: e.target.value } : x))} aria-label="Forma de pagamento">
            {MODALIDADES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <input value={l.valor} inputMode="decimal" placeholder="Valor" aria-label="Valor"
                 onChange={(e) => setLinhas(linhas.map((x, k) => k === i ? { ...x, valor: e.target.value } : x))} />
          {linhas.length > 1 && <button type="button" className="discreto" onClick={() => setLinhas(linhas.filter((_, k) => k !== i))} aria-label="Tirar">×</button>}
          {BANCARIA.includes(l.modalidade) && contas.length > 0 && (<>
            <select value={l.conta ?? ""} onChange={(e) => setLinhas(linhas.map((x, k) => k === i ? { ...x, conta: e.target.value } : x))} aria-label="Conta que recebeu" required>
              <option value="">Em qual conta caiu?</option>
              {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.moeda !== moeda ? ` (${c.moeda === "GS" ? "Gs" : "R$"})` : ""}</option>)}
            </select>
            <input value={l.ref ?? ""} onChange={(e) => setLinhas(linhas.map((x, k) => k === i ? { ...x, ref: e.target.value } : x))} placeholder="Nº do comprovante" aria-label="Comprovante" maxLength={80} />
          </>)}
        </div>
      ))}
      {linhas.some((l) => BANCARIA.includes(l.modalidade)) && <small className="suave">Transferência fica "a confirmar" até o gerente conferir no extrato da conta escolhida.</small>}
      <div className="linha">
        <button type="button" className="discreto" onClick={() => setLinhas([...linhas, { modalidade: "pix", valor: falta > 0 ? String(moeda === "GS" ? Math.round(falta) : falta.toFixed(2).replace(".", ",")) : "" }])}>+ outra forma</button>
        {falta > 0.009 && <button type="button" className="discreto" onClick={() => setLinhas([{ modalidade: "efetivo", valor: String(moeda === "GS" ? Math.round(total) : total.toFixed(2).replace(".", ",")) }])}>Tudo em dinheiro</button>}
      </div>
      {efetivo > 0 && (
        <label>Cliente entregou em dinheiro (para calcular o troco)
          <input value={entregue} inputMode="decimal" onChange={(e) => setEntregue(e.target.value)} placeholder={fmt(efetivo, moeda)} />
        </label>
      )}
      <div className="pdv-totais">
        <span>Pago: <b>{fmt(pago, moeda)}</b></span>
        {falta > 0.009 && <span className="texto-erro">Falta: {fmt(falta, moeda)}</span>}
        {falta < -0.009 && <span className="texto-erro">Passou do total: {fmt(-falta, moeda)}</span>}
        {num(entregue) > 0 && troco >= 0 && <span className="troco">Troco: <b>{fmt(troco, moeda)}</b></span>}
      </div>
    </div>
  );
}

/** Venda no balcão: busca por nome, código ou código de barras (leitor), quantidades, preço e formas de pagamento. */
export function VendaBalcao({ caixa, produtos, clientes, moedaPadrao, contas }: { caixa: string; produtos: ProdutoPdv[]; clientes: ClientePdv[]; moedaPadrao: "GS" | "BRL"; contas: ContaBancaria[] }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [cliente, setCliente] = useState("");
  const [moeda, setMoeda] = useState<"GS" | "BRL">(moedaPadrao);
  const [itens, setItens] = useState<{ produto: ProdutoPdv; qtd: string; preco: string }[]>([]);
  const [pags, setPags] = useState<LinhaPag[]>([{ modalidade: "efetivo", valor: "" }]);
  const [obs, setObs] = useState("");
  const [r, setR] = useState<Resultado>({});
  const [enviando, iniciar] = useTransition();
  const campo = useRef<HTMLInputElement>(null);

  const achados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (q.length < 2) return [];
    return produtos.filter((p) => p.gtin === q || p.codigo.toLowerCase() === q || p.nome.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q)).slice(0, 12);
  }, [busca, produtos]);

  async function precosDe(lista: ProdutoPdv[], cli = cliente, m = moeda) {
    return precosParaVenda(cli || null, m, lista.map((p) => p.id), caixa);
  }
  async function adicionar(p: ProdutoPdv, qtd = 1) {
    setBusca(""); campo.current?.focus();
    const ja = itens.find((i) => i.produto.id === p.id);
    if (ja) { setItens(itens.map((i) => i.produto.id === p.id ? { ...i, qtd: String(num(i.qtd) + qtd) } : i)); return; }
    const pr = (await precosDe([p]))[p.id];
    setItens((atual) => [...atual, { produto: p, qtd: String(qtd), preco: pr == null ? "" : String(moeda === "GS" ? Math.round(pr) : pr.toFixed(2).replace(".", ",")) }]);
  }
  // trocou cliente ou moeda: recalcula os preços pela tabela certa
  async function retabelar(cli: string, m: "GS" | "BRL") {
    if (!itens.length) return;
    const pr = await precosDe(itens.map((i) => i.produto), cli, m);
    setItens((atual) => atual.map((i) => ({ ...i, preco: pr[i.produto.id] == null ? "" : String(m === "GS" ? Math.round(pr[i.produto.id]!) : pr[i.produto.id]!.toFixed(2).replace(".", ",")) })));
  }
  const total = itens.reduce((s, i) => s + num(i.qtd) * num(i.preco), 0);

  function finalizar() {
    setR({});
    iniciar(async () => {
      const res = await finalizarVenda({ caixa, cliente: cliente || null, moeda, obs,
        itens: itens.map((i) => ({ produto_id: i.produto.id, quantidade: num(i.qtd), preco: num(i.preco) || null })),
        pagamentos: paraEnvio(pags) });
      setR(res);
      if (!res.erro) { setItens([]); setPags([{ modalidade: "efetivo", valor: "" }]); setObs(""); setCliente(""); router.refresh(); }
    });
  }

  return (
    <section className="painel pdv">
      <div className="linha entre"><h2 style={{ margin: 0 }}>Nova venda</h2>
        <div className="linha">
          <select value={cliente} onChange={(e) => { const c = e.target.value; setCliente(c); const m = clientes.find((x) => x.id === c)?.moeda ?? moeda; setMoeda(m); retabelar(c, m); }} aria-label="Cliente">
            <option value="">Cliente avulso (balcão)</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <select value={moeda} onChange={(e) => { const m = e.target.value as "GS" | "BRL"; setMoeda(m); retabelar(cliente, m); }} aria-label="Moeda">
            <option value="GS">Guaranis</option><option value="BRL">Reais</option>
          </select>
        </div>
      </div>
      <div className="pdv-busca">
        <input ref={campo} value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus placeholder="Bipe o código de barras ou digite o nome / código do produto"
               onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const exato = produtos.find((p) => p.gtin === busca.trim() || p.codigo.toLowerCase() === busca.trim().toLowerCase()); const alvo = exato ?? (achados.length === 1 ? achados[0] : null); if (alvo) adicionar(alvo); } }} />
        {achados.length > 0 && (
          <ul className="pdv-achados">{achados.map((p) => (
            <li key={p.id}><button type="button" onClick={() => adicionar(p)}>
              <span>{p.nome}<small>{p.codigo}{p.caixa ? ` · caixa ${p.caixa}` : ""}</small></span>
              <span className={p.saldo > 0 ? "suave" : "texto-erro"}>estoque {p.saldo}</span>
            </button>
            {p.caixa ? <button type="button" className="discreto" onClick={() => adicionar(p, p.caixa!)}>+ caixa</button> : null}</li>
          ))}</ul>
        )}
      </div>
      {itens.length > 0 && (
        <div className="tabela"><table data-sem-filtro>
          <thead><tr><th>Produto</th><th className="num">Qtd (un.)</th><th className="num">Preço un.</th><th className="num">Total</th><th></th></tr></thead>
          <tbody>{itens.map((i, k) => (
            <tr key={i.produto.id}>
              <td>{i.produto.nome}<div className="pequeno suave">{i.produto.codigo} · estoque {i.produto.saldo}{num(i.qtd) > i.produto.saldo ? <b className="texto-erro"> · falta estoque</b> : null}</div></td>
              <td className="num"><input value={i.qtd} inputMode="numeric" style={{ width: 70 }} onChange={(e) => setItens(itens.map((x, j) => j === k ? { ...x, qtd: e.target.value } : x))} /></td>
              <td className="num"><input value={i.preco} inputMode="decimal" style={{ width: 110 }} placeholder="preço" onChange={(e) => setItens(itens.map((x, j) => j === k ? { ...x, preco: e.target.value } : x))} /></td>
              <td className="num">{fmt(num(i.qtd) * num(i.preco), moeda)}</td>
              <td><button type="button" className="discreto" onClick={() => setItens(itens.filter((_, j) => j !== k))} aria-label="Tirar">×</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="pdv-rodape">
        <div className="pdv-total">Total <b>{fmt(total, moeda)}</b></div>
        <Pagamentos total={total} moeda={moeda} linhas={pags} setLinhas={setPags} contas={contas} />
        <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional)" />
        <button type="button" className="principal" disabled={enviando || !itens.length} onClick={finalizar}>{enviando ? "Registrando…" : `Finalizar venda · ${fmt(total, moeda)}`}</button>
        <Aviso r={r} />
      </div>
    </section>
  );
}

/** Pedido que chegou do cliente (site ou vendedora): lança o pagamento no caixa e, se for retirar agora, entrega e baixa o estoque. */
export function ReceberPedido({ caixa, pedidos, contas }: { caixa: string; pedidos: PedidoReceber[]; contas: ContaBancaria[] }) {
  const router = useRouter();
  const [id, setId] = useState("");
  const [pags, setPags] = useState<LinhaPag[]>([{ modalidade: "efetivo", valor: "" }]);
  const [entregar, setEntregar] = useState(true);
  const [r, setR] = useState<Resultado>({});
  const [enviando, iniciar] = useTransition();
  const p = pedidos.find((x) => x.id === id);
  useEffect(() => { if (p) setPags([{ modalidade: "efetivo", valor: p.falta > 0 ? String(p.moeda === "GS" ? Math.round(p.falta) : p.falta.toFixed(2).replace(".", ",")) : "" }]); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="painel">
      <h2 style={{ margin: 0 }}>Receber pedido de cliente</h2>
      <p className="suave pequeno" style={{ margin: 0 }}>Pedido feito pelo site ou pela vendedora: lance o pagamento no caixa. Se o cliente leva agora, marque entregar: o estoque é baixado.</p>
      {pedidos.length === 0 ? <div className="vazio">Nenhum pedido desta unidade esperando pagamento ou retirada.</div> : (
        <>
          <select value={id} onChange={(e) => setId(e.target.value)} aria-label="Pedido">
            <option value="">Escolha o pedido…</option>
            {pedidos.map((x) => <option key={x.id} value={x.id}>{x.rotulo}</option>)}
          </select>
          {p && (
            <>
              <Pagamentos total={p.falta} moeda={p.moeda} linhas={pags} setLinhas={setPags} contas={contas} />
              {!["entregue"].includes(p.status) && (
                <label className="linha" style={{ flexDirection: "row", gap: 8, color: "inherit" }}>
                  <input type="checkbox" checked={entregar} onChange={(e) => setEntregar(e.target.checked)} /> Cliente leva agora: entregar e baixar do estoque
                </label>
              )}
              <button type="button" className="principal" disabled={enviando} onClick={() => {
                setR({});
                iniciar(async () => {
                  const res = await receberPedido({ caixa, pedido: p.id, entregar: entregar && p.status !== "entregue", pagamentos: paraEnvio(pags) });
                  setR(res); if (!res.erro) { setId(""); router.refresh(); }
                });
              }}>{enviando ? "Lançando…" : "Lançar no caixa"}</button>
            </>
          )}
        </>
      )}
      <Aviso r={r} />
    </section>
  );
}

export function AbrirCaixa({ deposito }: { deposito: string }) {
  const [r, acao, enviando] = useActionState(abrirCaixa, {});
  return (
    <form action={acao} className="painel">
      <h2 style={{ margin: 0 }}>Abrir o caixa</h2>
      <p className="suave pequeno" style={{ margin: 0 }}>Conte o dinheiro de troco que está na gaveta antes de começar.</p>
      <input type="hidden" name="deposito_id" value={deposito} />
      <div className="campos">
        <label>Troco em guaranis<input name="fundo_gs" inputMode="numeric" placeholder="0" /></label>
        <label>Troco em reais<input name="fundo_brl" inputMode="decimal" placeholder="0" /></label>
      </div>
      <button className="principal" disabled={enviando}>{enviando ? "Abrindo…" : "Abrir caixa"}</button>
      <Aviso r={r} />
    </form>
  );
}

export function MovimentoCaixa({ caixa, contas, categorias }: { caixa: string; contas: ContaBancaria[]; categorias: { codigo: string; nome: string }[] }) {
  const [r, acao, enviando] = useActionState(movimentoCaixa, {});
  const [tipo, setTipo] = useState("sangria");
  const [destino, setDestino] = useState("cofre");
  return (
    <form action={acao} className="painel">
      <h2 style={{ margin: 0 }}>Entrada ou saída de dinheiro</h2>
      <input type="hidden" name="caixa_id" value={caixa} />
      <div className="campos">
        <label>O que é
          <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="sangria">Retirada: transferência ao cofre ou banco</option>
            <option value="despesa">Despesa paga com o caixa</option>
            <option value="reforco">Reforço de troco (entrada)</option>
          </select>
        </label>
        {tipo === "sangria" && (
          <label>Para onde
            <select name="destino" value={destino} onChange={(e) => setDestino(e.target.value)}>
              <option value="cofre">Cofre</option><option value="banco">Depósito no banco</option><option value="outro">Outro</option>
            </select>
          </label>
        )}
        {tipo === "sangria" && destino === "banco" && contas.length > 0 && (
          <label>Conta<select name="conta">{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
        )}
        {tipo === "despesa" && (
          <label>Categoria<select name="categoria" defaultValue="outros">{categorias.map((c) => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)}</select></label>
        )}
        <label>Moeda<select name="moeda" defaultValue="GS"><option value="GS">Guaranis</option><option value="BRL">Reais</option></select></label>
        <label>Valor<input name="valor" inputMode="decimal" required /></label>
        <label className="largo">{tipo === "despesa" ? "O que foi pago" : "Observação"}<input name="descricao" required={tipo === "despesa" || destino === "outro"}
          placeholder={tipo === "despesa" ? "Ex.: limpeza, sacolas, frete do passeiro" : "Opcional"} /></label>
      </div>
      {tipo === "despesa" && <small className="suave">A despesa entra no Contas a pagar da unidade, já paga.</small>}
      <button disabled={enviando}>{enviando ? "Lançando…" : "Lançar"}</button>
      <Aviso r={r} />
    </form>
  );
}

export function FecharCaixa({ caixa, esperadoGs, esperadoBrl }: { caixa: string; esperadoGs: number; esperadoBrl: number }) {
  const [r, acao, enviando] = useActionState(fecharCaixa, {});
  const [gs, setGs] = useState(""); const [brl, setBrl] = useState("");
  const dg = gs ? num(gs) - esperadoGs : 0, db = brl ? num(brl) - esperadoBrl : 0;
  return (
    <form action={acao} className="painel fechar-caixa">
      <h2 style={{ margin: 0 }}>Fechar o caixa</h2>
      <p className="suave pequeno" style={{ margin: 0 }}>Conte o dinheiro em espécie da gaveta. Pix, cartão e transferência não entram na contagem: aparecem no resumo.</p>
      <input type="hidden" name="caixa_id" value={caixa} />
      <div className="campos">
        <label>Guaranis contados<input name="contado_gs" inputMode="numeric" value={gs} onChange={(e) => setGs(e.target.value)} required />
          <small>Esperado: {fmt(esperadoGs, "GS")}{gs && Math.abs(dg) > 0.009 ? <b className="texto-erro"> · diferença {fmt(dg, "GS")}</b> : null}</small></label>
        <label>Reais contados<input name="contado_brl" inputMode="decimal" value={brl} onChange={(e) => setBrl(e.target.value)} required />
          <small>Esperado: {fmt(esperadoBrl, "BRL")}{brl && Math.abs(db) > 0.009 ? <b className="texto-erro"> · diferença {fmt(db, "BRL")}</b> : null}</small></label>
        <label className="largo">Observação (obrigatória se houver diferença)<input name="observacao" /></label>
      </div>
      <button className="principal" disabled={enviando} onClick={(e) => { if (!window.confirm("Fechar o caixa? Depois de fechado não dá para lançar mais nada nele.")) e.preventDefault(); }}>{enviando ? "Fechando…" : "Fechar caixa"}</button>
      <Aviso r={r} />
    </form>
  );
}
