import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, type Moeda } from "@/lib/formato";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { AbrirCaixa, FecharCaixa, MovimentoCaixa, ReceberPedido, VendaBalcao, type ClientePdv, type PedidoReceber, type ProdutoPdv } from "./pdv";

export const metadata = { title: "Caixa do dia" };

const TIPOS: Record<string, string> = { venda: "Venda", recebimento: "Recebimento", reforco: "Reforço", sangria: "Sangria", despesa: "Despesa" };
const FORMAS: Record<string, string> = { efetivo: "Dinheiro", pix: "Pix", transferencia: "Transferência", cartao: "Cartão", deposito: "Depósito", link_pagamento: "Link", outro: "Outro" };
const hora = (d: string) => new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Asuncion" });

export default async function Caixa({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const { atual, lista } = await unidadeSistema(u);
  const unidade = lista.find((x) => x.id === f.u) ?? atual ?? lista[0];
  if (!unidade) return <div className="painel">Você não está ligada a nenhuma unidade. Peça ao gerente para marcar em Equipe → Unidades de cada vendedora.</div>;

  const d = await comUsuario(u.id, async (c) => {
    const dep = (await c.query("select id, nome, pais from app.depositos where id = $1", [unidade.id])).rows[0] as { id: string; nome: string; pais: string };
    const caixa = (await c.query(`select cx.*, ua.nome as aberto_por_nome from app.caixas cx join app.usuarios ua on ua.id = cx.aberto_por
       where cx.deposito_id = $1 and cx.status = 'aberto'`, [unidade.id])).rows[0] ?? null;
    const historico = (await c.query(`select cx.*, ua.nome as aberto_por_nome, uf.nome as fechado_por_nome from app.caixas cx
       join app.usuarios ua on ua.id = cx.aberto_por left join app.usuarios uf on uf.id = cx.fechado_por
       where cx.deposito_id = $1 and cx.status = 'fechado' order by cx.fechado_em desc limit 15`, [unidade.id])).rows;
    if (!caixa) return { dep, caixa, historico, resumo: [], movs: [], esperadoGs: 0, esperadoBrl: 0, produtos: [], clientes: [], pedidos: [] };
    const resumo = (await c.query(`select moeda, modalidade, tipo, sum(valor) total, count(*)::int n from app.caixa_movimentos
       where caixa_id = $1 group by 1, 2, 3 order by 1, 3, 2`, [caixa.id])).rows;
    const movs = (await c.query(`select m.*, u.nome as quem, p.bling_numero, coalesce(cl.nome, 'Cliente avulso') as cliente
       from app.caixa_movimentos m left join app.usuarios u on u.id = m.usuario_id
       left join app.pedidos p on p.id = m.pedido_id left join app.clientes cl on cl.id = p.cliente_id
       where m.caixa_id = $1 order by m.em desc limit 200`, [caixa.id])).rows;
    const esp = (await c.query("select app.caixa_esperado($1, 'GS') gs, app.caixa_esperado($1, 'BRL') brl", [caixa.id])).rows[0];
    const produtos = (await c.query(`select p.id, p.codigo, p.nome, p.gtin, p.unidades_caixa as caixa,
         coalesce((select quantidade from app.estoque_saldos s where s.deposito_id = $1 and s.produto_id = p.id), 0)::float as saldo
       from app.produtos p where p.ativo order by p.nome`, [unidade.id])).rows as ProdutoPdv[];
    const clientes = (await c.query(`select id, nome, moeda from app.clientes where mesclado_em is null
       and app.deposito_do_cliente(id) = $1 order by nome`, [unidade.id])).rows as ClientePdv[];
    const pedidos = (await c.query(`select p.id, p.moeda, p.status_comercial::text as status, coalesce(cl.nome, 'Cliente avulso') as cliente, p.data_pedido,
         greatest(p.valor_total - p.recebido - p.a_conferir, 0)::float as falta, p.valor_total
       from app.v_pedidos p left join app.clientes cl on cl.id = p.cliente_id
       where p.deposito_id = $1 and p.status_comercial <> 'cancelado' and p.canal <> 'balcao'
         and (p.status_comercial <> 'entregue' or p.valor_total - p.recebido - p.a_conferir > 0)
         and p.data_pedido > current_date - 120
       order by p.data_pedido desc limit 80`, [unidade.id])).rows;
    return { dep, caixa, historico, resumo, movs, esperadoGs: Number(esp.gs), esperadoBrl: Number(esp.brl), produtos, clientes,
      pedidos: pedidos.map((p) => ({ id: p.id, moeda: p.moeda, falta: Number(p.falta), status: p.status,
        rotulo: `${p.cliente} · ${new Date(p.data_pedido).toLocaleDateString("pt-BR", { timeZone: "UTC" })} · ${dinheiro(p.valor_total, p.moeda)}${Number(p.falta) > 0 ? ` · falta ${dinheiro(p.falta, p.moeda)}` : " · pago"}` })) as PedidoReceber[] };
  });

  // resumo: por moeda e forma, separando entradas (venda/recebimento/reforço) e saídas
  const linhas = new Map<string, { moeda: Moeda; forma: string; entra: number; sai: number }>();
  for (const r of d.resumo) {
    const k = `${r.moeda}|${r.modalidade}`;
    const l = linhas.get(k) ?? { moeda: r.moeda, forma: r.modalidade, entra: 0, sai: 0 };
    if (["sangria", "despesa"].includes(r.tipo)) l.sai += Number(r.total); else l.entra += Number(r.total);
    linhas.set(k, l);
  }
  const vendas = d.resumo.filter((r) => r.tipo === "venda").reduce((s, r) => s + r.n, 0);

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Caixa do dia · {d.dep.nome}</h1>
          <p>{d.caixa
            ? <>Aberto por <b>{d.caixa.aberto_por_nome}</b> em {hora(d.caixa.aberto_em)}. Vendas de balcão baixam o estoque desta unidade na hora.</>
            : "O caixa está fechado. Abra para registrar vendas e recebimentos."}</p>
        </div>
        {lista.length > 1 && (
          <nav className="troca-unidade" aria-label="Unidade do caixa">
            {lista.map((x) => <Link key={x.id} href={`/caixa?u=${x.id}`} className={x.id === unidade.id ? "atual" : ""}>{x.nome}</Link>)}
          </nav>
        )}
      </section>

      {!d.caixa && <AbrirCaixa deposito={unidade.id} />}

      {d.caixa && (
        <>
          <section className="atalhos">
            <div className="atalho"><b>{vendas}</b><span>venda(s) no balcão</span></div>
            <div className="atalho"><b>{dinheiro(d.esperadoGs, "GS")}</b><span>dinheiro na gaveta (Gs)</span></div>
            <div className="atalho"><b>{dinheiro(d.esperadoBrl, "BRL")}</b><span>dinheiro na gaveta (R$)</span></div>
          </section>
          <VendaBalcao caixa={d.caixa.id} produtos={d.produtos} clientes={d.clientes} moedaPadrao={d.dep.pais === "PY" ? "GS" : "BRL"} />
          <div className="grade-2">
            <ReceberPedido caixa={d.caixa.id} pedidos={d.pedidos} />
            <MovimentoCaixa caixa={d.caixa.id} />
          </div>
          <section className="painel">
            <h2 style={{ margin: 0 }}>Resumo do caixa</h2>
            {linhas.size === 0 ? <div className="vazio">Nada lançado ainda.</div> : (
              <div className="tabela"><table>
                <thead><tr><th>Moeda</th><th>Forma</th><th className="num">Entradas</th><th className="num">Saídas</th></tr></thead>
                <tbody>{[...linhas.values()].map((l) => (
                  <tr key={l.moeda + l.forma}><td>{l.moeda === "GS" ? "Guaranis" : "Reais"}</td><td>{FORMAS[l.forma] ?? l.forma}</td>
                    <td className="num">{dinheiro(l.entra, l.moeda)}</td><td className="num">{l.sai ? dinheiro(l.sai, l.moeda) : "—"}</td></tr>
                ))}</tbody>
              </table></div>
            )}
            <div className="pequeno suave">Troco de abertura: {dinheiro(d.caixa.fundo_gs, "GS")} · {dinheiro(d.caixa.fundo_brl, "BRL")}</div>
          </section>
          <section className="painel">
            <h2 style={{ margin: 0 }}>Lançamentos</h2>
            {d.movs.length === 0 ? <div className="vazio">Nenhum lançamento.</div> : (
              <div className="tabela"><table>
                <thead><tr><th>Hora</th><th>O quê</th><th>Forma</th><th className="num">Valor</th><th>Quem</th></tr></thead>
                <tbody>{d.movs.map((m) => (
                  <tr key={m.id}>
                    <td className="num">{hora(m.em)}</td>
                    <td>{TIPOS[m.tipo]}{m.pedido_id ? <> · <Link href={`/pedidos/${m.pedido_id}`}>{m.cliente}</Link></> : m.descricao ? ` · ${m.descricao}` : ""}</td>
                    <td>{FORMAS[m.modalidade] ?? m.modalidade}</td>
                    <td className={`num ${["sangria", "despesa"].includes(m.tipo) ? "texto-erro" : ""}`}>{["sangria", "despesa"].includes(m.tipo) ? "− " : ""}{dinheiro(m.valor, m.moeda)}</td>
                    <td>{m.quem}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
          <FecharCaixa caixa={d.caixa.id} esperadoGs={d.esperadoGs} esperadoBrl={d.esperadoBrl} />
        </>
      )}

      <section className="painel">
        <h2 style={{ margin: 0 }}>Caixas fechados</h2>
        {d.historico.length === 0 ? <div className="vazio">Nenhum caixa fechado ainda.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Abertura</th><th>Fechamento</th><th className="num">Gs contado / esperado</th><th className="num">R$ contado / esperado</th><th>Observação</th></tr></thead>
            <tbody>{d.historico.map((h) => {
              const dg = Number(h.contado_gs) - Number(h.esperado_gs), db = Number(h.contado_brl) - Number(h.esperado_brl);
              return (
                <tr key={h.id}>
                  <td>{hora(h.aberto_em)}<div className="pequeno suave">{h.aberto_por_nome}</div></td>
                  <td>{hora(h.fechado_em)}<div className="pequeno suave">{h.fechado_por_nome}</div></td>
                  <td className="num">{dinheiro(h.contado_gs, "GS")} / {dinheiro(h.esperado_gs, "GS")}{Math.abs(dg) > 0.009 && <div className="texto-erro pequeno">diferença {dinheiro(dg, "GS")}</div>}</td>
                  <td className="num">{dinheiro(h.contado_brl, "BRL")} / {dinheiro(h.esperado_brl, "BRL")}{Math.abs(db) > 0.009 && <div className="texto-erro pequeno">diferença {dinheiro(db, "BRL")}</div>}</td>
                  <td>{h.observacao ?? ""}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
