import Link from "next/link";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, data, MODALIDADES, type Moeda } from "@/lib/formato";
import { Selo } from "./avisos";

export const metadata = { title: "Hoje" };

export default async function Hoje() {
  const u = await exigirUsuario();
  const gestao = ehGestao(u);

  const d = await comUsuario(u.id, async (c) => {
    const aConferir = gestao
      ? (await c.query(`
          select g.id, g.valor, g.data, g.modalidade, p.id as pedido_id, p.moeda, p.bling_numero,
                 p.cliente_nome, p.vendedora_nome
            from app.pagamentos g join app.v_pedidos p on p.id = g.pedido_id
           where g.status_conferencia = 'pendente'
           order by g.registrado_em limit 30`)).rows
      : [];
    const metasPropostas = gestao
      ? (await c.query(`select count(*)::int n from app.metas_cliente where status = 'proposta'`)).rows[0].n
      : 0;
    const recusados = (await c.query(`
        select g.id, g.valor, g.motivo_recusa, p.id as pedido_id, p.moeda, p.cliente_nome
          from app.pagamentos g join app.v_pedidos p on p.id = g.pedido_id
         where g.status_conferencia = 'recusado' and g.conferido_em > now() - interval '7 days'
         order by g.conferido_em desc limit 20`)).rows;
    const envioAtrasado = (await c.query(`
        select id, cliente_nome, previsao_envio, valor_total, moeda, vendedora_nome
          from app.v_pedidos where envio_atrasado order by previsao_envio limit 30`)).rows;
    const pagAtrasado = (await c.query(`
        select id, cliente_nome, vencimento, saldo, moeda, vendedora_nome
          from app.v_pedidos where status_pagamento = 'atrasado' order by vencimento limit 30`)).rows;
    const metasPerto = (await c.query(`
        select id, cliente_nome, falta, dias_restantes, moeda, percentual
          from app.v_metas where status = 'aprovada' and not meta_batida and dias_restantes <= 10
          order by dias_restantes limit 20`)).rows;
    const transferencias = (await c.query(`
        select t.id, t.numero, o.nome origem, d.nome destino, t.enviada_em
          from app.transferencias t join app.depositos o on o.id = t.origem_id join app.depositos d on d.id = t.destino_id
         where t.status = 'enviada' and app.pode_operar_deposito(t.destino_id)
         order by t.enviada_em`)).rows;
    return { aConferir, metasPropostas, recusados, envioAtrasado, pagAtrasado, metasPerto, transferencias };
  });

  return (
    <>
      <section>
        <h1>Bom trabalho, {u.nome.split(" ")[0]}</h1>
        <div className="suave">O que precisa de atenção hoje.</div>
      </section>

      <div className="indicadores">
        {gestao && (
          <div className="indicador">
            <span className="rotulo">Pagamentos a conferir</span>
            <span className="valor">{d.aConferir.length}</span>
          </div>
        )}
        {gestao && (
          <Link href="/metas?status=proposta" className="indicador" style={{ textDecoration: "none", color: "inherit" }}>
            <span className="rotulo">Metas para aprovar</span>
            <span className="valor">{d.metasPropostas}</span>
          </Link>
        )}
        <div className="indicador">
          <span className="rotulo">Envios atrasados</span>
          <span className="valor">{d.envioAtrasado.length}</span>
        </div>
        <div className="indicador">
          <span className="rotulo">Pagamentos atrasados</span>
          <span className="valor">{d.pagAtrasado.length}</span>
        </div>
        <div className="indicador">
          <span className="rotulo">Transferências a receber</span>
          <span className="valor">{d.transferencias.length}</span>
        </div>
      </div>

      {gestao && (
        <section className="painel">
          <h2>Pagamentos a conferir</h2>
          {d.aConferir.length === 0 ? (
            <p className="suave">Nenhum pagamento esperando conferência.</p>
          ) : (
            <div className="tabela">
              <table>
                <thead>
                  <tr><th>Registrado</th><th>Cliente</th><th>Vendedora</th><th>Valor</th><th>Modalidade</th><th>Nº Bling</th><th></th></tr>
                </thead>
                <tbody>
                  {d.aConferir.map((g) => (
                    <tr key={g.id}>
                      <td className="num">{data(g.data)}</td>
                      <td>{g.cliente_nome ?? "—"}</td>
                      <td>{g.vendedora_nome}</td>
                      <td className="num">{dinheiro(g.valor, g.moeda as Moeda)}</td>
                      <td>{MODALIDADES[g.modalidade]}</td>
                      <td className="num">{g.bling_numero ?? <Selo cor="aviso">sem nº</Selo>}</td>
                      <td><Link href={`/pedidos/${g.pedido_id}#pagamentos`}>Conferir</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {d.recusados.length > 0 && (
        <section className="painel">
          <h2>Pagamentos recusados (últimos 7 dias)</h2>
          <ul className="lista-simples">
            {d.recusados.map((g) => (
              <li key={g.id}>
                <Link href={`/pedidos/${g.pedido_id}`}>{g.cliente_nome ?? "Pedido"}</Link>{" "}
                <span className="num">{dinheiro(g.valor, g.moeda as Moeda)}</span>: {g.motivo_recusa}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="duas-colunas">
        <section className="painel">
          <h2>Envios atrasados</h2>
          {d.envioAtrasado.length === 0 ? <p className="suave">Nenhum envio atrasado.</p> : (
            <ul className="lista-simples">
              {d.envioAtrasado.map((p) => (
                <li key={p.id}>
                  <Link href={`/pedidos/${p.id}`}>{p.cliente_nome ?? "Pedido"}</Link>: previsto para {data(p.previsao_envio)}
                  {gestao && <span className="suave"> · {p.vendedora_nome}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="painel">
          <h2>Pagamentos atrasados</h2>
          {d.pagAtrasado.length === 0 ? <p className="suave">Nenhum pagamento atrasado.</p> : (
            <ul className="lista-simples">
              {d.pagAtrasado.map((p) => (
                <li key={p.id}>
                  <Link href={`/pedidos/${p.id}`}>{p.cliente_nome ?? "Pedido"}</Link>:{" "}
                  <span className="num">{dinheiro(p.saldo, p.moeda as Moeda)}</span> vencido em {data(p.vencimento)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="duas-colunas">
        <section className="painel">
          <h2>Metas perto do prazo</h2>
          {d.metasPerto.length === 0 ? <p className="suave">Nenhuma meta terminando nos próximos 10 dias.</p> : (
            <ul className="lista-simples">
              {d.metasPerto.map((m) => (
                <li key={m.id}>
                  <Link href="/metas">{m.cliente_nome}</Link>: faltam{" "}
                  <span className="num">{dinheiro(m.falta, m.moeda as Moeda)}</span> em {m.dias_restantes} dia(s)
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="painel">
          <h2>Transferências para receber</h2>
          {d.transferencias.length === 0 ? <p className="suave">Nada em trânsito para os seus depósitos.</p> : (
            <ul className="lista-simples">
              {d.transferencias.map((t) => (
                <li key={t.id}>
                  <Link href="/estoque#transferencias">Nº {t.numero}</Link>: {t.origem} → {t.destino}, enviada em {data(t.enviada_em)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
