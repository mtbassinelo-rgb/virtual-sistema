import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro } from "@/lib/formato";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { Avisos, Selo } from "../../avisos";
import { SITUACAO_TRANSF } from "@/lib/transferencias";

export const metadata = { title: "Pedidos entre unidades" };

const VISOES = [
  { k: "abertas", t: "Em andamento", w: "t.status in ('solicitada','separada','rascunho','enviada')" },
  { k: "separar", t: "A separar", w: "t.status = 'solicitada'" },
  { k: "aprovar", t: "A aprovar", w: "t.status = 'separada'" },
  { k: "caminho", t: "A caminho", w: "t.status = 'enviada'" },
  { k: "recebidas", t: "Recebidas", w: "t.status in ('recebida','recebida_com_divergencia')" },
  { k: "todas", t: "Todas", w: "true" },
] as const;

export default async function Transferencias({ searchParams }: { searchParams: Promise<{ ver?: string; mes?: string; ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const visao = VISOES.find((v) => v.k === f.ver) ?? VISOES[0];
  const { atual } = await unidadeSistema(u);
  const mes = /^\d{4}-\d{2}$/.test(f.mes ?? "") ? f.mes! : new Date().toISOString().slice(0, 7);
  const d = await comUsuario(u.id, async (c) => {
    const vals: unknown[] = [];
    let filtro = visao.w as string;
    if (atual) { vals.push(atual.id); filtro += ` and (t.origem_id = $${vals.length} or t.destino_id = $${vals.length})`; }
    const lista = (await c.query(`select t.*, o.nome origem, de.nome destino, app.nome_usuario(t.criada_por) criada_por_nome,
        (select count(*) from app.transferencia_itens i where i.transferencia_id = t.id)::int itens,
        (select coalesce(sum(coalesce(i.quantidade_solicitada, i.quantidade_enviada)), 0) from app.transferencia_itens i where i.transferencia_id = t.id) pecas,
        (select coalesce(sum(i.quantidade_enviada), 0) from app.transferencia_itens i where i.transferencia_id = t.id) enviadas
      from app.transferencias t join app.depositos o on o.id = t.origem_id join app.depositos de on de.id = t.destino_id
      where ${filtro} order by t.criada_em desc limit 300`, vals)).rows;
    // total transferido no mês (custo) por destino
    const mesTotais = (await c.query(`select de.nome destino, count(*)::int n, coalesce(sum(t.valor_custo), 0) custo,
        coalesce(sum((select sum(coalesce(i.quantidade_recebida, i.quantidade_enviada)) from app.transferencia_itens i where i.transferencia_id = t.id)), 0) pecas
      from app.transferencias t join app.depositos de on de.id = t.destino_id
      where t.status in ('enviada','recebida','recebida_com_divergencia') and date_trunc('month', t.enviada_em) = $1::date
      group by 1 order by 1`, [`${mes}-01`])).rows;
    const aprova = Boolean((await c.query("select app.pode_aprovar_transferencia() a")).rows[0]?.a);
    return { lista, mesTotais, aprova };
  });
  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/estoque">Estoque</Link> / Pedidos entre unidades</div>
          <h1>Pedidos entre unidades{atual ? ` · ${atual.nome}` : ""}</h1>
          <p>A unidade que precisa pede; o estoquista da outra separa e marca o que tem e o que falta; o gerente (ou a encarregada) aprova o envio;
            quem recebe confere a chegada. A mercadoria enviada conta como custo da unidade que recebe.</p>
        </div>
        <div className="linha">
          <Link className="botao principal" href="/estoque/transferencias/nova">Pedir mercadoria</Link>
          <Link className="botao" href="/estoque/separacao">Área do estoquista</Link>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <section className="painel">
        <div className="linha entre" style={{ flexWrap: "wrap" }}>
          <h2>Transferido no mês (custo)</h2>
          <form className="linha" method="get"><input type="hidden" name="ver" value={visao.k} /><input type="month" name="mes" defaultValue={mes} aria-label="Mês" /><button>Ver</button></form>
        </div>
        {d.mesTotais.length === 0 ? <p className="suave" style={{ margin: 0 }}>Nada enviado neste mês.</p> : (
          <div className="indicadores">{d.mesTotais.map((x) => (
            <div key={x.destino} className="indicador"><span className="rotulo">Para {x.destino}</span><span className="valor num">{dinheiro(x.custo, "BRL")}</span>
              <span className="pequeno suave">{x.n} envio(s) · {Number(x.pecas).toLocaleString("pt-BR")} peças</span></div>))}</div>
        )}
      </section>

      <nav className="filtros">{VISOES.map((v) => <Link key={v.k} href={`/estoque/transferencias?ver=${v.k}&mes=${mes}`} className={v.k === visao.k ? "ativo" : ""}>{v.t}</Link>)}</nav>
      <section className="painel">
        {d.lista.length === 0 ? <div className="vazio">Nenhum pedido aqui.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Nº</th><th>Pedido em</th><th>De → Para</th><th>Itens</th><th>Situação</th><th>Custo</th><th>Quem pediu</th><th></th></tr></thead>
            <tbody>{d.lista.map((t) => {
              const s = SITUACAO_TRANSF[t.status] ?? { t: t.status, cor: "" };
              const acao = t.status === "solicitada" ? "Separar" : t.status === "separada" && d.aprova ? "Aprovar" : t.status === "enviada" ? "Receber" : "Ver";
              return (
                <tr key={t.id}>
                  <td className="num">#{t.numero}</td>
                  <td>{new Date(t.criada_em).toLocaleDateString("pt-BR")}</td>
                  <td>{t.origem} → <b>{t.destino}</b>{t.observacao && <div className="pequeno suave">{t.observacao}</div>}</td>
                  <td className="num">{t.itens} prod. · {Number(t.pecas).toLocaleString("pt-BR")} pç{["separada", "enviada", "recebida", "recebida_com_divergencia"].includes(t.status) && Number(t.enviadas) < Number(t.pecas) && <div className="pequeno" style={{ color: "var(--aviso)" }}>{Number(t.enviadas).toLocaleString("pt-BR")} separadas</div>}</td>
                  <td><Selo cor={s.cor}>{s.t}</Selo></td>
                  <td className="num">{t.valor_custo != null ? dinheiro(t.valor_custo, "BRL") : "—"}</td>
                  <td>{t.criada_por_nome ?? "—"}</td>
                  <td><Link className={acao === "Ver" ? "" : "botao"} href={`/estoque/transferencias/${t.id}`}>{acao}</Link></td>
                </tr>);
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
