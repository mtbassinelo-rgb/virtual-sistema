import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, dinheiro, STATUS_PAGAMENTO, COR_PAGAMENTO, type Moeda } from "@/lib/formato";
import { Selo } from "../../avisos";

export const metadata = { title: "Contas a receber" };

const FAIXAS = [
  { k: "todas", t: "Todas" },
  { k: "vencidas", t: "Vencidas" },
  { k: "60", t: "+60 dias" },
  { k: "31", t: "31 a 60 dias" },
  { k: "16", t: "16 a 30 dias" },
  { k: "1", t: "1 a 15 dias" },
  { k: "avencer", t: "A vencer" },
  { k: "sem", t: "Sem vencimento" },
] as const;
const faixaDe = (atraso: number | null) => atraso == null ? "sem" : atraso <= 0 ? "avencer" : atraso <= 15 ? "1" : atraso <= 30 ? "16" : atraso <= 60 ? "31" : "60";

type Linha = { id: string; data_pedido: string; bling_numero: string | null; cliente_id: string; cliente_nome: string; vendedora_nome: string;
  moeda: Moeda; valor_total: string; recebido: string; a_conferir: string; saldo: string; vencimento: string | null; status_pagamento: string;
  credito_concedido: boolean; atraso: number | null };

export default async function Receber({ searchParams }: { searchParams: Promise<{ faixa?: string; vendedora?: string; moeda?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) redirect("/");
  const f = await searchParams;
  const faixa = FAIXAS.find((x) => x.k === f.faixa)?.k ?? "todas";
  const d = await comUsuario(u.id, async (c) => ({
    linhas: (await c.query(`select v.id, v.data_pedido, v.bling_numero, v.cliente_id, v.cliente_nome, v.vendedora_nome, v.moeda, v.valor_total,
        v.recebido, v.a_conferir, v.saldo, v.vencimento, v.status_pagamento, v.credito_concedido,
        case when v.vencimento is not null then current_date - v.vencimento end as atraso
      from app.v_pedidos v
      where v.status_comercial <> 'cancelado' and app.conta_como_venda(v.status_comercial) and v.saldo > 0
      order by v.vencimento nulls last, v.data_pedido`)).rows as Linha[],
    recebidoMes: (await c.query(`select p.moeda, coalesce(sum(pg.valor), 0) v from app.pagamentos pg join app.pedidos p on p.id = pg.pedido_id
      where pg.status_conferencia = 'conferido' and date_trunc('month', pg.data) = date_trunc('month', current_date) group by p.moeda`)).rows as { moeda: Moeda; v: string }[],
    vendedoras: (await c.query("select nome from app.vendedoras where ativo order by nome")).rows.map((r) => r.nome as string),
  }));
  const todas = d.linhas.filter((l) => (!f.vendedora || l.vendedora_nome === f.vendedora) && (!f.moeda || l.moeda === f.moeda));
  const lista = todas.filter((l) => faixa === "todas" || (faixa === "vencidas" ? (l.atraso ?? 0) > 0 : faixaDe(l.atraso) === faixa));
  const moedas: Moeda[] = ["GS", "BRL"];
  const soma = (ls: Linha[], m: Moeda, fn: (l: Linha) => boolean = () => true) => ls.filter((l) => l.moeda === m && fn(l)).reduce((s, l) => s + Number(l.saldo), 0);
  const prox = (dias: number) => (l: Linha) => l.atraso != null && l.atraso <= 0 && l.atraso > -dias;
  // por cliente: quem mais deve
  const porCliente = new Map<string, { nome: string; moeda: Moeda; saldo: number; vencido: number; pedidos: number }>();
  for (const l of todas) {
    const k = `${l.cliente_id}:${l.moeda}`;
    const x = porCliente.get(k) ?? { nome: l.cliente_nome, moeda: l.moeda, saldo: 0, vencido: 0, pedidos: 0 };
    x.saldo += Number(l.saldo); x.pedidos++; if ((l.atraso ?? 0) > 0) x.vencido += Number(l.saldo);
    porCliente.set(k, x);
  }
  const devedores = [...porCliente.entries()].sort((a, b) => b[1].vencido - a[1].vencido || b[1].saldo - a[1].saldo).slice(0, 15);
  const qs = (o: Record<string, string | undefined>) => "/financeiro/receber?" + new URLSearchParams(Object.entries({ faixa, vendedora: f.vendedora, moeda: f.moeda, ...o })
    .filter((e): e is [string, string] => Boolean(e[1]) && e[1] !== "todas")).toString();

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/financeiro">Financeiro</Link> / Contas a receber</div>
          <h1>Contas a receber</h1>
          <p>Tudo o que os clientes ainda devem, por idade do atraso. Pagamento só baixa depois de conferido.</p>
        </div>
        <Link className="botao" href="/pedidos?pagamento=atrasado">Pedidos atrasados</Link>
      </section>

      {moedas.map((m) => soma(todas, m) > 0 && (
        <section key={m} className="indicadores">
          <div className="indicador"><span className="rotulo">A receber ({m === "GS" ? "Gs" : "R$"})</span><span className="valor num">{dinheiro(soma(todas, m), m)}</span></div>
          <div className="indicador destaque-erro"><span className="rotulo">Vencido</span><span className="valor num">{dinheiro(soma(todas, m, (l) => (l.atraso ?? 0) > 0), m)}</span></div>
          <div className="indicador"><span className="rotulo">Vence em 7 dias</span><span className="valor num">{dinheiro(soma(todas, m, prox(7)), m)}</span></div>
          <div className="indicador"><span className="rotulo">Vence em 30 dias</span><span className="valor num">{dinheiro(soma(todas, m, prox(30)), m)}</span></div>
          <div className="indicador"><span className="rotulo">Recebido no mês</span><span className="valor num">{dinheiro(d.recebidoMes.find((r) => r.moeda === m)?.v ?? 0, m)}</span></div>
        </section>
      ))}

      <section className="painel">
        <h2>Atraso por faixa</h2>
        <div className="tabela"><table>
          <thead><tr><th>Faixa</th>{moedas.map((m) => <th key={m}>{m === "GS" ? "Gs" : "R$"}</th>)}<th>Pedidos</th></tr></thead>
          <tbody>{FAIXAS.filter((x) => !["todas", "vencidas"].includes(x.k)).map((x) => {
            const ls = todas.filter((l) => faixaDe(l.atraso) === x.k);
            return (
              <tr key={x.k}>
                <td><Link href={qs({ faixa: x.k })}>{x.t}</Link></td>
                {moedas.map((m) => <td key={m} className="num">{dinheiro(soma(ls, m), m)}</td>)}
                <td className="num">{ls.length}</td>
              </tr>);
          })}</tbody>
        </table></div>
      </section>

      <div className="duas-colunas">
        <section className="painel">
          <div className="linha entre" style={{ flexWrap: "wrap" }}>
            <h2>Pedidos em aberto</h2>
            <form className="linha" method="get" style={{ flexWrap: "wrap" }}>
              <input type="hidden" name="faixa" value={faixa} />
              <select name="vendedora" defaultValue={f.vendedora ?? ""} aria-label="Vendedora"><option value="">Todas as vendedoras</option>
                {d.vendedoras.map((v) => <option key={v}>{v}</option>)}</select>
              <select name="moeda" defaultValue={f.moeda ?? ""} aria-label="Moeda"><option value="">Gs e R$</option><option value="GS">Gs</option><option value="BRL">R$</option></select>
              <button>Filtrar</button>
            </form>
          </div>
          <nav className="filtros">{FAIXAS.map((x) => <Link key={x.k} href={qs({ faixa: x.k })} className={x.k === faixa ? "ativo" : ""}>{x.t}</Link>)}</nav>
          {lista.length === 0 ? <div className="vazio">Nada a receber aqui.</div> : (
            <div className="tabela"><table>
              <thead><tr><th>Vencimento</th><th>Cliente</th><th>Pedido</th><th>Total</th><th>Saldo</th><th>Situação</th></tr></thead>
              <tbody>{lista.slice(0, 300).map((l) => (
                <tr key={l.id}>
                  <td className="num">{l.vencimento ? data(l.vencimento) : "—"}{(l.atraso ?? 0) > 0 && <div className="pequeno" style={{ color: "var(--erro)" }}>{l.atraso} dia(s)</div>}</td>
                  <td><Link href={`/clientes/${l.cliente_id}?aba=credito`}>{l.cliente_nome}</Link><div className="pequeno suave">{l.vendedora_nome}</div></td>
                  <td className="num"><Link href={`/pedidos/${l.id}`}>{data(l.data_pedido)}</Link>{l.bling_numero && <div className="pequeno suave">nº {l.bling_numero}</div>}</td>
                  <td className="num">{dinheiro(l.valor_total, l.moeda)}</td>
                  <td className="num"><b>{dinheiro(l.saldo, l.moeda)}</b>{Number(l.a_conferir) > 0 && <div className="pequeno suave">{dinheiro(l.a_conferir, l.moeda)} a conferir</div>}</td>
                  <td><Selo cor={COR_PAGAMENTO[l.status_pagamento]}>{STATUS_PAGAMENTO[l.status_pagamento] ?? l.status_pagamento}</Selo></td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
        <section className="painel">
          <h2>Quem mais deve</h2>
          {devedores.length === 0 ? <div className="vazio">Ninguém devendo.</div> : (
            <div className="tabela"><table>
              <thead><tr><th>Cliente</th><th>Vencido</th><th>Saldo</th></tr></thead>
              <tbody>{devedores.map(([k, x]) => (
                <tr key={k}><td><Link href={`/clientes/${k.split(":")[0]}?aba=credito`}>{x.nome}</Link><div className="pequeno suave">{x.pedidos} pedido(s)</div></td>
                  <td className="num" style={x.vencido > 0 ? { color: "var(--erro)" } : undefined}>{dinheiro(x.vencido, x.moeda)}</td>
                  <td className="num">{dinheiro(x.saldo, x.moeda)}</td></tr>))}</tbody>
            </table></div>
          )}
        </section>
      </div>
    </>
  );
}
