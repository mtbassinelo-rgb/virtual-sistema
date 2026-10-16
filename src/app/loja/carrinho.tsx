"use client";

import { createContext, useActionState, useContext, useEffect, useMemo, useState } from "react";
import { enviarCarrinho, type RespostaCarrinho } from "./acoes";

export type ItemCarrinho = { id: string; nome: string; marca: string | null; preco: number | null; qtd: number; limite?: number | null };
export type ClienteCarrinho = { nome: string; vendedora: string; moeda: "GS" | "BRL" } | null;

type Ctx = {
  itens: ItemCarrinho[];
  aberto: boolean;
  abrir: (v: boolean) => void;
  definir: (item: Omit<ItemCarrinho, "qtd">, qtd: number) => void;
  limpar: () => void;
};

const Contexto = createContext<Ctx | null>(null);
const CHAVE = "vc_carrinho_v1";

function ler(): ItemCarrinho[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? "[]");
    return Array.isArray(v) ? v.filter((i) => i && typeof i.id === "string" && i.qtd > 0) : [];
  } catch {
    return [];
  }
}

export function Carrinho({ children, cliente }: { children: React.ReactNode; cliente: ClienteCarrinho }) {
  const [itens, setItens] = useState<ItemCarrinho[]>([]);
  const [aberto, abrir] = useState(false);
  useEffect(() => setItens(ler()), []);
  useEffect(() => {
    try { localStorage.setItem(CHAVE, JSON.stringify(itens)); } catch { /* navegação privada: o carrinho vale só nesta página */ }
  }, [itens]);
  useEffect(() => {
    document.body.style.overflow = aberto ? "hidden" : "";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && abrir(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberto]);

  const valor = useMemo<Ctx>(() => ({
    itens, aberto, abrir,
    definir: (item, qtd) => setItens((atual) => {
      const q = Math.max(0, Math.min(Math.floor(qtd), item.limite ?? 9999));
      const resto = atual.filter((i) => i.id !== item.id);
      if (q === 0) return resto;
      const existente = atual.find((i) => i.id === item.id);
      return existente ? atual.map((i) => (i.id === item.id ? { ...i, ...item, qtd: q } : i)) : [...atual, { ...item, qtd: q }];
    }),
    limpar: () => setItens([]),
  }), [itens, aberto]);

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
  const { itens, abrir } = useCarrinho();
  const n = itens.reduce((s, i) => s + i.qtd, 0);
  return (
    <button type="button" className="sacola" onClick={() => abrir(true)} aria-label={`Abrir pedido (${n} itens)`}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
      <span>Pedido</span>
      {n > 0 && <b className="sacola-n">{n}</b>}
    </button>
  );
}

export function Quantidade({ item, rotulo }: { item: Omit<ItemCarrinho, "qtd">; rotulo?: string }) {
  const { itens, definir } = useCarrinho();
  const qtd = itens.find((i) => i.id === item.id)?.qtd ?? 0;
  if (qtd === 0) {
    return <button type="button" className="adicionar" onClick={() => definir(item, 1)}>{rotulo ?? "Adicionar"}</button>;
  }
  return (
    <div className="passo" role="group" aria-label={`Quantidade de ${item.nome}`}>
      <button type="button" onClick={() => definir(item, qtd - 1)} aria-label="Diminuir">−</button>
      <input inputMode="numeric" value={qtd} aria-label="Quantidade"
             onChange={(e) => definir(item, Number(e.target.value.replace(/\D/g, "")) || 0)} />
      <button type="button" onClick={() => definir(item, qtd + 1)} aria-label="Aumentar" disabled={item.limite != null && qtd >= item.limite}>+</button>
    </div>
  );
}

const fmt = (v: number, moeda: "GS" | "BRL") =>
  moeda === "GS" ? `Gs ${Math.round(v).toLocaleString("es-PY")}` : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Gaveta({ cliente }: { cliente: ClienteCarrinho }) {
  const { itens, aberto, abrir, definir, limpar } = useCarrinho();
  const [estado, acao, enviando] = useActionState<RespostaCarrinho, FormData>(enviarCarrinho, {});
  useEffect(() => {
    if (estado.url) {
      limpar();
      abrir(false);
      window.location.href = estado.url;
    }
  }, [estado]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = cliente ? itens.reduce((s, i) => s + (i.preco ?? 0) * i.qtd, 0) : 0;
  const semPreco = cliente ? itens.filter((i) => i.preco == null).length : 0;
  const payload = JSON.stringify(itens.map((i) => ({ produto_id: i.id, quantidade: i.qtd })));

  return (
    <div className={`gaveta ${aberto ? "aberta" : ""}`} aria-hidden={!aberto}>
      <div className="gaveta-fundo" onClick={() => abrir(false)} />
      <aside className="gaveta-painel" role="dialog" aria-modal="true" aria-label="Seu pedido">
        <header className="gaveta-topo">
          <h2>Seu pedido</h2>
          <button type="button" className="fechar" onClick={() => abrir(false)} aria-label="Fechar">×</button>
        </header>

        {itens.length === 0 ? (
          <p className="gaveta-vazia">Escolha os produtos e as quantidades no catálogo. Eles aparecem aqui.</p>
        ) : (
          <>
            <ul className="gaveta-lista">
              {itens.map((i) => (
                <li key={i.id}>
                  <div>
                    <div className="g-nome">{i.nome}</div>
                    {cliente && <div className="g-preco">{i.preco != null ? fmt(i.preco * i.qtd, cliente.moeda) : "Preço a confirmar"}</div>}
                  </div>
                  <div className="passo">
                    <button type="button" onClick={() => definir(i, i.qtd - 1)} aria-label={`Diminuir ${i.nome}`}>−</button>
                    <input inputMode="numeric" value={i.qtd} aria-label={`Quantidade de ${i.nome}`}
                           onChange={(e) => definir(i, Number(e.target.value.replace(/\D/g, "")) || 0)} />
                    <button type="button" onClick={() => definir(i, i.qtd + 1)} aria-label={`Aumentar ${i.nome}`}>+</button>
                  </div>
                </li>
              ))}
            </ul>

            <form action={acao} className="gaveta-envio">
              <input type="hidden" name="itens" value={payload} />
              {cliente ? (
                <>
                  <div className="g-total"><span>Total</span><b>{fmt(total, cliente.moeda)}</b></div>
                  {semPreco > 0 && <p className="g-nota">{semPreco} produto(s) sem preço na sua tabela: a vendedora confirma o valor.</p>}
                  <label>Observação<input name="observacao" placeholder="Ex.: entregar na sexta" maxLength={500} /></label>
                  <p className="g-nota">{cliente.vendedora} confere o estoque, confirma o total e manda os dados para pagamento.</p>
                </>
              ) : (
                <>
                  <p className="g-nota">Ainda não é cliente? Mande o pedido e uma vendedora responde no WhatsApp com os preços de atacado.</p>
                  <label>Seu nome ou do salão<input name="nome" required maxLength={120} autoComplete="name" /></label>
                  <label>WhatsApp com DDD<input name="whatsapp" required inputMode="tel" autoComplete="tel" placeholder="+55 45 99999-0000" /></label>
                  <fieldset className="g-pais">
                    <legend>Onde você compra</legend>
                    <label><input type="radio" name="pais" value="BR" defaultChecked /> Brasil (R$)</label>
                    <label><input type="radio" name="pais" value="PY" /> Paraguai (Gs)</label>
                  </fieldset>
                  <label>Cidade<input name="cidade" maxLength={120} autoComplete="address-level2" /></label>
                  <label>Observação<input name="observacao" maxLength={500} /></label>
                </>
              )}
              {estado.erro && <div className="g-erro" role="alert">{estado.erro}</div>}
              {estado.alternativa && (
                <a className="g-zap" href={estado.alternativa} target="_blank" rel="noopener noreferrer">Mandar este pedido pelo WhatsApp</a>
              )}
              <button className="enviar" disabled={enviando}>
                {enviando ? "Enviando…" : cliente ? `Enviar pedido para ${cliente.vendedora}` : "Enviar pedido pelo WhatsApp"}
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
