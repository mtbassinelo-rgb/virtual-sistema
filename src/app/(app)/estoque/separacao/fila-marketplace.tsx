"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CartaoFila } from "@/lib/marketplace-fila";
import { confirmarDevolucaoMarketplace, marcarSeparadoMarketplace } from "./acoes-marketplace";

type Evento = { evento: "novo" | "atualizado" | "cancelado" | "separado"; pedido: CartaoFila };
type Aviso = { id: number; texto: string; tipo: "novo" | "cancelado" };

const COR: Record<string, string> = { shopee: "#ee4d2d", mercado_livre: "#2d3277" };
const hora = (d: string) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Dois bipes curtos (novo pedido) ou um grave (cancelado), sem arquivo de som. */
function bipar(ctx: AudioContext | null, tipo: "novo" | "cancelado") {
  if (!ctx) return;
  const notas = tipo === "novo" ? [[880, 0], [1320, 0.18]] : [[330, 0], [220, 0.25]];
  for (const [freq, ini] of notas) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + ini);
    g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + ini + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ini + 0.16);
    o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + ini); o.stop(ctx.currentTime + ini + 0.2);
  }
}

export function FilaMarketplace({ inicial, deposito }: { inicial: CartaoFila[]; deposito: string | null }) {
  const router = useRouter();
  const [lista, setLista] = useState<CartaoFila[]>(inicial);
  const [conexao, setConexao] = useState<"conectando" | "ao_vivo" | "caiu">("conectando");
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [destaque, setDestaque] = useState<Set<number>>(new Set());
  const [som, setSom] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, comecar] = useTransition();
  const audio = useRef<AudioContext | null>(null);
  const somRef = useRef(false);
  somRef.current = som;
  const listaRef = useRef(lista);
  listaRef.current = lista;

  // a página recarregou (router.refresh): a lista do servidor é a verdade
  useEffect(() => { setLista(inicial); }, [inicial]);

  useEffect(() => {
    let quer = false;
    try { quer = localStorage.getItem("vc-som-fila") === "1"; } catch { /* sem armazenamento */ }
    if (!quer) return;
    setSom(true);
    // o navegador só toca som depois de um clique na página: o primeiro clique libera
    const liberar = () => { audio.current ??= new AudioContext(); audio.current.resume().catch(() => undefined); };
    window.addEventListener("pointerdown", liberar, { once: true });
    return () => window.removeEventListener("pointerdown", liberar);
  }, []);

  useEffect(() => {
    const abertos = lista.filter((p) => p.situacao === "a_separar").length;
    document.title = abertos ? `(${abertos}) Área do estoquista` : "Área do estoquista";
  }, [lista]);

  useEffect(() => {
    const es = new EventSource(`/api/estoque/ao-vivo${deposito ? `?deposito=${encodeURIComponent(deposito)}` : ""}`);
    let caiu = false;
    es.addEventListener("pronto", () => {
      setConexao("ao_vivo");
      if (caiu) router.refresh(); // pode ter chegado pedido enquanto a conexão estava fora
      caiu = false;
    });
    es.addEventListener("sincronizar", () => router.refresh());
    es.onerror = () => { caiu = true; setConexao("caiu"); }; // o navegador tenta de novo sozinho (retry: 3 s)
    es.addEventListener("pedido", (m) => {
      const { evento, pedido: p } = JSON.parse((m as MessageEvent).data) as Evento;
      const atual = listaRef.current;
      const tinha = atual.some((x) => x.id === p.id);
      const fica = p.situacao === "a_separar" || p.cancelado_depois_de_separar || (p.situacao === "cancelado" && tinha);
      const alerta: Aviso["tipo"] | null = evento === "cancelado" && fica ? "cancelado" : !tinha && p.situacao === "a_separar" ? "novo" : null;
      const nova = !fica ? atual.filter((x) => x.id !== p.id) : tinha ? atual.map((x) => (x.id === p.id ? p : x)) : [...atual, p];
      listaRef.current = nova;
      setLista(nova);
      if (!alerta) return;
      const texto = alerta === "novo" ? `Novo pedido ${p.canal_nome} nº ${p.numero_externo}` : `CANCELADO ${p.canal_nome} nº ${p.numero_externo}: não envie`;
      const aviso: Aviso = { id: Date.now() + Math.random(), texto, tipo: alerta };
      setAvisos((a) => [...a.slice(-3), aviso]);
      setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== aviso.id)), 8_000);
      setDestaque((d) => new Set(d).add(p.id));
      setTimeout(() => setDestaque((d) => { const n = new Set(d); n.delete(p.id); return n; }), 6_000);
      if (somRef.current) bipar(audio.current, alerta);
      if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(texto, { tag: `mk-${p.id}` });
      }
    });
    return () => es.close();
  }, [deposito, router]);

  function alternarSom() {
    const novo = !som;
    setSom(novo);
    try { localStorage.setItem("vc-som-fila", novo ? "1" : "0"); } catch { /* sem armazenamento */ }
    if (novo) {
      // o navegador só libera som depois de um clique: o contexto de áudio nasce aqui
      audio.current ??= new AudioContext();
      audio.current.resume().catch(() => undefined);
      bipar(audio.current, "novo");
      if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => undefined);
    }
  }

  const agir = (fn: () => Promise<{ erro: string | null }>, id: number, sair: boolean) => comecar(async () => {
    const r = await fn();
    setErro(r.erro);
    if (!r.erro && sair) setLista((a) => a.filter((x) => x.id !== id));
  });

  const abertos = lista.filter((p) => p.situacao === "a_separar");
  const devolver = lista.filter((p) => p.situacao === "cancelado");

  return (
    <section className="painel">
      <style>{`@keyframes vcPisca { 0%,100% { background: transparent } 30% { background: var(--marca-suave) } }
        .mk-novo { animation: vcPisca 1.2s ease-in-out 3; }
        .mk-avisos { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 50; max-width: calc(100vw - 32px); }
        .mk-aviso { padding: 12px 14px; border-radius: 10px; font-weight: 700; box-shadow: 0 6px 24px rgba(0,0,0,.18); background: var(--ok-suave); color: var(--texto); }
        .mk-aviso.cancelado { background: var(--erro-suave); }`}</style>
      <div className="linha entre" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2>Shopee e Mercado Livre <span className="pequeno suave">({abertos.length} a separar)</span></h2>
        <span className="linha" style={{ gap: 8 }}>
          <span className={`selo ${conexao === "ao_vivo" ? "ok" : conexao === "caiu" ? "erro" : ""}`}>
            {conexao === "ao_vivo" ? "● ao vivo" : conexao === "caiu" ? "reconectando…" : "conectando…"}</span>
          <button type="button" className="botao" onClick={alternarSom}>{som ? "🔔 Som ligado" : "🔕 Ligar som"}</button>
        </span>
      </div>
      {erro && <div className="aviso-caixa erro" role="alert">{erro}</div>}

      {devolver.map((p) => (
        <div key={p.id} className={`aviso-caixa erro ${destaque.has(p.id) ? "mk-novo" : ""}`} role="alert" style={{ marginBottom: 8 }}>
          <b>{p.canal_nome} nº {p.numero_externo} foi CANCELADO.</b>{" "}
          {p.cancelado_depois_de_separar ? "Já estava separado: devolva os produtos à prateleira." : "Não separe nem envie."}{" "}
          <button type="button" className="botao" disabled={pendente}
            onClick={() => p.cancelado_depois_de_separar ? agir(() => confirmarDevolucaoMarketplace(p.id), p.id, true) : setLista((a) => a.filter((x) => x.id !== p.id))}>
            {p.cancelado_depois_de_separar ? "Devolvi à prateleira" : "Entendi"}</button>
        </div>
      ))}

      {abertos.length === 0 ? <div className="vazio">Nenhum pedido da Shopee ou do Mercado Livre para separar. Os novos aparecem aqui sozinhos.</div> : (
        <div className="tabela cartoes"><table>
          <thead><tr><th>Chegou</th><th>Pedido</th><th>Itens</th><th>Status</th><th></th></tr></thead>
          <tbody>{abertos.map((p) => (
            <tr key={p.id} className={destaque.has(p.id) ? "mk-novo" : undefined}>
              <td data-rot="Chegou">{hora(p.recebido_em)}</td>
              <td className="titulo">
                <span className="selo" style={{ background: COR[p.canal] ?? undefined, color: "#fff" }}>{p.canal_nome}</span>{" "}
                nº {p.numero_externo}{p.comprador && <div className="pequeno suave">{p.comprador}</div>}
              </td>
              <td data-rot="Itens">{p.com_detalhes && p.itens.length ? (
                <ul style={{ margin: 0, paddingLeft: 16 }}>{p.itens.map((i, k) => (
                  <li key={k}><b>{Number(i.quantidade).toLocaleString("pt-BR")}×</b> {i.descricao ?? i.sku} <span className="pequeno suave">{i.sku}</span></li>))}</ul>
              ) : <span className="pequeno suave">aguardando os itens do marketplace</span>}</td>
              <td data-rot="Status">{p.status_externo ?? "—"}{p.baixa_feita && <div><span className="selo ok">baixa no estoque feita</span></div>}</td>
              <td className="acao"><button type="button" className="botao principal" disabled={pendente}
                onClick={() => agir(() => marcarSeparadoMarketplace(p.id), p.id, true)}>Separado</button></td>
            </tr>))}</tbody>
        </table></div>
      )}

      <div className="mk-avisos" aria-live="assertive">
        {avisos.map((a) => <div key={a.id} className={`mk-aviso ${a.tipo}`}>{a.tipo === "novo" ? "🛒 " : "⛔ "}{a.texto}</div>)}
      </div>
    </section>
  );
}
