import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dataHora, dinheiro, linkWhatsApp, type Moeda } from "@/lib/formato";
import { Avisos, Selo } from "../../avisos";
import { cdeClienteRetirou, confirmarEnvioPy } from "../acoes";
import { Imprimir } from "../../estoque/transferencias/[id]/imprimir";

export const metadata = { title: "Chegando na CDE" };

type Chegando = { id: string; tipo: "envio" | "retira"; cliente: string; cidade: string | null; telefone: string | null; vendedora: string;
  meio: string | null; dados: string | null; volumes: number | null; despachado_em: string | null; saldo: string; moeda: Moeda;
  itens: { q: number; d: string; c: string | null }[] };

/** Loja CDE: o que saiu do CD com o passeiro. Envios para outras cidades (despachar e confirmar) e retiradas na loja (entregar e dar o ✓). */
export default async function ChegandoCde({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const d = await comUsuario(u.id, async (c) => ({
    pode: (await c.query("select app.pode_confirmar_envio_py() p")).rows[0].p as boolean,
    lista: (await c.query("select * from app.cde_chegando()")).rows as Chegando[],
  }));
  if (!d.pode) return <div className="painel">Esta área é da loja CDE (e da gerência).</div>;
  const envios = d.lista.filter((x) => x.tipo === "envio"), retiras = d.lista.filter((x) => x.tipo === "retira");

  const Cartao = ({ e }: { e: Chegando }) => {
    const zap = e.tipo === "retira" ? linkWhatsApp(e.telefone, `Olá ${e.cliente}! Seu pedido da Virtual Cosméticos já está na loja de Ciudad del Este para retirar.`) : null;
    return (
      <div className="envio-cartao chegando">
        <div className="linha entre"><b>{e.cliente}</b><span className="pequeno suave">{e.vendedora}</span></div>
        <div className="pequeno"><b>{e.tipo === "envio" ? e.meio : "Retira na loja CDE"}</b>{e.cidade ? ` · ${e.cidade}` : ""}{e.volumes != null ? ` · ${e.volumes} caixa(s)` : ""}
          {e.despachado_em && <span className="suave"> · saiu do CD {dataHora(e.despachado_em)}</span>}</div>
        {e.dados && <div className="pequeno suave" style={{ whiteSpace: "pre-line" }}>{e.dados}</div>}
        <ul className="envio-itens pequeno">{e.itens.map((i, k) => <li key={k}><b>{Number(i.q).toLocaleString("pt-BR")}×</b> {i.d}</li>)}</ul>
        {Number(e.saldo) > 0 && <div className="pequeno" style={{ color: "var(--aviso)" }}>Falta pagar {dinheiro(e.saldo, e.moeda)}: confirme com a vendedora antes de entregar.</div>}
        <div className="nao-imprimir">
          {e.tipo === "envio" ? (
            <form action={confirmarEnvioPy} className="linha">
              <input type="hidden" name="pedido_id" value={e.id} />
              <input name="guia" placeholder="Nº da guia / transportadora (opcional)" style={{ flex: 1, minWidth: 160 }} />
              <button className="principal">✓ Enviado</button>
            </form>
          ) : (
            <form action={cdeClienteRetirou} className="linha entre">
              <input type="hidden" name="pedido_id" value={e.id} />
              {zap ? <a className="botao whatsapp mini" href={zap} target="_blank" rel="noopener noreferrer">Avisar cliente</a> : <span />}
              <button className="principal">✓ Cliente retirou</button>
            </form>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha nao-imprimir"><Link href="/pedidos">Pedidos</Link> / Chegando na CDE</div>
          <h1>Chegando na CDE</h1>
          <p className="nao-imprimir">O que saiu do CD com o passeiro, com os itens de cada pedido (no lugar do PDF). Envios para outras cidades: despache pela
            transportadora e toque em ✓ Enviado. Retiradas: entregue ao cliente e toque em ✓ Cliente retirou.</p>
        </div>
        <Imprimir />
      </section>
      <Avisos ok={f.ok} erro={f.erro} />
      {d.lista.length === 0 && <div className="painel vazio">Nada chegando agora. 🎉</div>}
      {envios.length > 0 && (
        <section className="painel">
          <h2>Envios para outras cidades <Selo cor="info">{envios.length}</Selo></h2>
          <div className="envios-lista">{envios.map((e) => <Cartao key={e.id} e={e} />)}</div>
        </section>
      )}
      {retiras.length > 0 && (
        <section className="painel">
          <h2>Para retirar na loja <Selo cor="ok">{retiras.length}</Selo></h2>
          <div className="envios-lista">{retiras.map((e) => <Cartao key={e.id} e={e} />)}</div>
        </section>
      )}
    </>
  );
}
