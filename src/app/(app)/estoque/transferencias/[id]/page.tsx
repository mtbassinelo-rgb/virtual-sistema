import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro } from "@/lib/formato";
import { SITUACAO_TRANSF } from "@/lib/transferencias";
import { Avisos, Selo } from "../../../avisos";
import { aprovarTransferencia, cancelarSolicitacao, receberSolicitacao, separarTransferencia } from "../acoes";
import { Imprimir } from "./imprimir";

export const metadata = { title: "Pedido entre unidades" };
const quando = (d: string | null) => d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";

export default async function Transferencia({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const { id } = await params;
  const f = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await comUsuario(u.id, async (c) => {
    const t = (await c.query(`select t.*, o.nome origem, de.nome destino, app.nome_usuario(t.criada_por) criada_por_nome, app.nome_usuario(t.separada_por) separada_por_nome, app.nome_usuario(t.enviada_por) enviada_por_nome,
        app.nome_usuario(t.recebida_por) recebida_por_nome, app.nome_usuario(t.cancelada_por) cancelada_por_nome, app.pode_operar_deposito(t.origem_id) opera_origem,
        app.pode_operar_deposito(t.destino_id) or app.trabalha_na_unidade(t.destino_id) recebe, app.pode_aprovar_transferencia() aprova,
        p.bling_numero pedido_numero
      from app.transferencias t join app.depositos o on o.id = t.origem_id join app.depositos de on de.id = t.destino_id
      left join app.pedidos p on p.id = coalesce(t.pedido_origem_id, t.pedido_id)
      where t.id = $1`, [id])).rows[0];
    if (!t) return null;
    const itens = (await c.query(`select i.*, p.nome, p.codigo, p.marca, p.gtin, p.unidades_caixa,
        coalesce((select quantidade from app.estoque_saldos s where s.deposito_id = $2 and s.produto_id = i.produto_id), 0)::float saldo_origem
      from app.transferencia_itens i join app.produtos p on p.id = i.produto_id where i.transferencia_id = $1 order by p.marca, p.nome`, [id, t.origem_id])).rows;
    return { t, itens };
  });
  if (!d) notFound();
  const { t, itens } = d;
  const s = SITUACAO_TRANSF[t.status] ?? { t: t.status, cor: "" };
  const pedidas = itens.reduce((a, i) => a + Number(i.quantidade_solicitada ?? i.quantidade_enviada), 0);
  const enviadas = itens.reduce((a, i) => a + Number(i.quantidade_enviada), 0);
  const podeCancelar = ["solicitada", "separada", "rascunho"].includes(t.status) && (t.opera_origem || t.aprova || t.criada_por === u.id);
  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/estoque/transferencias">Pedidos entre unidades</Link> / #{t.numero}</div>
          <h1>#{t.numero} · {t.origem} → {t.destino}</h1>
          <p><Selo cor={s.cor}>{s.t}</Selo> {t.observacao}</p>
        </div>
        <Imprimir />
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <section className="painel linha-tempo-transf">
        <div className={t.criada_em ? "feito" : ""}><b>Pedido</b><span>{quando(t.criada_em)}</span><span>{t.criada_por_nome}</span></div>
        <div className={t.separada_em ? "feito" : ""}><b>Separado</b><span>{quando(t.separada_em)}</span><span>{t.separada_por_nome}</span></div>
        <div className={t.enviada_em ? "feito" : ""}><b>Aprovado e enviado</b><span>{quando(t.enviada_em)}</span><span>{t.enviada_por_nome}</span></div>
        <div className={t.recebida_em ? "feito" : ""}><b>Recebido</b><span>{quando(t.recebida_em)}</span><span>{t.recebida_por_nome}</span></div>
        {t.status === "cancelada" && <div className="cancelado"><b>Cancelado</b><span>{quando(t.cancelada_em)}</span><span>{t.cancelada_por_nome}{t.motivo_cancelamento ? `: ${t.motivo_cancelamento}` : ""}</span></div>}
      </section>
      {(t.pedido_origem_id || t.pedido_id) && <p className="pequeno"><Link href={`/pedidos/${t.pedido_origem_id ?? t.pedido_id}`}>Pedido ligado{t.pedido_numero ? ` nº ${t.pedido_numero}` : ""} →</Link></p>}

      {/* Separação: estoquista da origem */}
      {t.status === "solicitada" && t.opera_origem ? (
        <form action={separarTransferencia} className="painel">
          <input type="hidden" name="id" value={t.id} />
          <h2>Separar</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>Confira cada produto na prateleira. Separou menos? Ajuste a quantidade. Não tem? Marque "Não tem". O estoque só sai quando o envio for aprovado.</p>
          <div className="tabela"><table>
            <thead><tr><th>Produto</th><th className="num">Pedido</th><th className="num">Tem aqui</th><th>Separado</th><th>Não tem</th></tr></thead>
            <tbody>{itens.map((i) => (
              <tr key={i.produto_id}>
                <td>{i.nome}<div className="pequeno suave">{i.codigo}{i.gtin ? ` · ${i.gtin}` : ""}{i.marca ? ` · ${i.marca}` : ""}</div></td>
                <td className="num">{Number(i.quantidade_solicitada ?? i.quantidade_enviada).toLocaleString("pt-BR")}</td>
                <td className="num" style={i.saldo_origem < Number(i.quantidade_solicitada ?? 0) ? { color: "var(--erro)" } : undefined}>{i.saldo_origem.toLocaleString("pt-BR")}</td>
                <td><input name={`s:${i.produto_id}`} inputMode="decimal" style={{ width: 90 }} defaultValue={String(Math.min(Number(i.quantidade_enviada), Math.max(i.saldo_origem, 0)))} aria-label={`Separado de ${i.nome}`} /></td>
                <td><input type="checkbox" name={`f:${i.produto_id}`} defaultChecked={i.saldo_origem <= 0} aria-label={`Não tem ${i.nome}`} style={{ width: "auto" }} /></td>
              </tr>))}</tbody>
          </table></div>
          <button className="principal">Separação conferida</button>
        </form>
      ) : (
        <section className="painel">
          <h2>Itens</h2>
          <div className="tabela"><table>
            <thead><tr><th>Produto</th><th className="num">Pedido</th><th className="num">Separado / enviado</th><th className="num">Recebido</th><th className="num">Custo un.</th></tr></thead>
            <tbody>{itens.map((i) => {
              const ped = Number(i.quantidade_solicitada ?? i.quantidade_enviada), env = Number(i.quantidade_enviada);
              return (
                <tr key={i.produto_id}>
                  <td>{i.nome}<div className="pequeno suave">{i.codigo}{i.marca ? ` · ${i.marca}` : ""}</div></td>
                  <td className="num">{ped.toLocaleString("pt-BR")}</td>
                  <td className="num">{t.status === "solicitada" ? "—" : env === 0 ? <Selo cor="erro">não tem</Selo> : <>{env.toLocaleString("pt-BR")}{env < ped && <span className="pequeno" style={{ color: "var(--aviso)" }}> (faltou {(ped - env).toLocaleString("pt-BR")})</span>}</>}</td>
                  <td className="num">{i.quantidade_recebida != null ? Number(i.quantidade_recebida).toLocaleString("pt-BR") : "—"}</td>
                  <td className="num">{i.custo_unit != null ? dinheiro(i.custo_unit, "BRL") : "—"}</td>
                </tr>);
            })}</tbody>
          </table></div>
          <p className="pequeno suave" style={{ margin: 0 }}>{pedidas.toLocaleString("pt-BR")} peças pedidas{t.status !== "solicitada" ? ` · ${enviadas.toLocaleString("pt-BR")} separadas` : ""}{t.valor_custo != null ? ` · custo enviado ${dinheiro(t.valor_custo, "BRL")}` : ""}</p>
        </section>
      )}
      {t.status === "solicitada" && !t.opera_origem && <div className="aviso-caixa">Aguardando o estoquista de {t.origem} separar.</div>}

      {t.status === "separada" && (t.aprova ? (
        <form action={aprovarTransferencia} className="painel" style={{ borderColor: "var(--marca)" }}>
          <input type="hidden" name="id" value={t.id} />
          <h2>Aprovar envio</h2>
          <p style={{ margin: 0 }}>{enviadas.toLocaleString("pt-BR")} peças separadas de {pedidas.toLocaleString("pt-BR")} pedidas. Ao aprovar, sai do estoque de {t.origem} e fica a caminho de {t.destino}.</p>
          <button className="principal">Aprovar e enviar</button>
        </form>
      ) : <div className="aviso-caixa">Separado. Aguardando o gerente (ou a encarregada) aprovar o envio.</div>)}

      {t.status === "enviada" && (t.recebe ? (
        <form action={receberSolicitacao} className="painel" style={{ borderColor: "var(--ok)" }}>
          <input type="hidden" name="id" value={t.id} />
          <h2>Chegou? Confira e receba</h2>
          <div className="tabela"><table>
            <thead><tr><th>Produto</th><th className="num">Enviado</th><th>Chegou</th></tr></thead>
            <tbody>{itens.filter((i) => Number(i.quantidade_enviada) > 0).map((i) => (
              <tr key={i.produto_id}><td>{i.nome}</td><td className="num">{Number(i.quantidade_enviada).toLocaleString("pt-BR")}</td>
                <td><input name={`r:${i.produto_id}`} inputMode="decimal" defaultValue={String(Number(i.quantidade_enviada))} style={{ width: 90 }} aria-label={`Chegou de ${i.nome}`} /></td></tr>))}</tbody>
          </table></div>
          <label>Observação<input name="obs" maxLength={300} /></label>
          <button className="principal">Receber no estoque de {t.destino}</button>
        </form>
      ) : <div className="aviso-caixa">A caminho de {t.destino}.</div>)}

      {podeCancelar && (
        <details className="painel">
          <summary>Cancelar este pedido</summary>
          <form action={cancelarSolicitacao} className="linha" style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={t.id} />
            <input name="motivo" maxLength={300} placeholder="Motivo (opcional)" />
            <button className="perigo">Cancelar</button>
          </form>
        </details>
      )}
    </>
  );
}
