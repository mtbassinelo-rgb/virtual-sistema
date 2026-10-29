import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, dataHora } from "@/lib/formato";
import { Avisos } from "../../../avisos";
import { Conferencia, type ItemSep } from "./conferencia";

export const metadata = { title: "Separar pedido" };

/** Quando a caixa do fornecedor tem menos de 12: quantas caixas físicas mandar. */
function caixasFisicas(qtd: number, cx: number | null): string {
  if (!cx || cx >= 12 || qtd <= 0) return "";
  const n = Math.floor(qtd / cx), r = qtd - n * cx;
  return `enviar ${n ? `${n} cx de ${cx}` : ""}${n && r ? " + " : ""}${r ? `${r} un` : ""}`;
}

export default async function SepararPedido({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string }> }) {
  const u = await exigirUsuario();
  const { id } = await params;
  const f = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await comUsuario(u.id, async (c) => {
    const p = (await c.query(`select p.id, p.criado_em, p.bling_numero, p.previsao_envio, p.observacoes, p.status_comercial::text status, p.separacao_conferida_em,
        p.caixas_separadas, p.origem, cl.nome cliente, v.nome vendedora, dep.nome deposito, app.pode_operar_deposito(p.deposito_id) opera
      from app.pedidos p left join app.clientes cl on cl.id = p.cliente_id join app.vendedoras v on v.id = p.vendedora_id
      left join app.depositos dep on dep.id = p.deposito_id where p.id = $1`, [id])).rows[0];
    if (!p) return null;
    const itens = (await c.query(`select i.id, i.codigo, i.descricao, i.quantidade::float quantidade, pr.unidades_caixa_fornecedor cx, o.nome origem
        from app.pedido_itens i left join app.produtos pr on pr.id = i.produto_id left join app.depositos o on o.id = i.deposito_origem_id
       where i.pedido_id = $1 order by pr.marca nulls last, i.descricao`, [id])).rows;
    const feito = (await c.query("select item_id, descricao, pedida::float pedida, separada::float separada from app.pedido_separacao where pedido_id = $1 order by descricao", [id])).rows;
    return { p, itens, feito };
  });
  if (!d) notFound();
  const { p } = d;
  // Pedido reaberto (a vendedora acrescentou depois de separado): o estoquista separa só a diferença
  const ja = new Map<string, number>(d.feito.map((x) => [String(x.item_id), Number(x.separada)]));
  const reaberto = !p.separacao_conferida_em && d.feito.length > 0;
  const todos = d.itens.map((i) => {
    const jaSep = Math.min(ja.get(i.id) ?? 0, Number(i.quantidade));
    const falta = Number(i.quantidade) - jaSep;
    return { id: i.id, codigo: i.codigo, descricao: i.descricao, quantidade: falta, total: Number(i.quantidade), jaSep,
      caixa: i.cx ? Number(i.cx) : null, dica: caixasFisicas(falta, i.cx ? Number(i.cx) : null), origem: i.origem };
  });
  const itens: ItemSep[] = todos.filter((i) => i.quantidade > 0);
  const prontos = todos.filter((i) => i.quantidade <= 0);
  const podeSeparar = p.opera && p.status === "em_separacao" && !p.separacao_conferida_em && p.origem !== "bling";

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/estoque/separacao">Área do estoquista</Link> / Separar</div>
          <h1>{p.cliente ?? "Cliente avulso"}</h1>
          <p>Vendedora: <b>{p.vendedora}</b> · pedido de {dataHora(p.criado_em)}{p.bling_numero ? ` · nº ${p.bling_numero}` : ""}
            {p.previsao_envio ? <> · enviar até <b>{data(p.previsao_envio)}</b></> : ""} · {p.deposito}</p>
          {p.observacoes && <div className="aviso-caixa pequeno"><b>Observação:</b> {p.observacoes}</div>}
        </div>
      </section>
      <Avisos erro={f.erro} />

      {podeSeparar ? (
        <>
          {reaberto ? (
            <div className="aviso-caixa aviso">
              <b>A vendedora acrescentou produtos depois da separação.</b> Separe <b>só o que aparece abaixo</b> (a diferença), informe as
              <b> caixas a mais</b> e confirme: o sistema junta com o que você já tinha separado{p.caixas_separadas ? ` (${p.caixas_separadas} caixa(s))` : ""}.
            </div>
          ) : (
            <div className="aviso-caixa info pequeno">Pegue cada produto na prateleira e digite <b>quantas unidades separou</b>. Se não tem, marque <b>Não tem</b>.
              No fim, informe o <b>total de caixas</b> e confirme.</div>
          )}
          <Conferencia pedidoId={p.id} itens={itens} acrescimo={reaberto} />
          {reaberto && prontos.length > 0 && (
            <details className="painel">
              <summary>Já separado antes ({prontos.length} item(ns)): não precisa mexer</summary>
              <ul className="lista-simples pequeno">{prontos.map((i) => <li key={i.id}>{i.jaSep}× {i.descricao}</li>)}</ul>
            </details>
          )}
        </>
      ) : p.separacao_conferida_em ? (
        <section className="painel">
          <h2>Separação confirmada em {dataHora(p.separacao_conferida_em)}{p.caixas_separadas != null ? ` · ${p.caixas_separadas} caixa(s)` : ""}</h2>
          {d.feito.length > 0 && (
            <div className="tabela"><table style={{ minWidth: 0 }}>
              <thead><tr><th>Produto</th><th className="num">Pedido</th><th className="num">Separado</th></tr></thead>
              <tbody>{d.feito.map((x) => (
                <tr key={x.descricao} style={x.separada < x.pedida ? { background: "var(--erro-suave)" } : undefined}>
                  <td>{x.descricao}</td><td className="num">{x.pedida}</td><td className="num">{x.separada}{x.separada < x.pedida ? ` (faltou ${x.pedida - x.separada})` : ""}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
      ) : (
        <div className="painel">Este pedido não está para separar{!p.opera ? " por você (você não é responsável por este estoque)" : ""}.</div>
      )}
    </>
  );
}
