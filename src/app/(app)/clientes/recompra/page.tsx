import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, dataHora, dinheiro, linkWhatsApp, type Moeda } from "@/lib/formato";
import { Avisos, Selo } from "../../avisos";
import { registrarContatoRecompra } from "../acoes";

export const metadata = { title: "Recompra" };

type Linha = {
  cliente_id: string; nome: string; whatsapp: string | null; pais: string; vendedora_id: string; vendedora: string; moeda: Moeda;
  pedidos: number; primeira: string; ultima: string; intervalo_dias: number; dias_desde: number; atraso_dias: number;
  valor_medio: string | null; total_12m: string; situacao: string; recuperado: boolean; alto_valor: boolean; produtos: string[]; ultimo_contato: string | null;
};

const SITUACOES: Record<string, { t: string; d: string; cor: string }> = {
  atrasado: { t: "Atrasados", d: "Passaram do intervalo normal: chamar esta semana", cor: "aviso" },
  em_risco: { t: "Em risco", d: "Mais de 2× o intervalo sem comprar", cor: "erro" },
  inativo: { t: "Inativos", d: "Muito tempo sem comprar: reativar", cor: "erro" },
  novo: { t: "Novos", d: "Primeiro pedido recente: garantir o segundo", cor: "info" },
  em_dia: { t: "Em dia", d: "Comprando no ritmo normal", cor: "ok" },
};
const ORDEM = ["atrasado", "em_risco", "novo", "inativo", "em_dia"];

function mensagem(l: Linha): string {
  const nome = l.nome.split(" ")[0];
  const prods = l.produtos.slice(0, 3).join(", ");
  if (l.pais === "PY") {
    return `¡Hola ${nome}! ¿Cómo estás? Pasaron ${l.dias_desde} días desde tu último pedido.` +
      (prods ? ` ¿Te preparo la reposición de ${prods}?` : " ¿Te preparo un pedido?") + " Tenemos stock disponible. ¡Quedo atenta!";
  }
  return `Oi ${nome}! Tudo bem? Faz ${l.dias_desde} dias do seu último pedido.` +
    (prods ? ` Quer que eu separe a reposição de ${prods}?` : " Quer que eu monte um pedido?") + " Temos estoque. Fico no aguardo!";
}

export default async function Recompra({ searchParams }: { searchParams: Promise<{ s?: string; v?: string; q?: string; ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const gestao = ehGestao(u);
  const todos = await comUsuario(u.id, async (c) => (await c.query("select r.* from app.recompra_clientes() r where exists (select 1 from app.clientes c where c.id = r.cliente_id and c.ativo)")).rows as Linha[]);
  const sit = f.s && SITUACOES[f.s] ? f.s : "atrasado";
  const q = (f.q ?? "").trim().toLowerCase();
  const base = todos.filter((l) => !f.v || l.vendedora_id === f.v);
  const lista = base.filter((l) => (f.s === "recuperado" ? l.recuperado : l.situacao === sit) && (!q || l.nome.toLowerCase().includes(q)))
    .sort((a, b) => (b.alto_valor ? 1 : 0) - (a.alto_valor ? 1 : 0) || b.atraso_dias - a.atraso_dias || Number(b.total_12m) - Number(a.total_12m));
  const vendedoras = [...new Map(todos.map((l) => [l.vendedora_id, l.vendedora])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const url = (p: Record<string, string | undefined>) => {
    const s = new URLSearchParams();
    Object.entries({ s: f.s, v: f.v, q: f.q, ...p }).forEach(([k, v]) => { if (v) s.set(k, v); });
    return `/clientes/recompra?${s}`;
  };
  const volta = url({});
  const recorrentes = base.filter((l) => l.pedidos >= 2).length;

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Recompra</h1>
          <p>Clientes para chamar, pelo ritmo de compra de cada um. A mensagem de WhatsApp já sai pronta com o que o cliente costuma levar
            {gestao ? "; cada vendedora vê só os clientes dela." : "."}</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <section className="indicadores">
        {ORDEM.map((k) => (
          <a key={k} className="indicador" href={url({ s: k })} aria-current={(f.s ?? "atrasado") === k ? "true" : undefined} style={{ textDecoration: "none", color: "inherit" }}>
            <span className="rotulo">{SITUACOES[k].t}</span><span className="valor">{base.filter((l) => l.situacao === k).length}</span>
            <span className="pequeno suave">{SITUACOES[k].d}</span>
          </a>
        ))}
        <a className="indicador" href={url({ s: "recuperado" })} style={{ textDecoration: "none", color: "inherit" }}>
          <span className="rotulo">Recuperados</span><span className="valor">{base.filter((l) => l.recuperado).length}</span>
          <span className="pequeno suave">Voltaram a comprar no último mês</span>
        </a>
        <div className="indicador"><span className="rotulo">Recorrentes</span><span className="valor">{base.length ? Math.round((recorrentes / base.length) * 100) : 0}%</span>
          <span className="pequeno suave">Clientes com 2 pedidos ou mais</span></div>
      </section>

      {gestao && (
        <section className="painel">
          <h2>Por vendedora</h2>
          <div className="tabela"><table style={{ minWidth: 0 }}>
            <thead><tr><th>Vendedora</th><th>Clientes</th>{ORDEM.map((k) => <th key={k}>{SITUACOES[k].t}</th>)}<th>Recuperados</th></tr></thead>
            <tbody>{vendedoras.map(([id, nome]) => {
              const dv = todos.filter((l) => l.vendedora_id === id);
              return (
                <tr key={id}><td><Link href={url({ v: id })}>{nome}</Link></td><td className="num">{dv.length}</td>
                  {ORDEM.map((k) => <td key={k} className="num">{dv.filter((l) => l.situacao === k).length}</td>)}
                  <td className="num">{dv.filter((l) => l.recuperado).length}</td></tr>);
            })}</tbody>
          </table></div>
        </section>
      )}

      <form className="painel filtros" method="get">
        <input type="hidden" name="s" value={f.s ?? "atrasado"} />
        <label>Buscar cliente<input name="q" defaultValue={f.q ?? ""} /></label>
        {gestao && (
          <label>Vendedora<select name="v" defaultValue={f.v ?? ""}>
            <option value="">Todas</option>{vendedoras.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select></label>
        )}
        <button className="principal">Filtrar</button>
      </form>

      <section className="painel">
        <div className="linha entre">
          <h2>{f.s === "recuperado" ? "Recuperados" : SITUACOES[sit].t}: {lista.length}</h2>
          <span className="pequeno suave">Primeiro os de alto valor, depois os mais atrasados</span>
        </div>
        {lista.length === 0 ? <div className="vazio">Ninguém nesta situação.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Cliente</th>{gestao && <th>Vendedora</th>}<th>Última compra</th><th>Compra a cada</th><th>Atraso</th><th>Pedido médio</th><th>Costuma levar</th><th>Último contato</th><th></th></tr></thead>
            <tbody>{lista.slice(0, 300).map((l) => {
              const wa = linkWhatsApp(l.whatsapp, mensagem(l));
              return (
                <tr key={l.cliente_id}>
                  <td><Link href={`/clientes/${l.cliente_id}`}>{l.nome}</Link>
                    <div className="pequeno suave">{l.pedidos} pedido(s)</div>
                    {l.alto_valor && <Selo cor="marca">Alto valor</Selo>} {l.recuperado && <Selo cor="ok">Recuperado</Selo>}</td>
                  {gestao && <td>{l.vendedora}</td>}
                  <td>{data(l.ultima)}<div className="pequeno suave">há {l.dias_desde} dias</div></td>
                  <td className="num">{l.pedidos >= 2 ? `${l.intervalo_dias} dias` : "—"}</td>
                  <td className="num">{l.atraso_dias > 0 ? <Selo cor={SITUACOES[l.situacao]?.cor}>{l.atraso_dias} dias</Selo> : "—"}</td>
                  <td className="num">{dinheiro(l.valor_medio, l.moeda)}</td>
                  <td className="pequeno" style={{ whiteSpace: "normal", minWidth: 200 }}>{l.produtos.slice(0, 4).join(", ") || "—"}</td>
                  <td className="pequeno">{l.ultimo_contato ? dataHora(l.ultimo_contato) : "—"}</td>
                  <td>
                    <div className="linha" style={{ gap: 6 }}>
                      {wa ? <a className="botao" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a> : <span className="pequeno suave">sem WhatsApp</span>}
                      <form action={registrarContatoRecompra}>
                        <input type="hidden" name="cliente_id" value={l.cliente_id} /><input type="hidden" name="volta" value={volta} />
                        <button className="discreto" title="Registrar que o cliente foi chamado">Chamei</button>
                      </form>
                    </div>
                  </td>
                </tr>);
            })}</tbody>
          </table></div>
        )}
        <p className="pequeno suave" style={{ margin: 0 }}>Compra a cada = média de dias entre os pedidos dos últimos 12 meses. Atrasado = passou desse prazo mais a tolerância
          (ajustável em Parâmetros). Só contam pedidos que viraram venda.</p>
      </section>
    </>
  );
}
