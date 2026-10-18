"use client";

import { createContext, useActionState, useContext, useEffect, useMemo, useRef, useState } from "react";
import { enviarCarrinho, guardarCarrinho, itensParaRepetir, sugestoesCompreJunto, type RespostaCarrinho, type Sugestao } from "./acoes";
import type { TextosCarrinho } from "@/lib/idioma";

/** qtd = caixas fechadas quando o produto tem "caixa" (peças por caixa); senão, unidades. preco = por unidade. */
export type ItemCarrinho = { id: string; produto?: string; marcaDb?: string | null; nome: string; marca: string | null; preco: number | null; qtd: number; limite?: number | null; caixa?: number | null; encomenda?: boolean };
export type ClienteCarrinho = { nome: string; vendedora: string; moeda: "GS" | "BRL" } | null;
export type DescontoQtd = { marca: string | null; min_qtd: number; desconto_pct: number; pais: "BR" | "PY" | null };

/** Id anônimo do navegador (só para contar visitas e carrinhos no funil de vendas). */
function sessaoAnonima(): string | null {
  try {
    let s = localStorage.getItem("vc_sid");
    if (!s) { s = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^a-z0-9-]/gi, ""); localStorage.setItem("vc_sid", s); }
    return s;
  } catch { return null; }
}
export function eventoSite(tipo: "visita" | "carrinho", dados: { produto?: string; unidade?: string } = {}) {
  const sessao = sessaoAnonima();
  if (!sessao) return;
  const corpo = JSON.stringify({ tipo, sessao, ...dados });
  try { if (!navigator.sendBeacon?.("/loja/evento", new Blob([corpo], { type: "application/json" }))) fetch("/loja/evento", { method: "POST", body: corpo, headers: { "content-type": "application/json" }, keepalive: true }); }
  catch { /* opcional */ }
}
const chaveMarca = (m: string | null | undefined) => (m ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toUpperCase();

type Ctx = {
  t: TextosCarrinho;
  descontos: DescontoQtd[];
  itens: ItemCarrinho[];
  aberto: boolean;
  abrir: (v: boolean) => void;
  definir: (item: Omit<ItemCarrinho, "qtd">, qtd: number) => void;
  limpar: () => void;
};

const Contexto = createContext<Ctx | null>(null);
const CHAVE = "vc_carrinho_v1";
/** Cada unidade (site principal, CDE) tem o próprio carrinho no navegador. */
const chaveDe = (unidade: string) => unidade === "cd-foz" ? CHAVE : `${CHAVE}_${unidade}`;
/** Id do produto: na loja que vende unidade e caixa, o mesmo produto pode estar duas vezes (":un" = unidade). */
export const produtoDe = (i: { id: string; produto?: string }) => i.produto ?? i.id;

function ler(chave: string): ItemCarrinho[] {
  try {
    const v = JSON.parse(localStorage.getItem(chave) ?? "[]");
    return Array.isArray(v) ? v.filter((i) => i && typeof i.id === "string" && i.qtd > 0) : [];
  } catch {
    return [];
  }
}

export function Carrinho({ children, cliente, t, unidade, descontos = [] }: { children: React.ReactNode; cliente: ClienteCarrinho; t: TextosCarrinho; unidade: string; descontos?: DescontoQtd[] }) {
  const CHAVE_UNIDADE = chaveDe(unidade);
  // uma visita por sessão do navegador
  useEffect(() => { try { if (!sessionStorage.getItem("vc_visita")) { sessionStorage.setItem("vc_visita", "1"); eventoSite("visita", { unidade }); } } catch { /* opcional */ } }, [unidade]);
  const [itens, setItens] = useState<ItemCarrinho[]>([]);
  const [aberto, abrir] = useState(false);
  const carregado = useRef(false);
  useEffect(() => { setItens(ler(CHAVE_UNIDADE)); carregado.current = true; }, [CHAVE_UNIDADE]);
  useEffect(() => {
    if (!carregado.current) return;
    try { localStorage.setItem(CHAVE_UNIDADE, JSON.stringify(itens)); } catch { /* navegação privada: o carrinho vale só nesta página */ }
  }, [itens, CHAVE_UNIDADE]);
  // cliente logado: o carrinho também fica guardado no sistema (a vendedora vê os carrinhos parados)
  useEffect(() => {
    if (!cliente || !carregado.current) return;
    const t = setTimeout(() => {
      guardarCarrinho(itens.map((i) => ({ produto_id: produtoDe(i), qtd: i.qtd * (i.caixa || 1) }))).catch(() => undefined);
    }, 2500);
    return () => clearTimeout(t);
  }, [itens, cliente]);
  useEffect(() => {
    document.body.style.overflow = aberto ? "hidden" : "";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && abrir(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberto]);

  const valor = useMemo<Ctx>(() => ({
    t, descontos, itens, aberto, abrir,
    definir: (item, qtd) => setItens((atual) => {
      const maxCaixas = item.limite ? Math.floor(item.limite / (item.caixa || 1)) || 1 : 9999;
      const q = Math.max(0, Math.min(Math.floor(qtd), maxCaixas));
      const resto = atual.filter((i) => i.id !== item.id);
      if (q === 0) return resto;
      const existente = atual.find((i) => i.id === item.id);
      if (!existente) eventoSite("carrinho", { produto: produtoDe(item), unidade });
      return existente ? atual.map((i) => (i.id === item.id ? { ...i, ...item, qtd: q } : i)) : [...atual, { ...item, qtd: q }];
    }),
    limpar: () => setItens([]),
  }), [itens, aberto, t, descontos, unidade]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      <Gaveta cliente={cliente} />
    </Contexto.Provider>
  );
}

function useCarrinho() {
  const c = useContext(Contexto);
  if (!c) throw new Error("Carrinho fora do provedor");
  return c;
}

export function BotaoCarrinho() {
  const { itens, abrir, t } = useCarrinho();
  const n = itens.reduce((s, i) => s + i.qtd, 0);
  return (
    <button type="button" className="sacola" onClick={() => abrir(true)} aria-label={t.abrirPedido.replace("9999", String(n))}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
      <span>{t.pedido}</span>
      {n > 0 && <b className="sacola-n">{n}</b>}
    </button>
  );
}

export function Quantidade({ item, rotulo }: { item: Omit<ItemCarrinho, "qtd">; rotulo?: string }) {
  const { itens, definir, t } = useCarrinho();
  const qtd = itens.find((i) => i.id === item.id)?.qtd ?? 0;
  if (qtd === 0) {
    return <button type="button" className="adicionar" onClick={() => definir(item, 1)}>{rotulo ?? t.adicionar}</button>;
  }
  return (
    <div className="passo" role="group" aria-label={`${t.quantidade}: ${item.nome}`}>
      <button type="button" onClick={() => definir(item, qtd - 1)} aria-label={t.diminuir}>−</button>
      <input inputMode="numeric" value={item.caixa ? `${qtd} ${t.cx}` : qtd} aria-label={t.quantidade}
             onChange={(e) => definir(item, Number(e.target.value.replace(/\D/g, "")) || 0)} />
      <button type="button" onClick={() => definir(item, qtd + 1)} aria-label={t.aumentar} disabled={item.limite != null && qtd >= item.limite}>+</button>
    </div>
  );
}

const fmt = (v: number, moeda: "GS" | "BRL") =>
  moeda === "GS" ? `Gs ${Math.round(v).toLocaleString("es-PY")}` : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Gaveta({ cliente }: { cliente: ClienteCarrinho }) {
  const { itens, aberto, abrir, definir, limpar, t, descontos } = useCarrinho();
  const [estado, acao, enviando] = useActionState<RespostaCarrinho, FormData>(enviarCarrinho, {});
  useEffect(() => {
    if (estado.url) {
      limpar();
      abrir(false);
      window.location.href = estado.url;
    }
  }, [estado]); // eslint-disable-line react-hooks/exhaustive-deps

  const un = (i: ItemCarrinho) => i.qtd * (i.caixa || 1);
  const total = cliente ? itens.reduce((s, i) => s + (i.preco ?? 0) * un(i), 0) : 0;
  const semPreco = cliente ? itens.filter((i) => i.preco == null).length : 0;
  const payload = JSON.stringify(itens.map((i) => ({ produto_id: produtoDe(i), quantidade: un(i), caixas: i.caixa ? i.qtd : null, encomenda: !!i.encomenda })));
  const progresso = progressoDescontos(itens, descontos, cliente?.moeda === "BRL" ? "BR" : cliente?.moeda === "GS" ? "PY" : null);

  return (
    <div className={`gaveta ${aberto ? "aberta" : ""}`} aria-hidden={!aberto}>
      <div className="gaveta-fundo" onClick={() => abrir(false)} />
      <aside className="gaveta-painel" role="dialog" aria-modal="true" aria-label={t.seuPedido}>
        <header className="gaveta-topo">
          <h2>{t.seuPedido}</h2>
          <button type="button" className="fechar" onClick={() => abrir(false)} aria-label={t.fechar}>×</button>
        </header>

        {itens.length === 0 ? (
          <p className="gaveta-vazia">{t.vazio}</p>
        ) : (
          <>
            <ul className="gaveta-lista">
              {itens.map((i) => (
                <li key={i.id}>
                  <div>
                    <div className="g-nome">{i.nome}</div>
                    {i.encomenda && <div className="g-encomenda">{t.itemEncomenda}</div>}
                    {i.caixa ? <div className="g-caixa">{t.caixas.replace("9999", String(i.qtd))} · {un(i)} {t.un}</div> : null}
                    {cliente && <div className="g-preco">{i.preco != null ? fmt(i.preco * un(i), cliente.moeda) : t.precoConfirmar}</div>}
                  </div>
                  <div className="passo">
                    <button type="button" onClick={() => definir(i, i.qtd - 1)} aria-label={`${t.diminuir}: ${i.nome}`}>−</button>
                    <input inputMode="numeric" value={i.qtd} aria-label={`${t.quantidade}: ${i.nome}`}
                           onChange={(e) => definir(i, Number(e.target.value.replace(/\D/g, "")) || 0)} />
                    <button type="button" onClick={() => definir(i, i.qtd + 1)} aria-label={`${t.aumentar}: ${i.nome}`}>+</button>
                  </div>
                </li>
              ))}
            </ul>

            {progresso.length > 0 && (
              <ul className="g-descontos">{progresso.map((p) => (
                <li key={p.marca} className={p.atingido ? "ok" : ""}>
                  {p.atingido
                    ? <>✓ Seu pedido de {p.nomeMarca} pode ganhar <b>{p.atingido}% de desconto</b> por quantidade{p.proximo ? ` · leve mais ${p.faltam} para ${p.proximo}%` : ""}</>
                    : <>Leve mais <b>{p.faltam}</b> {p.faltam === 1 ? "caixa" : "caixas"} de {p.nomeMarca} e o pedido pode ganhar <b>{p.proximo}% de desconto</b></>}
                </li>
              ))}<li className="g-descontos-nota">Desconto sujeito à liberação do gerente ao confirmar o pedido.</li></ul>
            )}
            <CompreJunto itens={itens} cliente={cliente} definir={definir} />
            <form action={acao} className="gaveta-envio">
              <input type="hidden" name="itens" value={payload} />
              {cliente ? (
                <>
                  <div className="g-total"><span>{t.total}</span><b>{fmt(total, cliente.moeda)}</b></div>
                  {semPreco > 0 && <p className="g-nota">{t.semPrecoTabela.replace("9999", String(semPreco))}</p>}
                  <label>{t.observacao}<input name="observacao" placeholder={t.obsExemplo} maxLength={500} /></label>
                  <p className="g-nota">{t.confere}</p>
                </>
              ) : (
                <>
                  <p className="g-nota">{t.naoCliente}</p>
                  <label>{t.seuNome}<input name="nome" required maxLength={120} autoComplete="name" /></label>
                  <label>{t.whatsapp}<input name="whatsapp" required inputMode="tel" autoComplete="tel" /></label>
                  <label>{t.cidade}<input name="cidade" maxLength={120} autoComplete="address-level2" /></label>
                  <label>{t.observacao}<input name="observacao" maxLength={500} /></label>
                </>
              )}
              {estado.erro && <div className="g-erro" role="alert">{estado.erro}</div>}
              {estado.alternativa && (
                <a className="g-zap" href={estado.alternativa} target="_blank" rel="noopener noreferrer">{t.mandarZap}</a>
              )}
              <button className="enviar" disabled={enviando}>
                {enviando ? t.enviando : cliente ? t.enviarPara : t.enviarZap}
              </button>
            </form>
          </>
        )}
      </aside>
    </div>
  );
}

/** Esvazia o carrinho depois que o pedido foi registrado. */
export function LimparCarrinho() {
  const { limpar } = useCarrinho();
  useEffect(() => limpar(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** "Pedir de novo": coloca no carrinho os itens de um pedido antigo, com o preço de hoje. */
export function RepetirPedido({ pedidoId, rotulo, vazio }: { pedidoId: string; rotulo: string; vazio: string }) {
  const { definir, abrir } = useCarrinho();
  const [estado, setEstado] = useState<"" | "carregando" | "vazio">("");
  return (
    <button type="button" className="botao-repetir" disabled={estado === "carregando"} onClick={async () => {
      setEstado("carregando");
      const itens = await itensParaRepetir(pedidoId).catch(() => []);
      if (!itens.length) { setEstado("vazio"); return; }
      for (const { qtd, ...item } of itens) definir(item, qtd);
      setEstado("");
      abrir(true);
    }}>
      {estado === "vazio" ? vazio : estado === "carregando" ? "…" : rotulo}
    </button>
  );
}


/** Para cada marca do carrinho: desconto já atingido e quanto falta para a próxima faixa. */
function progressoDescontos(itens: ItemCarrinho[], regras: DescontoQtd[], pais: "BR" | "PY" | null) {
  if (!regras.length) return [];
  const porMarca = new Map<string, { nome: string; qtd: number }>();
  for (const i of itens) {
    const k = chaveMarca(i.marcaDb ?? i.marca);
    if (!k) continue;
    const m = porMarca.get(k) ?? { nome: i.marca ?? i.marcaDb ?? "", qtd: 0 };
    m.qtd += i.qtd;
    porMarca.set(k, m);
  }
  const saida: { marca: string; nomeMarca: string; atingido: number | null; proximo: number | null; faltam: number }[] = [];
  for (const [k, m] of porMarca) {
    const aplica = regras.filter((r) => (!r.marca || chaveMarca(r.marca) === k) && (!r.pais || !pais || r.pais === pais)).sort((a, b) => a.min_qtd - b.min_qtd);
    if (!aplica.length) continue;
    const feitas = aplica.filter((r) => m.qtd >= r.min_qtd);
    const atingido = feitas.length ? Math.max(...feitas.map((r) => Number(r.desconto_pct))) : null;
    const prox = aplica.find((r) => m.qtd < r.min_qtd && Number(r.desconto_pct) > (atingido ?? 0));
    if (!atingido && !prox) continue;
    saida.push({ marca: k, nomeMarca: m.nome, atingido, proximo: prox ? Number(prox.desconto_pct) : null, faltam: prox ? prox.min_qtd - m.qtd : 0 });
  }
  return saida;
}

/** "Compre junto": até 4 sugestões a partir do carrinho. */
function CompreJunto({ itens, cliente, definir }: { itens: ItemCarrinho[]; cliente: ClienteCarrinho; definir: Ctx["definir"] }) {
  const [sug, setSug] = useState<Sugestao[]>([]);
  const ids = itens.map(produtoDe).sort().join(",");
  useEffect(() => {
    if (!ids) { setSug([]); return; }
    const t = setTimeout(() => { sugestoesCompreJunto(ids.split(",")).then((s) => setSug(s.filter((x) => !ids.includes(x.id)))).catch(() => setSug([])); }, 600);
    return () => clearTimeout(t);
  }, [ids]);
  if (!sug.length) return null;
  return (
    <div className="g-junto">
      <div className="g-junto-titulo">Compre junto</div>
      <ul>{sug.map((s) => (
        <li key={s.id}>
          {s.foto ? <img src={s.foto} alt="" width={40} height={40} loading="lazy" /> : <span className="g-junto-img" />}
          <div><div className="g-nome">{s.nome}</div>
            {cliente && s.preco != null && <div className="g-preco">{fmt(s.preco * (s.caixa || 1), cliente.moeda)}{s.caixa ? " / cx" : ""}</div>}</div>
          <button type="button" onClick={() => definir({ id: s.id, nome: s.nome, marca: s.marca, marcaDb: s.marca, preco: s.preco, caixa: s.caixa }, 1)}>+</button>
        </li>
      ))}</ul>
    </div>
  );
}

/** Coloca vários itens no carrinho de uma vez (lista de reposição) e abre o pedido. */
export function AdicionarTodos({ itens, rotulo }: { itens: ItemCarrinho[]; rotulo: string }) {
  const { definir, abrir } = useCarrinho();
  return (
    <button type="button" className="botao-repetir" onClick={() => { for (const { qtd, ...item } of itens) definir(item, qtd); abrir(true); }}>{rotulo}</button>
  );
}
