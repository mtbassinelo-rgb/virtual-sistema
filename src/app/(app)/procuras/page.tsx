import Link from "next/link";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, dataHora } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import { marcarAvisado, marcarVisto, registrarProcura } from "./acoes";
import { linkWhatsApp } from "@/lib/formato";

export const metadata = { title: "Procurados sem estoque" };

const ORIGEM: Record<string, string> = { site: "Site (visitante)", portal: "Cliente na loja", vendedora: "Vendedora", pedido: "Tirado do pedido" };

export default async function Procuras({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; dias?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const gestao = ehGestao(u);
  const dias = [30, 90, 365].includes(Number(f.dias)) ? Number(f.dias) : 90;
  const d = await comUsuario(u.id, async (c) => ({
    marcas: gestao ? (await c.query(
      `select coalesce(nullif(p.marca, ''), 'Sem marca / não cadastrado') as marca,
              count(*)::int as pedidos,
              count(distinct coalesce(q.cliente_id::text, q.contato_whatsapp, q.criado_por::text, q.id::text))::int as interessados,
              coalesce(sum(q.quantidade), count(*))::numeric as unidades,
              string_agg(distinct coalesce(p.nome, q.descricao), ' · ') as produtos
         from app.procuras q left join app.produtos p on p.id = q.produto_id
        where q.criado_em >= now() - interval '7 days'
        group by 1 order by unidades desc, pedidos desc`)).rows as { marca: string; pedidos: number; interessados: number; unidades: string; produtos: string }[] : [],
    resumo: gestao ? (await c.query(
      `select r.* from app.v_procuras_resumo r where r.ultima >= now() - make_interval(days => $1)
        order by r.novos > 0 desc, r.interessados desc, r.quantidade desc nulls last, r.ultima desc limit 300`, [dias])).rows : [],
    recentes: (await c.query(
      `select q.*, coalesce(p.nome, q.descricao) produto, c.nome cliente, u.nome quem
         from app.procuras q left join app.produtos p on p.id = q.produto_id
         left join app.clientes c on c.id = q.cliente_id left join app.usuarios u on u.id = q.criado_por
        order by q.criado_em desc limit 50`)).rows,
    chegaram: (await c.query("select * from app.procuras_chegaram()")).rows as { id: string; produto: string; quantidade: string | null; cliente: string | null; whatsapp: string | null; vendedora: string | null; criado_em: string; estoque: string }[],
    produtos: (await c.query("select codigo, nome from app.produtos where ativo and not marketplace order by nome limit 3000")).rows,
    clientes: (await c.query("select id, nome from app.clientes where mesclado_em is null order by nome limit 2000")).rows,
  }));

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Procurados sem estoque</h1>
          <p>{gestao
            ? "Produtos que clientes pediram e não tínhamos: pelo site (botão \"Quero este produto\" nos esgotados) ou registrados pelas vendedoras. Use para as próximas compras."
            : "Cliente pediu um produto que não temos? Registre aqui: o gerente vê e leva em conta nas próximas compras."}</p>
        </div>
        {gestao && <nav className="linha">{[30, 90, 365].map((n) => (
          <Link key={n} className={`botao${n === dias ? " principal" : ""}`} href={`/procuras?dias=${n}`}>{n === 365 ? "1 ano" : `${n} dias`}</Link>))}</nav>}
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      {d.chegaram.length > 0 && (
        <section className="painel" style={{ borderColor: "#8fd3a6" }}>
          <h2 style={{ margin: 0 }}>Chegou! Avise o cliente ({d.chegaram.length})</h2>
          <p className="suave pequeno" style={{ margin: 0 }}>Estes clientes pediram um produto que estava esgotado e agora tem estoque. Clique no WhatsApp: a mensagem já vai escrita. Depois marque como avisado.</p>
          <div className="tabela"><table>
            <thead><tr><th>Produto</th><th>Cliente</th><th>Pediu em</th><th className="num">Estoque</th><th></th></tr></thead>
            <tbody>{d.chegaram.map((x) => {
              const msg = `Olá${x.cliente ? `, ${x.cliente.split(" ")[0]}` : ""}! Chegou o ${x.produto} que você pediu${x.quantidade ? ` (${Number(x.quantidade)} un.)` : ""}. Quer que eu separe para você?`;
              const zap = x.whatsapp ? linkWhatsApp(x.whatsapp, msg) : null;
              return (
                <tr key={x.id}>
                  <td>{x.produto}</td>
                  <td>{x.cliente ?? "—"}{x.vendedora && <div className="pequeno suave">{x.vendedora}</div>}</td>
                  <td>{data(x.criado_em)}</td>
                  <td className="num">{Number(x.estoque).toLocaleString("pt-BR")}</td>
                  <td className="linha" style={{ flexWrap: "nowrap" }}>
                    {zap ? <a className="botao whatsapp" href={zap} target="_blank" rel="noopener noreferrer">WhatsApp</a> : <span className="suave pequeno">sem WhatsApp</span>}
                    <form action={marcarAvisado}><input type="hidden" name="id" value={x.id} /><button className="discreto">Avisado</button></form>
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </section>
      )}

      <section className="painel">
        <h2>Registrar pedido de produto que não temos</h2>
        <form action={registrarProcura} className="campos">
          <label className="largo">Produto (escolha da lista ou escreva, se não for cadastrado)
            <input name="produto" list="lista-produtos" required maxLength={200} placeholder="Ex.: shampoo matizador 1 litro" />
          </label>
          <datalist id="lista-produtos">{d.produtos.map((p) => <option key={p.codigo} value={`${p.codigo} · ${p.nome}`} />)}</datalist>
          <label>Quantidade<input name="quantidade" type="number" min={1} step={1} /></label>
          <label>Cliente (opcional)
            <select name="cliente_id" defaultValue="">
              <option value="">—</option>
              {d.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label className="largo">Observação<input name="observacao" maxLength={500} placeholder="Ex.: quer a cor 7.1, paga à vista" /></label>
          <button className="principal">Registrar</button>
        </form>
      </section>

      {gestao && (
        <section className="painel">
          <h2>Por marca · últimos 7 dias (para a compra de quarta/quinta)</h2>
          <p className="suave pequeno">Soma o que os clientes pediram e não tínhamos: registros das vendedoras, itens tirados de pedidos e pedidos do site.
            Quando uma marca juntar volume suficiente, vale incluir na compra da semana.</p>
          {d.marcas.length === 0 ? <div className="vazio">Nenhum pedido nos últimos 7 dias.</div> : (
            <div className="tabela"><table>
              <thead><tr><th>Marca</th><th className="num">Unidades</th><th className="num">Clientes</th><th className="num">Pedidos</th><th>Produtos</th></tr></thead>
              <tbody>{d.marcas.map((m) => (
                <tr key={m.marca}>
                  <td><b>{m.marca}</b></td>
                  <td className="num">{Number(m.unidades).toLocaleString("pt-BR")}</td>
                  <td className="num">{m.interessados}</td>
                  <td className="num">{m.pedidos}</td>
                  <td className="pequeno">{m.produtos}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
      )}

      {gestao && (
        <section className="painel">
          <h2>Por produto · últimos {dias === 365 ? "12 meses" : `${dias} dias`}</h2>
          {d.resumo.length === 0 ? <div className="vazio">Ninguém pediu produto sem estoque neste período.</div> : (
            <div className="tabela"><table>
              <thead><tr><th>Produto</th><th>Pedidos</th><th>Interessados</th><th>Quantidade</th><th>Estoque hoje</th><th>Último</th><th></th></tr></thead>
              <tbody>{d.resumo.map((r) => (
                <tr key={r.chave}>
                  <td>{r.produto_id ? <Link href={`/produtos/${r.produto_id}`}>{r.produto}</Link> : <>{r.produto} <Selo cor="aviso">não cadastrado</Selo></>}
                    <div className="pequeno suave">{[r.codigo, r.marca, r.fornecedor].filter(Boolean).join(" · ")}</div></td>
                  <td className="num">{r.pedidos}{r.novos > 0 && <> <Selo cor="marca">{r.novos} novo{r.novos > 1 ? "s" : ""}</Selo></>}</td>
                  <td className="num">{r.interessados}</td>
                  <td className="num">{r.quantidade == null ? "—" : Number(r.quantidade).toLocaleString("pt-BR")}</td>
                  <td className="num">{r.produto_id ? Number(r.estoque_atual).toLocaleString("pt-BR") : "—"}</td>
                  <td className="num">{data(r.ultima)}</td>
                  <td>{r.novos > 0 && <form action={marcarVisto}><input type="hidden" name="chave" value={r.chave} /><button className="pequeno">Marcar como visto</button></form>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
      )}

      <section className="painel">
        <h2>{gestao ? "Últimos pedidos" : "Seus registros"}</h2>
        {d.recentes.length === 0 ? <div className="vazio">Nenhum registro ainda.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Quando</th><th>Produto</th><th>Qtd.</th><th>Quem pediu</th><th>Origem</th></tr></thead>
            <tbody>{d.recentes.map((q) => (
              <tr key={q.id}>
                <td className="num">{dataHora(q.criado_em)}</td>
                <td>{q.produto}{q.observacao && <div className="pequeno suave">{q.observacao}</div>}</td>
                <td className="num">{q.quantidade == null ? "—" : Number(q.quantidade).toLocaleString("pt-BR")}</td>
                <td>{q.cliente ?? q.contato_nome ?? "—"}{q.contato_whatsapp && <div className="pequeno suave">{q.contato_whatsapp}</div>}</td>
                <td>{ORIGEM[q.origem] ?? q.origem}{q.quem && <div className="pequeno suave">{q.quem}</div>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
