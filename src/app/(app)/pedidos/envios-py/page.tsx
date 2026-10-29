import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dataHora } from "@/lib/formato";
import { Avisos } from "../../avisos";
import { confirmarEnvioPy } from "../acoes";

export const metadata = { title: "Envios Paraguai a confirmar" };

type Envio = { id: string; cliente: string; cidade: string | null; vendedora: string; entrega_meio: string | null; entrega_dados: string | null; volumes: number | null; despachado_em: string | null };

/** Loja CDE: pedidos de envio para o Paraguai que o passeiro trouxe; despachar pela transportadora e confirmar. */
export default async function EnviosPy({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const d = await comUsuario(u.id, async (c) => ({
    pode: (await c.query("select app.pode_confirmar_envio_py() p")).rows[0].p as boolean,
    lista: (await c.query("select * from app.envios_py_pendentes()")).rows as Envio[],
  }));
  if (!d.pode) return <div className="painel">Esta área é da loja CDE (e da gerência).</div>;
  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/pedidos">Pedidos</Link> / Envios Paraguai</div>
          <h1>Envios para o Paraguai a confirmar</h1>
          <p>Pedidos que o passeiro trouxe para a loja CDE e que vão para outras cidades. Organize, despache pela transportadora e confirme aqui:
            a vendedora é avisada e finaliza o pedido.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />
      {d.lista.length === 0 ? <div className="painel vazio">Nenhum envio pendente. 🎉</div> : (
        <div className="envios-lista">
          {d.lista.map((e) => (
            <div key={e.id} className="envio-cartao">
              <div className="linha entre"><b>{e.cliente}</b><span className="pequeno suave">{e.vendedora}</span></div>
              <div className="pequeno"><b>{e.entrega_meio}</b>{e.cidade ? ` · ${e.cidade}` : ""}{e.volumes != null ? ` · ${e.volumes} caixa(s)` : ""}</div>
              {e.entrega_dados && <div className="pequeno suave" style={{ whiteSpace: "pre-line" }}>{e.entrega_dados}</div>}
              {e.despachado_em && <div className="pequeno suave">Saiu do CD em {dataHora(e.despachado_em)}</div>}
              <form action={confirmarEnvioPy} className="linha">
                <input type="hidden" name="pedido_id" value={e.id} />
                <input name="guia" placeholder="Nº da guia / transportadora (opcional)" style={{ flex: 1, minWidth: 160 }} />
                <button className="principal">✓ Enviado</button>
              </form>
              <Link className="pequeno" href={`/pedidos/${e.id}`}>ver pedido</Link>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
