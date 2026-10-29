import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, dinheiro, type Moeda } from "@/lib/formato";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { Selo } from "../../avisos";

export const metadata = { title: "Vendas por produto" };

const PERIODOS: [string, string][] = [["30", "30 dias"], ["90", "90 dias"], ["180", "6 meses"], ["365", "1 ano"], ["todos", "Tudo"]];

type Venda = {
  pedido_id: string; data_pedido: string; cliente_id: string | null; cliente: string | null; vendedora: string | null; canal: string | null;
  moeda: Moeda; bling_numero: string | null; quantidade: number; preco: string | null; total: string | null; kit: string | null;
};

/** Vendas de um produto: quem comprou, quanto, a que preço e quando (inclui as vendas dentro de kits). */
export default async function VendasProduto({ searchParams }: { searchParams: Promise<{ p?: string; dias?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const dias = PERIODOS.some(([k]) => k === f.dias) ? f.dias! : "90";
  const { atual } = await unidadeSistema(u);
  const busca = (f.p ?? "").trim();

  const d = await comUsuario(u.id, async (c) => {
    const opcoes = (await c.query("select codigo, nome from app.produtos where ativo and codigo is not null order by nome")).rows as { codigo: string; nome: string }[];
    if (!busca) return { opcoes, prod: null, achados: [] as { id: string; codigo: string; nome: string }[], vendas: [] as Venda[] };
    const cod = busca.split(" · ")[0].trim();
    let prod = (await c.query("select id, codigo, nome, marca, tipo from app.produtos where codigo = $1", [cod])).rows[0] ?? null;
    let achados: { id: string; codigo: string; nome: string }[] = [];
    if (!prod) {
      achados = (await c.query(`select id, codigo, nome from app.produtos
          where nome ilike $1 or codigo ilike $1 or marca ilike $1 order by ativo desc, nome limit 30`, [`%${busca}%`])).rows;
      if (achados.length === 1) prod = (await c.query("select id, codigo, nome, marca, tipo from app.produtos where id = $1", [achados[0].id])).rows[0];
    }
    if (!prod) return { opcoes, prod: null, achados, vendas: [] as Venda[] };
    const vendas = (await c.query(`
      select p.id pedido_id, p.data_pedido, p.cliente_id, cl.nome cliente, v.nome vendedora, p.canal, p.moeda, p.bling_numero,
             (i.quantidade * coalesce(k.quantidade, 1))::float quantidade,
             case when k.kit_id is null then i.preco_unitario end preco,
             case when k.kit_id is null then i.total end total,
             case when k.kit_id is not null then i.descricao end kit
        from app.pedido_itens i
        join app.pedidos p on p.id = i.pedido_id
        left join app.kit_componentes k on k.kit_id = i.produto_id and k.componente_id = $1
        left join app.clientes cl on cl.id = p.cliente_id
        left join app.vendedoras v on v.id = p.vendedora_id
       where (i.produto_id = $1 or k.kit_id is not null)
         and app.conta_como_venda(p.status_comercial)
         and ($2::int is null or p.data_pedido >= current_date - $2::int)
         and ($3::uuid is null or p.deposito_id = $3::uuid)
       order by p.data_pedido desc, p.criado_em desc
       limit 2000`, [prod.id, dias === "todos" ? null : Number(dias), atual?.id ?? null])).rows as Venda[];
    return { opcoes, prod, achados, vendas };
  });

  const { prod, vendas } = d;
  const quem = (x: Venda) => x.cliente ?? (x.canal ? x.canal.replace("_", " ") : "Sem cliente");
  // por cliente (ou canal, nos marketplaces) e moeda
  const porCliente = new Map<string, { nome: string; cliente_id: string | null; moeda: Moeda; pedidos: Set<string>; qtd: number; valor: number; ultima: string; ultimoPreco: string | null }>();
  for (const x of vendas) {
    const chave = `${x.cliente_id ?? quem(x)}|${x.moeda}`;
    const g = porCliente.get(chave) ?? { nome: quem(x), cliente_id: x.cliente_id, moeda: x.moeda, pedidos: new Set(), qtd: 0, valor: 0, ultima: x.data_pedido, ultimoPreco: x.preco };
    g.pedidos.add(x.pedido_id); g.qtd += Number(x.quantidade); g.valor += Number(x.total ?? 0);
    porCliente.set(chave, g);
  }
  const clientes = [...porCliente.values()].sort((a, b) => b.qtd - a.qtd);
  const totQtd = vendas.reduce((s, x) => s + Number(x.quantidade), 0);
  const totMoeda = (m: Moeda) => vendas.filter((x) => x.moeda === m).reduce((s, x) => s + Number(x.total ?? 0), 0);
  const pedidos = new Set(vendas.map((x) => x.pedido_id)).size;
  const q = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const href = (o: Record<string, string>) => "/produtos/vendas?" + new URLSearchParams({ ...(busca ? { p: busca } : {}), dias, ...o });

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/produtos">Produtos</Link> / Vendas por produto</div>
          <h1>Vendas por produto</h1>
          <p>Escolha um produto para ver quem comprou, quanto, a que preço e quando{atual ? <> em <b>{atual.nome}</b></> : ""}. Conta também as vendas dentro de kits.</p>
        </div>
      </section>

      <section className="painel">
        <form className="linha" style={{ alignItems: "end" }}>
          <label style={{ flex: 1, minWidth: 240 }}>Produto
            <input name="p" list="lista-prod-vendas" defaultValue={busca} placeholder="Digite o nome, código ou marca" autoComplete="off" autoFocus={!busca} />
          </label>
          <input type="hidden" name="dias" value={dias} />
          <button className="principal">Ver vendas</button>
          <datalist id="lista-prod-vendas">{d.opcoes.map((o) => <option key={o.codigo} value={`${o.codigo} · ${o.nome}`} />)}</datalist>
        </form>
        <nav className="filtros" style={{ marginTop: 10 }}>
          {PERIODOS.map(([k, t]) => <Link key={k} href={href({ dias: k })} className={dias === k ? "ativo" : ""}>{t}</Link>)}
        </nav>
      </section>

      {busca && !prod && (
        <section className="painel">
          {d.achados.length === 0 ? <div className="vazio">Nenhum produto com "{busca}".</div> : (
            <>
              <h2>Qual destes?</h2>
              <ul className="lista-simples">{d.achados.map((a) => (
                <li key={a.id}><Link href={href({ p: `${a.codigo} · ${a.nome}` })}>{a.nome}</Link> <span className="pequeno suave">{a.codigo}</span></li>))}
              </ul>
            </>
          )}
        </section>
      )}

      {prod && (
        <>
          <section className="painel">
            <div className="linha entre">
              <h2 style={{ margin: 0 }}>{prod.nome} <span className="pequeno suave">{prod.codigo}{prod.marca ? ` · ${prod.marca}` : ""}</span></h2>
              <Link className="pequeno" href={`/produtos/${prod.id}`}>abrir produto →</Link>
            </div>
            <div className="indicadores" style={{ marginTop: 10 }}>
              <div className="indicador"><span className="rotulo">Unidades vendidas</span><span className="valor num">{q(totQtd)}</span></div>
              <div className="indicador"><span className="rotulo">Pedidos</span><span className="valor num">{pedidos}</span></div>
              <div className="indicador"><span className="rotulo">Clientes</span><span className="valor num">{clientes.length}</span></div>
              {totMoeda("GS") > 0 && <div className="indicador"><span className="rotulo">Vendido em Gs</span><span className="valor num">{dinheiro(totMoeda("GS"), "GS")}</span></div>}
              {totMoeda("BRL") > 0 && <div className="indicador"><span className="rotulo">Vendido em R$</span><span className="valor num">{dinheiro(totMoeda("BRL"), "BRL")}</span></div>}
            </div>
            {vendas.some((x) => x.kit) && <p className="pequeno suave" style={{ margin: 0 }}>Vendas dentro de kits entram na quantidade; o valor delas fica no kit (não somado aqui).</p>}
          </section>

          {vendas.length === 0 ? <div className="painel vazio">Nenhuma venda deste produto no período.</div> : (
            <>
              <section className="painel">
                <h2>Por cliente</h2>
                <div className="tabela cartoes"><table>
                  <thead><tr><th>Cliente</th><th className="num">Pedidos</th><th className="num">Unidades</th><th className="num">Valor</th><th className="num">Último preço</th><th>Última compra</th></tr></thead>
                  <tbody>{clientes.map((g) => (
                    <tr key={`${g.nome}-${g.moeda}`}>
                      <td className="titulo">{g.cliente_id ? <Link href={`/clientes/${g.cliente_id}`}>{g.nome}</Link> : <span style={{ textTransform: "capitalize" }}>{g.nome}</span>}</td>
                      <td className="num" data-rot="Pedidos">{g.pedidos.size}</td>
                      <td className="num" data-rot="Unidades"><b>{q(g.qtd)}</b></td>
                      <td className="num" data-rot="Valor">{g.valor ? dinheiro(g.valor, g.moeda) : "—"}</td>
                      <td className="num" data-rot="Último preço">{g.ultimoPreco != null ? dinheiro(g.ultimoPreco, g.moeda) : "kit"}</td>
                      <td data-rot="Última compra">{data(g.ultima)}</td>
                    </tr>))}</tbody>
                </table></div>
              </section>

              <section className="painel">
                <h2>Últimas vendas</h2>
                <div className="tabela cartoes"><table>
                  <thead><tr><th>Data</th><th>Cliente</th><th>Vendedora</th><th className="num">Qtd</th><th className="num">Preço</th><th className="num">Total</th><th></th></tr></thead>
                  <tbody>{vendas.slice(0, 100).map((x, k) => (
                    <tr key={`${x.pedido_id}-${k}`}>
                      <td data-rot="Data">{data(x.data_pedido)}</td>
                      <td className="titulo"><span style={{ textTransform: x.cliente ? undefined : "capitalize" }}>{quem(x)}</span>
                        {x.kit && <> <Selo cor="info">no {x.kit}</Selo></>}</td>
                      <td data-rot="Vendedora">{x.vendedora ?? "—"}</td>
                      <td className="num" data-rot="Qtd">{q(Number(x.quantidade))}</td>
                      <td className="num" data-rot="Preço">{x.preco != null ? dinheiro(x.preco, x.moeda) : "—"}</td>
                      <td className="num" data-rot="Total">{x.total != null ? dinheiro(x.total, x.moeda) : "—"}</td>
                      <td className="acao"><Link className="botao" href={`/pedidos/${x.pedido_id}`}>{x.bling_numero ? `Pedido ${x.bling_numero}` : "Ver pedido"}</Link></td>
                    </tr>))}</tbody>
                </table></div>
                {vendas.length > 100 && <p className="pequeno suave">Mostrando as 100 mais recentes de {vendas.length}. O quadro por cliente soma todas.</p>}
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
