import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, type Moeda } from "@/lib/formato";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { AbrirCaixa, FecharCaixa, MovimentoCaixa, ReceberPedido, VendaBalcao, type ClientePdv, type ContaBancaria, type PedidoReceber, type ProdutoPdv } from "./pdv";
import { confirmarRecebimento, salvarContaBancaria } from "./acoes";
import { Selo } from "../avisos";

export const metadata = { title: "Caixa do dia" };

const TIPOS: Record<string, string> = { venda: "Venda", recebimento: "Recebimento", reforco: "Reforço", sangria: "Retirada", despesa: "Despesa" };
const DESTINOS: Record<string, string> = { cofre: "para o cofre", banco: "depósito no banco", outro: "outro destino" };
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
    const caixa = (await c.query(`select cx.*, app.nome_usuario(cx.aberto_por) as aberto_por_nome from app.caixas cx
       where cx.deposito_id = $1 and cx.status = 'aberto'`, [unidade.id])).rows[0] ?? null;
    const historico = (await c.query(`select cx.*, app.nome_usuario(cx.aberto_por) as aberto_por_nome, app.nome_usuario(cx.fechado_por) as fechado_por_nome from app.caixas cx
       where cx.deposito_id = $1 and cx.status = 'fechado' order by cx.fechado_em desc limit 15`, [unidade.id])).rows;
    const gerente = u.perfil === "gerente" || u.perfil === "dono";
    const contas = (await c.query("select id, nome, moeda, banco, titular, deposito_id, ativo from app.contas_bancarias where deposito_id is null or deposito_id = $1 order by ativo desc, nome", [unidade.id])).rows;
    const categorias = (await c.query("select codigo, nome from app.despesa_categorias where ativo and codigo <> 'mercadoria' order by ordem, nome")).rows as { codigo: string; nome: string }[];
    // recebimentos por transferência a confirmar no extrato (gerente vê de todas as unidades)
    const pendentes = (await c.query(`select m.id, m.em, m.valor, m.moeda, m.modalidade, m.referencia, cb.nome conta, d.nome unidade, app.nome_usuario(m.usuario_id) quem,
        coalesce(cl.nome, 'Cliente avulso') cliente, m.pedido_id
      from app.caixa_movimentos m join app.caixas cx on cx.id = m.caixa_id join app.depositos d on d.id = cx.deposito_id
      left join app.contas_bancarias cb on cb.id = m.conta_bancaria_id left join app.pedidos p on p.id = m.pedido_id left join app.clientes cl on cl.id = p.cliente_id
      where m.confirmacao = 'pendente' and (${gerente ? "true" : "cx.deposito_id = $1"}) order by m.em limit 200`, gerente ? [] : [unidade.id])).rows;
    const extras = { gerente, contas, categorias, pendentes };
    if (!caixa) return { dep, caixa, historico, resumo: [], movs: [], esperadoGs: 0, esperadoBrl: 0, produtos: [], clientes: [], pedidos: [], ...extras };
    const resumo = (await c.query(`select moeda, modalidade, tipo, sum(valor) total, count(*)::int n from app.caixa_movimentos
       where caixa_id = $1 group by 1, 2, 3 order by 1, 3, 2`, [caixa.id])).rows;
    const movs = (await c.query(`select m.*, app.nome_usuario(m.usuario_id) as quem, p.bling_numero, coalesce(cl.nome, 'Cliente avulso') as cliente, cb.nome as conta
       from app.caixa_movimentos m left join app.contas_bancarias cb on cb.id = m.conta_bancaria_id
       left join app.pedidos p on p.id = m.pedido_id left join app.clientes cl on cl.id = p.cliente_id
       where m.caixa_id = $1 order by m.em desc limit 200`, [caixa.id])).rows;
    const esp = (await c.query("select app.caixa_esperado($1, 'GS') gs, app.caixa_esperado($1, 'BRL') brl", [caixa.id])).rows[0];
    const produtos = (await c.query(`select p.id, p.codigo, p.nome, p.gtin, p.unidades_caixa as caixa,
         coalesce((select quantidade from app.estoque_saldos s where s.deposito_id = $1 and s.produto_id = p.id), 0)::float as saldo
       from app.produtos p where p.ativo and not p.marketplace order by p.nome`, [unidade.id])).rows as ProdutoPdv[];
    const clientes = (await c.query(`select id, nome, moeda from app.clientes where mesclado_em is null and ativo
       and app.deposito_do_cliente(id) = $1 order by nome`, [unidade.id])).rows as ClientePdv[];
    const pedidos = (await c.query(`select p.id, p.moeda, p.status_comercial::text as status, coalesce(cl.nome, 'Cliente avulso') as cliente, p.data_pedido,
         greatest(p.valor_total - p.recebido - p.a_conferir, 0)::float as falta, p.valor_total
       from app.v_pedidos p left join app.clientes cl on cl.id = p.cliente_id
       where p.deposito_id = $1 and p.status_comercial <> 'cancelado' and p.canal <> 'balcao'
         and (p.status_comercial <> 'entregue' or p.valor_total - p.recebido - p.a_conferir > 0)
         and p.data_pedido > current_date - 120
       order by p.data_pedido desc limit 80`, [unidade.id])).rows;
    return { ...extras, dep, caixa, historico, resumo, movs, esperadoGs: Number(esp.gs), esperadoBrl: Number(esp.brl), produtos, clientes,
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
  const contasAtivas = d.contas.filter((x) => x.ativo).map((x) => ({ id: x.id, nome: x.nome, moeda: x.moeda })) as ContaBancaria[];

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
          <VendaBalcao caixa={d.caixa.id} produtos={d.produtos} clientes={d.clientes} moedaPadrao={d.dep.pais === "PY" ? "GS" : "BRL"} contas={contasAtivas} />
          <div className="grade-2">
            <ReceberPedido caixa={d.caixa.id} pedidos={d.pedidos} contas={contasAtivas} />
            <MovimentoCaixa caixa={d.caixa.id} contas={contasAtivas} categorias={d.categorias} />
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
                    <td>{TIPOS[m.tipo]}{m.destino ? ` ${DESTINOS[m.destino] ?? ""}` : ""}{m.pedido_id ? <> · <Link href={`/pedidos/${m.pedido_id}`}>{m.cliente}</Link></> : m.descricao ? ` · ${m.descricao}` : ""}
                      {m.despesa_id && <div className="pequeno suave">no Contas a pagar</div>}</td>
                    <td>{FORMAS[m.modalidade] ?? m.modalidade}{m.conta && <div className="pequeno suave">{m.conta}{m.referencia ? ` · ${m.referencia}` : ""}</div>}
                      {m.confirmacao && <div><Selo cor={m.confirmacao === "confirmado" ? "ok" : m.confirmacao === "recusado" ? "erro" : "aviso"}>{m.confirmacao === "pendente" ? "a confirmar" : m.confirmacao}</Selo></div>}</td>
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

      {d.pendentes.length > 0 && (
        <section className="painel" style={{ borderColor: "var(--aviso)" }}>
          <h2 style={{ margin: 0 }}>Transferências a confirmar no extrato ({d.pendentes.length})</h2>
          <p className="suave pequeno" style={{ margin: 0 }}>{d.gerente ? "Confira no extrato de cada conta: caiu, confirme; não caiu, recuse com o motivo." : "O gerente confirma quando conferir no extrato."}</p>
          <div className="tabela"><table>
            <thead><tr><th>Quando</th><th>Unidade</th><th>Cliente</th><th>Conta de destino</th><th className="num">Valor</th><th>Quem lançou</th>{d.gerente && <th></th>}</tr></thead>
            <tbody>{d.pendentes.map((x) => (
              <tr key={x.id}>
                <td>{hora(x.em)}</td><td>{x.unidade}</td>
                <td>{x.pedido_id ? <Link href={`/pedidos/${x.pedido_id}`}>{x.cliente}</Link> : x.cliente}</td>
                <td>{x.conta ?? <span className="texto-erro">sem conta</span>}<div className="pequeno suave">{FORMAS[x.modalidade] ?? x.modalidade}{x.referencia ? ` · ${x.referencia}` : ""}</div></td>
                <td className="num"><b>{dinheiro(x.valor, x.moeda)}</b></td><td>{x.quem}</td>
                {d.gerente && <td>
                  <div className="linha" style={{ gap: 6, flexWrap: "wrap" }}>
                    <form action={confirmarRecebimento}><input type="hidden" name="mov" value={x.id} /><input type="hidden" name="ok" value="1" /><button className="principal pequeno">Caiu: confirmar</button></form>
                    <form action={confirmarRecebimento} className="linha" style={{ gap: 4 }}><input type="hidden" name="mov" value={x.id} /><input type="hidden" name="ok" value="0" />
                      <input name="motivo" placeholder="Motivo" required style={{ width: 110 }} aria-label="Motivo da recusa" /><button className="perigo pequeno">Recusar</button></form>
                  </div>
                </td>}
              </tr>))}</tbody>
          </table></div>
        </section>
      )}

      {d.gerente && (
        <details className="painel">
          <summary><b>Contas bancárias (para onde os clientes transferem)</b></summary>
          {d.contas.length > 0 && (
            <div className="tabela" style={{ marginTop: 8 }}><table>
              <thead><tr><th>Conta</th><th>Banco / titular</th><th>Moeda</th><th>Unidade</th><th></th></tr></thead>
              <tbody>{d.contas.map((x) => (
                <tr key={x.id} className={x.ativo ? "" : "suave"}>
                  <td>{x.nome}</td><td>{[x.banco, x.titular].filter(Boolean).join(" · ")}</td><td>{x.moeda === "GS" ? "Gs" : "R$"}</td>
                  <td>{x.deposito_id ? d.dep.nome : "Todas"}</td>
                  <td><form action={salvarContaBancaria}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="ativo" value={x.ativo ? "0" : "1"} />
                    <button className="discreto pequeno">{x.ativo ? "Desativar" : "Ativar"}</button></form></td>
                </tr>))}</tbody>
            </table></div>
          )}
          <form action={salvarContaBancaria} className="campos" style={{ marginTop: 8 }}>
            <label>Nome que a vendedora vê<input name="nome" required maxLength={80} placeholder="Ex.: Itaú Gs - Cristina" /></label>
            <label>Banco<input name="banco" maxLength={60} /></label>
            <label>Titular<input name="titular" maxLength={80} /></label>
            <label>Moeda<select name="moeda" defaultValue={d.dep.pais === "PY" ? "GS" : "BRL"}><option value="GS">Gs</option><option value="BRL">R$</option></select></label>
            <label>Usada em<select name="deposito" defaultValue={unidade.id}><option value={unidade.id}>{d.dep.nome}</option><option value="">Todas as unidades</option></select></label>
            <button className="principal">Cadastrar conta</button>
          </form>
        </details>
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
