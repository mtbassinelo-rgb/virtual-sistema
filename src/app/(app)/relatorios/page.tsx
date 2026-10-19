import Link from "next/link";
import type { PoolClient } from "pg";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, data, hojeISO, nomeMes, pct, type Moeda } from "@/lib/formato";
import { Barra, Selo } from "../avisos";

export const metadata = { title: "Relatórios" };

const ABAS = [
  { k: "vendas", t: "Resumo de vendas", d: "Quanto foi vendido no período, por vendedora e por mês." },
  { k: "produtos", t: "Mais vendidos", d: "Os produtos que mais saíram no período, em quantidade." },
  { k: "estoque", t: "Estoque baixo e parado", d: "O que está acabando, esgotado ou sem venda há muito tempo." },
  { k: "catalogo", t: "Saúde do catálogo", d: "Produtos sem preço, sem foto ou sem peças por caixa: o que falta arrumar na loja." },
  { k: "lucro", t: "Lucro e rankings", d: "Quem vendeu e lucrou mais e menos, e os produtos que mais e menos dão lucro.", gestao: true },
  { k: "resultado", t: "Resultado do mês", d: "Venda, custo da mercadoria, lucro bruto, despesas e resultado, mês a mês.", gestao: true },
  { k: "site", t: "Funil do site", d: "Visitas, carrinhos e pedidos do site, o que os clientes procuram e o que não acham.", gestao: true },
  { k: "envios", t: "Envios ao Paraguai", d: "Caixas e produtos que saíram por semana para clientes do Paraguai, e o custo do passeiro.", gestao: true },
] as const;
const COM_PERIODO = ["vendas", "produtos", "lucro", "envios", "site"];

type Soma = { moeda: Moeda; pedidos: number; vendido: string; recebido: string; saldo: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Lin = Record<string, any>;
type Dados = {
  totais?: Soma[]; vend?: Lin[]; meses?: Lin[]; canais?: Lin[]; itens?: Lin[]; marcas?: Lin[]; g?: Lin[]; minimo?: Lin[]; cat?: Lin; fotos?: number;
  luc?: Lin[]; rank?: Lin[]; topLucro?: Lin[]; baixaMargem?: Lin[]; poucaVenda?: Lin[]; campeoes?: Lin[]; resultado?: Lin[]; envios?: Lin[];
  porCategoria?: Lin[]; custoVolume?: number; funil?: Lin; buscas?: Lin[]; semResultado?: Lin[]; maisCarrinho?: Lin[]; dias?: Lin[];
};

export default async function Relatorios({ searchParams }: { searchParams: Promise<{ aba?: string; de?: string; ate?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const visiveis = ABAS.filter((a) => !("gestao" in a) || ehGestao(u));
  const aba = visiveis.find((a) => a.k === f.aba) ?? visiveis[0];
  const de = /^\d{4}-\d{2}-\d{2}$/.test(f.de ?? "") ? f.de! : hojeISO(-30);
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(f.ate ?? "") ? f.ate! : hojeISO();
  const url = (m: Record<string, string>) => `/relatorios?${new URLSearchParams({ aba: aba.k, de, ate, ...m })}`;

  const d: Dados = await comUsuario(u.id, async (c): Promise<Dados> => {
    if (aba.k === "lucro") return carregarLucro(c, de, ate);
    if (aba.k === "site") {
      const per = [de, ate];
      const funil = (await c.query(`select
          (select count(distinct sessao) from app.eventos_site where tipo = 'visita' and em::date between $1 and $2)::int visitas,
          (select count(distinct sessao) from app.eventos_site where tipo = 'carrinho' and em::date between $1 and $2)::int carrinhos,
          (select count(*) from app.pedidos where origem = 'portal' and data_pedido between $1 and $2)::int pedidos_clientes,
          (select count(*) from app.pedidos_site where criado_em::date between $1 and $2)::int pedidos_visitantes,
          (select count(*) from app.cadastros_site where criado_em::date between $1 and $2)::int cadastros`, per)).rows[0];
      const buscas = (await c.query(`select termo, count(*)::int n, round(avg(resultados))::int res from app.eventos_site
          where tipo = 'busca' and termo is not null and em::date between $1 and $2 group by 1 order by 2 desc limit 20`, per)).rows;
      const semResultado = (await c.query(`select termo, count(*)::int n from app.eventos_site
          where tipo = 'busca' and resultados = 0 and termo is not null and em::date between $1 and $2 group by 1 order by 2 desc limit 20`, per)).rows;
      const maisCarrinho = (await c.query(`select p.id, p.nome, count(distinct e.sessao)::int n from app.eventos_site e join app.produtos p on p.id = e.produto_id
          where e.tipo = 'carrinho' and e.em::date between $1 and $2 group by 1, 2 order by 3 desc limit 20`, per)).rows;
      const dias = (await c.query(`select em::date dia, count(distinct sessao) filter (where tipo = 'visita')::int visitas,
          count(distinct sessao) filter (where tipo = 'carrinho')::int carrinhos from app.eventos_site
          where em::date between $1 and $2 group by 1 order by 1`, per)).rows;
      return { funil, buscas, semResultado, maisCarrinho, dias };
    }
    if (aba.k === "resultado") return carregarResultado(c);
    if (aba.k === "envios") return carregarEnvios(c, de, ate);
    if (aba.k === "vendas") {
      const per = `p.status_comercial <> 'cancelado' and p.data_pedido between $1::date and $2::date`;
      const totais = (await c.query(`select p.moeda, count(*)::int pedidos, sum(p.valor_total) vendido, sum(p.recebido) recebido, sum(p.saldo) saldo
        from app.v_pedidos p where ${per} group by p.moeda order by p.moeda desc`, [de, ate])).rows as Soma[];
      const vend = (await c.query(`select p.vendedora_nome as nome, p.moeda, count(*)::int pedidos, sum(p.valor_total) vendido
        from app.v_pedidos p where ${per} group by 1, 2 order by p.moeda desc, vendido desc`, [de, ate])).rows;
      const meses = (await c.query(`select to_char(date_trunc('month', p.data_pedido), 'YYYY-MM') mes, p.moeda, sum(p.valor_total) vendido, count(*)::int pedidos
        from app.v_pedidos p where p.status_comercial <> 'cancelado' and p.data_pedido >= date_trunc('month', current_date) - interval '5 months'
        group by 1, 2 order by 1`)).rows;
      const canais = (await c.query(`select coalesce(cn.nome, p.canal) canal, p.moeda, count(*)::int pedidos, sum(p.valor_total) vendido
        from app.v_pedidos p left join app.canais cn on cn.codigo = p.canal where ${per} group by 1, 2 order by vendido desc`, [de, ate])).rows;
      return { totais, vend, meses, canais };
    }
    if (aba.k === "produtos") {
      const itens = (await c.query(`select coalesce(pr.nome, i.descricao) nome, pr.id, pr.marca, p.moeda, sum(i.quantidade)::numeric qtd, sum(i.total) total, count(distinct p.id)::int pedidos
        from app.pedido_itens i join app.pedidos p on p.id = i.pedido_id left join app.produtos pr on pr.id = i.produto_id
        where p.status_comercial <> 'cancelado' and p.data_pedido between $1::date and $2::date
        group by 1, 2, 3, 4 order by qtd desc limit 40`, [de, ate])).rows;
      const marcas = (await c.query(`select coalesce(pr.marca, 'Sem marca') marca, sum(i.quantidade)::numeric qtd
        from app.pedido_itens i join app.pedidos p on p.id = i.pedido_id left join app.produtos pr on pr.id = i.produto_id
        where p.status_comercial <> 'cancelado' and p.data_pedido between $1::date and $2::date group by 1 order by qtd desc limit 12`, [de, ate])).rows;
      return { itens, marcas };
    }
    if (aba.k === "estoque") {
      const g = (await c.query(`select produto_id, produto, codigo, deposito, saldo, vendido_30, ultima_venda, cobertura_dias, situacao
        from app.v_giro where situacao in ('esgotado','baixo','parado') order by
        case situacao when 'baixo' then 1 when 'esgotado' then 2 else 3 end, cobertura_dias nulls last, produto limit 300`)).rows;
      const minimo = (await c.query(`select produto_id, codigo, produto, marca, fornecedor, unidades_caixa, estoque_minimo, saldo, faltam, vendido_30
        from app.v_abaixo_minimo order by marca nulls last, faltam desc, produto`)).rows;
      return { g, minimo };
    }
    const cat = (await c.query(`select
        count(*) filter (where ativo)::int ativos,
        count(*) filter (where ativo and not exists (select 1 from app.precos z where z.produto_id = p.id))::int sem_preco,
        count(*) filter (where ativo and not exists (select 1 from app.precos z where z.produto_id = p.id and z.tabela = 'py_normal'))::int sem_gs,
        count(*) filter (where ativo and not exists (select 1 from app.precos z where z.produto_id = p.id and z.tabela = 'br_normal'))::int sem_brl,
        count(*) filter (where ativo and foto is null)::int sem_foto,
        count(*) filter (where ativo and unidades_caixa is null)::int sem_caixa,
        count(*) filter (where not ativo)::int inativos
      from app.produtos p`)).rows[0];
    const marcas = (await c.query(`select coalesce(marca, 'Sem marca') marca, count(*)::int total,
        count(*) filter (where not exists (select 1 from app.precos z where z.produto_id = p.id))::int sem_preco,
        count(*) filter (where foto is null)::int sem_foto
      from app.produtos p where ativo group by 1 order by sem_preco desc, total desc`)).rows;
    const fotos = ehGestao(u) ? Number((await c.query("select count(*) n from app.fotos_catalogo where status = 'pendente'")).rows[0].n) : 0;
    return { cat, marcas, fotos };
  });

  const { totais = [], vend = [], meses = [], canais = [], itens = [], marcas = [], g = [], minimo = [], cat, fotos = 0 } = d;
  const maxMes = (moeda: string) => Math.max(1, ...meses.filter((m) => m.moeda === moeda).map((m) => Number(m.vendido)));

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Relatórios</h1>
          <p>{aba.d}</p>
        </div>
        {COM_PERIODO.includes(aba.k) && (
          <form className="linha" method="get">
            <input type="hidden" name="aba" value={aba.k} />
            <label>De<input type="date" name="de" defaultValue={de} /></label>
            <label>Até<input type="date" name="ate" defaultValue={ate} /></label>
            <button className="principal">Ver período</button>
          </form>
        )}
      </section>
      <nav className="abas" aria-label="Relatórios">
        {visiveis.map((a) => <a key={a.k} href={url({ aba: a.k })} aria-current={a.k === aba.k ? "page" : undefined}>{a.t}</a>)}
      </nav>
      {COM_PERIODO.includes(aba.k) && (
        <div className="filtros">
          {[["Últimos 7 dias", hojeISO(-7)], ["Últimos 30 dias", hojeISO(-30)], ["Últimos 90 dias", hojeISO(-90)], ["Este ano", `${new Date().getFullYear()}-01-01`]].map(([t, ini]) => (
            <a key={t} href={url({ de: ini, ate: hojeISO() })} className={de === ini && ate === hojeISO() ? "ativo" : ""}>{t}</a>
          ))}
        </div>
      )}

      {aba.k === "vendas" && (
        <>
          {totais.length === 0 && <div className="painel vazio">Nenhuma venda entre {data(de)} e {data(ate)}.</div>}
          {totais.map((t) => (
            <section key={t.moeda} className="indicadores">
              <div className="indicador"><span className="rotulo">Vendido ({t.moeda === "GS" ? "Gs" : "R$"})</span><span className="valor">{dinheiro(t.vendido, t.moeda)}</span></div>
              <div className="indicador"><span className="rotulo">Pedidos</span><span className="valor">{t.pedidos}</span></div>
              <div className="indicador"><span className="rotulo">Ticket médio</span><span className="valor">{dinheiro(Number(t.vendido) / Math.max(1, t.pedidos), t.moeda)}</span></div>
              <div className="indicador"><span className="rotulo">Recebido</span><span className="valor">{dinheiro(t.recebido, t.moeda)}</span></div>
              <div className="indicador"><span className="rotulo">A receber</span><span className="valor">{dinheiro(t.saldo, t.moeda)}</span></div>
            </section>
          ))}
          <div className="duas-colunas">
            <section className="painel">
              <h2>Por vendedora</h2>
              {vend.length === 0 ? <div className="vazio">Sem vendas no período.</div> : (
                <div className="grafico-barras">{vend.map((v) => {
                  const max = Math.max(...vend.filter((x) => x.moeda === v.moeda).map((x) => Number(x.vendido)), 1);
                  return (
                    <div key={v.nome + v.moeda} className="lin">
                      <span>{v.nome} <span className="suave pequeno">({v.pedidos})</span></span>
                      <Barra percentual={(Number(v.vendido) / max) * 100} />
                      <span className="num">{dinheiro(v.vendido, v.moeda)}</span>
                    </div>);
                })}</div>
              )}
            </section>
            <section className="painel">
              <h2>Por canal</h2>
              {canais.length === 0 ? <div className="vazio">Sem vendas no período.</div> : (
                <div className="tabela"><table style={{ minWidth: 0 }}><tbody>{canais.map((c) => (
                  <tr key={c.canal + c.moeda}><td>{c.canal}</td><td className="num">{c.pedidos} ped.</td><td className="num">{dinheiro(c.vendido, c.moeda)}</td></tr>
                ))}</tbody></table></div>
              )}
            </section>
          </div>
          <section className="painel">
            <h2>Últimos 6 meses</h2>
            {["GS", "BRL"].map((m) => {
              const lin = meses.filter((x) => x.moeda === m);
              if (!lin.length) return null;
              return (
                <div key={m} className="grafico-barras">
                  <div className="pequeno suave">{m === "GS" ? "Paraguai (Gs)" : "Brasil (R$)"}</div>
                  {lin.map((x) => (
                    <div key={x.mes} className="lin">
                      <span>{new Date(x.mes + "-15").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span>
                      <Barra percentual={(Number(x.vendido) / maxMes(m)) * 100} ok />
                      <span className="num">{dinheiro(x.vendido, m as Moeda)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        </>
      )}

      {aba.k === "produtos" && (
        <div className="duas-colunas">
          <section className="painel">
            <h2>Produtos mais vendidos</h2>
            {itens.length === 0 ? <div className="vazio">Nenhum item vendido no período.</div> : (
              <div className="tabela"><table>
                <thead><tr><th>#</th><th>Produto</th><th>Qtd.</th><th>Pedidos</th><th>Total</th></tr></thead>
                <tbody>{itens.map((i, n) => (
                  <tr key={(i.id ?? i.nome) + i.moeda}>
                    <td className="num suave">{n + 1}</td>
                    <td>{i.id ? <Link href={`/produtos/${i.id}`}>{i.nome}</Link> : i.nome}<div className="pequeno suave">{i.marca ?? ""}</div></td>
                    <td className="num">{Number(i.qtd).toLocaleString("pt-BR")}</td>
                    <td className="num">{i.pedidos}</td>
                    <td className="num">{dinheiro(i.total, i.moeda)}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </section>
          <section className="painel">
            <h2>Por marca (peças)</h2>
            <div className="grafico-barras">{marcas.map((m) => (
              <div key={m.marca} className="lin">
                <span>{m.marca}</span>
                <Barra percentual={(Number(m.qtd) / Math.max(1, Number(marcas[0]?.qtd ?? 1))) * 100} />
                <span className="num">{Number(m.qtd).toLocaleString("pt-BR")}</span>
              </div>))}
            </div>
          </section>
        </div>
      )}

      {aba.k === "estoque" && (<>
        <section className="painel">
          <div className="linha entre">
            <h2 style={{ margin: 0 }}>Para comprar: no estoque mínimo ou abaixo</h2>
            <div className="linha"><Link className="botao principal" href="/relatorios/compra">Planejar compra por marca</Link><Link className="botao" href="/produtos?filtro=sem-minimo">Definir estoque mínimo</Link></div>
          </div>
          <p className="suave pequeno" style={{ margin: 0 }}>Só aparecem produtos com estoque mínimo definido (na lista de Produtos, coluna Mínimo). “Comprar” é o que falta para voltar ao mínimo, arredondado para caixas fechadas quando o produto tem peças por caixa.</p>
          {minimo.length === 0 ? <div className="vazio">Nenhum produto abaixo do mínimo.</div> : (
            <div className="tabela"><table>
              <thead><tr><th>Produto</th><th>Marca / fornecedor</th><th className="num">Estoque</th><th className="num">Mínimo</th><th className="num">Comprar</th><th className="num">Vendido 30 dias</th></tr></thead>
              <tbody>{minimo.map((x) => {
                const faltam = Number(x.faltam), cx = Number(x.unidades_caixa) || 0;
                const caixas = cx > 0 ? Math.max(1, Math.ceil(faltam / cx)) : 0;
                return (
                  <tr key={x.produto_id}>
                    <td><Link href={`/produtos/${x.produto_id}`}>{x.produto}</Link><div className="pequeno suave">{x.codigo}</div></td>
                    <td>{x.marca ?? "—"}{x.fornecedor ? <div className="pequeno suave">{x.fornecedor}</div> : null}</td>
                    <td className="num"><span className={`estoque-num ${Number(x.saldo) <= 0 ? "zerado" : "baixo"}`}>{Number(x.saldo).toLocaleString("pt-BR")}</span></td>
                    <td className="num">{Number(x.estoque_minimo).toLocaleString("pt-BR")}</td>
                    <td className="num"><b>{cx > 0 ? `${caixas} cx (${(caixas * cx).toLocaleString("pt-BR")} un)` : `${Math.max(faltam, 1).toLocaleString("pt-BR")} un`}</b></td>
                    <td className="num">{Number(x.vendido_30).toLocaleString("pt-BR")}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </section>
        <section className="painel">
          <p className="suave pequeno" style={{ margin: 0 }}>Baixo: acaba em poucos dias no ritmo atual. Esgotado: saldo zero. Parado: tem estoque mas quase não vende. Os números usam as vendas enviadas ou entregues.</p>
          {g.length === 0 ? <div className="vazio">Nada acabando nem parado. Tudo certo.</div> : (
            <div className="tabela"><table>
              <thead><tr><th>Situação</th><th>Produto</th><th>Depósito</th><th>Saldo</th><th>Vendido 30 dias</th><th>Dura</th><th>Última venda</th></tr></thead>
              <tbody>{g.map((x) => (
                <tr key={x.produto_id + x.deposito}>
                  <td><Selo cor={x.situacao === "baixo" ? "aviso" : x.situacao === "esgotado" ? "erro" : ""}>{x.situacao}</Selo></td>
                  <td><Link href={`/produtos/${x.produto_id}`}>{x.produto}</Link><div className="pequeno suave">{x.codigo}</div></td>
                  <td>{x.deposito}</td>
                  <td className="num">{Number(x.saldo).toLocaleString("pt-BR")}</td>
                  <td className="num">{Number(x.vendido_30).toLocaleString("pt-BR")}</td>
                  <td className="num">{x.cobertura_dias != null ? `${x.cobertura_dias} dias` : "—"}</td>
                  <td className="num">{x.ultima_venda ? data(x.ultima_venda) : "—"}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
      </>)}

      {aba.k === "lucro" && <Lucro d={d} de={de} ate={ate} />}
      {aba.k === "resultado" && <Resultado d={d} />}
      {aba.k === "envios" && <Envios d={d} de={de} ate={ate} />}
      {aba.k === "site" && <Funil d={d} />}

      {aba.k === "catalogo" && cat && (
        <>
          <section className="atalhos">
            <Link className="atalho" href="/produtos/precos-rapido?mostrar=sem-preco"><b>{cat.sem_preco}</b><span>sem nenhum preço · arrumar agora</span></Link>
            <Link className="atalho" href="/produtos/precos-rapido?mostrar=incompleto"><b>{Math.max(cat.sem_gs, cat.sem_brl)}</b><span>falta preço em Gs ({cat.sem_gs}) ou em R$ ({cat.sem_brl})</span></Link>
            <Link className="atalho" href="/produtos?filtro=sem-foto"><b>{cat.sem_foto}</b><span>sem foto</span></Link>
            <Link className="atalho" href="/produtos/precos-rapido?mostrar=sem-caixa"><b>{cat.sem_caixa}</b><span>sem peças por caixa</span></Link>
            {fotos > 0 && <Link className="atalho" href="/produtos/fotos"><b>{fotos}</b><span>fotos do catálogo para conferir</span></Link>}
            <Link className="atalho" href="/produtos?filtro=inativos"><b>{cat.inativos}</b><span>inativos (não aparecem na loja)</span></Link>
          </section>
          <section className="painel">
            <h2>Por marca</h2>
            <p className="suave pequeno" style={{ margin: 0 }}>{cat.ativos} produtos ativos. Clique na marca para preencher os preços que faltam.</p>
            <div className="tabela"><table>
              <thead><tr><th>Marca</th><th>Ativos</th><th>Sem preço</th><th>Sem foto</th><th>Pronto para vender</th></tr></thead>
              <tbody>{marcas.map((m) => {
                const ok = Math.max(0, 100 - (m.sem_preco / Math.max(1, m.total)) * 100);
                return (
                  <tr key={m.marca}>
                    <td>{m.marca === "Sem marca" ? m.marca : <Link href={`/produtos/precos-rapido?mostrar=sem-preco&marca=${encodeURIComponent(m.marca)}`}>{m.marca}</Link>}</td>
                    <td className="num">{m.total}</td>
                    <td className="num">{m.sem_preco || "—"}</td>
                    <td className="num">{m.sem_foto || "—"}</td>
                    <td style={{ minWidth: 140 }}><Barra percentual={ok} ok={ok === 100} /></td>
                  </tr>);
              })}</tbody>
            </table></div>
          </section>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Lucro e rankings (gestão)
// ---------------------------------------------------------------------
async function carregarLucro(c: PoolClient, de: string, ate: string): Promise<Dados> {
  const per = [de, ate];
  const luc = (await c.query(`select moeda, sum(receita) receita, sum(receita) filter (where custo is not null) receita_com_custo,
      sum(custo) custo, sum(lucro) lucro, count(*) filter (where custo is null)::int sem_custo, count(*)::int itens
    from app.v_itens_lucro where data_pedido between $1::date and $2::date group by moeda order by moeda desc`, per)).rows;
  const rank = (await c.query(`with v as (
      select p.vendedora_id, p.moeda, count(*)::int pedidos, sum(p.valor_total) vendido
        from app.pedidos p where app.conta_como_venda(p.status_comercial) and p.data_pedido between $1::date and $2::date group by 1, 2),
    l as (select vendedora_id, moeda, sum(lucro) lucro, sum(receita) filter (where custo is not null) base
        from app.v_itens_lucro where data_pedido between $1::date and $2::date group by 1, 2)
    select ve.nome, v.moeda, v.pedidos, v.vendido, l.lucro, case when l.base > 0 then l.lucro / l.base end margem
      from v join app.vendedoras ve on ve.id = v.vendedora_id left join l on l.vendedora_id = v.vendedora_id and l.moeda = v.moeda
     order by v.moeda desc, v.vendido desc`, per)).rows;
  const porProduto = `select produto_id id, produto nome, codigo, marca, moeda, sum(quantidade) qtd, sum(receita) receita, sum(lucro) lucro,
      case when sum(receita) > 0 then sum(lucro) / sum(receita) end margem
    from app.v_itens_lucro where data_pedido between $1::date and $2::date and custo is not null group by 1, 2, 3, 4, 5`;
  const topLucro = (await c.query(`${porProduto} order by lucro desc limit 15`, per)).rows;
  const baixaMargem = (await c.query(`${porProduto} having sum(receita) > 0 order by margem asc, lucro asc limit 10`, per)).rows;
  const poucaVenda = (await c.query(`select p.id, p.nome, p.codigo, p.marca,
      coalesce((select sum(s.quantidade) from app.estoque_saldos s where s.produto_id = p.id), 0) estoque,
      coalesce((select sum(i.quantidade) from app.v_itens_lucro i where i.produto_id = p.id and i.data_pedido between $1::date and $2::date), 0) vendido
    from app.produtos p where p.ativo and p.tipo = 'simples'
      and exists (select 1 from app.estoque_saldos s where s.produto_id = p.id and s.quantidade > 0)
    order by vendido asc, estoque desc limit 15`, per)).rows;
  const campeoes = (await c.query(`select distinct on (mes, moeda) to_char(date_trunc('month', data_pedido), 'YYYY-MM') mes, moeda,
      produto nome, sum(quantidade) qtd, sum(lucro) lucro
    from app.v_itens_lucro where data_pedido >= date_trunc('month', current_date) - interval '5 months'
    group by 1, 2, 3 order by mes desc, moeda desc, sum(coalesce(lucro, 0)) desc, sum(quantidade) desc`)).rows;
  return { luc, rank, topLucro, baixaMargem, poucaVenda, campeoes };
}

function Lucro({ d, de, ate }: { d: Dados; de: string; ate: string }) {
  const { luc = [], rank = [], topLucro = [], baixaMargem = [], poucaVenda = [], campeoes = [] } = d;
  if (luc.length === 0) return <div className="painel vazio">Nenhuma venda confirmada entre {data(de)} e {data(ate)}.</div>;
  const semCusto = luc.reduce((t, l) => t + Number(l.sem_custo), 0);
  return (
    <>
      {luc.map((l) => (
        <section key={l.moeda} className="indicadores">
          <div className="indicador"><span className="rotulo">Vendido em itens ({l.moeda === "GS" ? "Gs" : "R$"})</span><span className="valor">{dinheiro(l.receita, l.moeda)}</span></div>
          <div className="indicador"><span className="rotulo">Custo da mercadoria</span><span className="valor">{dinheiro(l.custo, l.moeda)}</span></div>
          <div className="indicador"><span className="rotulo">Lucro bruto</span><span className="valor">{dinheiro(l.lucro, l.moeda)}</span></div>
          <div className="indicador"><span className="rotulo">Margem</span><span className="valor">{pct(Number(l.receita_com_custo) > 0 ? Number(l.lucro) / Number(l.receita_com_custo) : null)}</span></div>
        </section>
      ))}
      {semCusto > 0 && (
        <div className="aviso-caixa aviso">{semCusto} {semCusto === 1 ? "item vendido não tem" : "itens vendidos não têm"} custo cadastrado e
          ficaram fora do lucro. Cadastre o custo em <Link href="/produtos/precos-rapido">Editar preços rápido</Link>.</div>
      )}
      <section className="painel">
        <h2>Vendedoras: quem vendeu e lucrou mais</h2>
        {["GS", "BRL"].map((m) => {
          const lin = rank.filter((r) => r.moeda === m);
          if (!lin.length) return null;
          const maisLucro = [...lin].sort((a, b) => Number(b.lucro ?? 0) - Number(a.lucro ?? 0))[0];
          const menosLucro = [...lin].sort((a, b) => Number(a.lucro ?? 0) - Number(b.lucro ?? 0))[0];
          return (
            <div key={m} className="tabela">
              <table style={{ minWidth: 560 }}>
                <thead><tr><th>#</th><th>Vendedora ({m === "GS" ? "Gs" : "R$"})</th><th>Pedidos</th><th>Vendido</th><th>Lucro</th><th>Margem</th></tr></thead>
                <tbody>{lin.map((r, i) => (
                  <tr key={r.nome}>
                    <td className="num suave">{i + 1}</td>
                    <td>{r.nome}{" "}
                      {i === 0 && <Selo cor="ok">mais vendeu</Selo>}{" "}
                      {i === lin.length - 1 && lin.length > 1 && <Selo cor="aviso">menos vendeu</Selo>}{" "}
                      {r === maisLucro && r.lucro != null && <Selo cor="marca">mais lucro</Selo>}{" "}
                      {r === menosLucro && lin.length > 1 && r.lucro != null && <Selo>menos lucro</Selo>}
                    </td>
                    <td className="num">{r.pedidos}</td>
                    <td className="num">{dinheiro(r.vendido, m as Moeda)}</td>
                    <td className="num">{r.lucro == null ? "—" : dinheiro(r.lucro, m as Moeda)}</td>
                    <td className="num">{pct(r.margem)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          );
        })}
      </section>
      <div className="duas-colunas">
        <section className="painel">
          <h2>Produtos que mais dão lucro</h2>
          {topLucro.length === 0 ? <div className="vazio">Sem itens com custo cadastrado no período.</div> : (
            <div className="tabela"><table>
              <thead><tr><th>#</th><th>Produto</th><th>Qtd.</th><th>Lucro</th><th>Margem</th></tr></thead>
              <tbody>{topLucro.map((p, i) => (
                <tr key={(p.id ?? p.nome) + p.moeda}>
                  <td className="num suave">{i + 1}</td>
                  <td>{p.id ? <Link href={`/produtos/${p.id}`}>{p.nome}</Link> : p.nome}<div className="pequeno suave">{[p.codigo, p.marca].filter(Boolean).join(" · ")}</div></td>
                  <td className="num">{Number(p.qtd).toLocaleString("pt-BR")}</td>
                  <td className="num">{dinheiro(p.lucro, p.moeda)}</td>
                  <td className="num">{pct(p.margem)}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
        <section className="painel">
          <h2>Menor margem</h2>
          <p className="suave pequeno" style={{ margin: 0 }}>Vendem, mas deixam pouco. Vale revisar o preço ou o custo.</p>
          {baixaMargem.length === 0 ? <div className="vazio">Sem dados no período.</div> : (
            <div className="tabela"><table style={{ minWidth: 0 }}>
              <tbody>{baixaMargem.map((p) => (
                <tr key={(p.id ?? p.nome) + p.moeda}>
                  <td>{p.id ? <Link href={`/produtos/${p.id}`}>{p.nome}</Link> : p.nome}</td>
                  <td className="num"><Selo cor={Number(p.margem) < 0.2 ? "erro" : "aviso"}>{pct(p.margem)}</Selo></td>
                  <td className="num">{dinheiro(p.lucro, p.moeda)}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
      </div>
      <div className="duas-colunas">
        <section className="painel">
          <h2>Campeão de cada mês</h2>
          <p className="suave pequeno" style={{ margin: 0 }}>O produto que mais deu lucro em cada um dos últimos 6 meses.</p>
          <div className="tabela"><table style={{ minWidth: 0 }}>
            <thead><tr><th>Mês</th><th>Produto</th><th>Qtd.</th><th>Lucro</th></tr></thead>
            <tbody>{campeoes.map((x) => (
              <tr key={x.mes + x.moeda}>
                <td>{nomeMes(x.mes)} <span className="suave pequeno">{x.moeda === "GS" ? "Gs" : "R$"}</span></td>
                <td>{x.nome}</td>
                <td className="num">{Number(x.qtd).toLocaleString("pt-BR")}</td>
                <td className="num">{x.lucro == null ? "—" : dinheiro(x.lucro, x.moeda)}</td>
              </tr>))}</tbody>
          </table></div>
        </section>
        <section className="painel">
          <h2>Têm estoque e venderam pouco</h2>
          <div className="tabela"><table style={{ minWidth: 0 }}>
            <thead><tr><th>Produto</th><th>Vendido</th><th>Estoque</th></tr></thead>
            <tbody>{poucaVenda.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/produtos/${p.id}`}>{p.nome}</Link><div className="pequeno suave">{p.codigo}</div></td>
                <td className="num">{Number(p.vendido).toLocaleString("pt-BR")}</td>
                <td className="num">{Number(p.estoque).toLocaleString("pt-BR")}</td>
              </tr>))}</tbody>
          </table></div>
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Resultado do mês (gestão)
// ---------------------------------------------------------------------
async function carregarResultado(c: PoolClient): Promise<Dados> {
  const resultado = (await c.query(`select to_char(mes, 'YYYY-MM') mes, moeda, vendido, custo, lucro_bruto, itens_sem_custo, despesas, resultado
    from app.resultado_mensal((date_trunc('month', current_date) - interval '5 months')::date, current_date)
    order by mes desc, moeda desc`)).rows;
  const porCategoria = (await c.query(`select c.nome, d.moeda, sum(d.valor) total, c.operacional
    from app.despesas d join app.despesa_categorias c on c.codigo = d.categoria
   where d.competencia = date_trunc('month', current_date)::date group by c.nome, d.moeda, c.operacional, c.ordem order by c.ordem, d.moeda desc`)).rows;
  return { resultado, porCategoria };
}

function Resultado({ d }: { d: Dados }) {
  const { resultado = [], porCategoria = [] } = d;
  const linhas = resultado.filter((r) => Number(r.vendido) || Number(r.despesas));
  return (
    <>
      <section className="painel">
        <h2>Últimos 6 meses</h2>
        <p className="suave pequeno" style={{ margin: 0 }}>Lucro bruto = venda dos itens com custo cadastrado − custo da mercadoria. Despesas = contas lançadas no mês
          (aluguel, salários, passeiro…). Compra de mercadoria não entra aqui: ela vira custo quando o produto é vendido.</p>
        {linhas.length === 0 ? <div className="vazio">Ainda não há vendas nem despesas nos últimos 6 meses.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Mês</th><th>Vendido</th><th>Custo</th><th>Lucro bruto</th><th>Despesas</th><th>Resultado</th></tr></thead>
            <tbody>{linhas.map((r) => (
              <tr key={r.mes + r.moeda}>
                <td>{nomeMes(r.mes)} <span className="suave pequeno">{r.moeda === "GS" ? "Gs" : "R$"}</span>
                  {Number(r.itens_sem_custo) > 0 && <div className="pequeno suave">{r.itens_sem_custo} itens sem custo</div>}</td>
                <td className="num">{dinheiro(r.vendido, r.moeda)}</td>
                <td className="num">{dinheiro(r.custo, r.moeda)}</td>
                <td className="num">{dinheiro(r.lucro_bruto, r.moeda)}</td>
                <td className="num">{dinheiro(r.despesas, r.moeda)}</td>
                <td className="num"><Selo cor={Number(r.resultado) >= 0 ? "ok" : "erro"}>{dinheiro(r.resultado, r.moeda)}</Selo></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      <section className="painel">
        <div className="linha entre"><h2>Despesas deste mês por categoria</h2><Link className="botao" href="/despesas">Lançar e pagar contas</Link></div>
        {porCategoria.length === 0 ? <div className="vazio">Nenhuma despesa lançada neste mês.</div> : (
          <div className="tabela"><table style={{ minWidth: 0 }}><tbody>{porCategoria.map((x) => (
            <tr key={x.nome + x.moeda}>
              <td>{x.nome}{!x.operacional && <div className="pequeno suave">não entra no resultado (vira custo ao vender)</div>}</td>
              <td className="num">{dinheiro(x.total, x.moeda)}</td>
            </tr>))}</tbody></table></div>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------
// Envios ao Paraguai por semana (gestão)
// ---------------------------------------------------------------------
async function carregarEnvios(c: PoolClient, de: string, ate: string): Promise<Dados> {
  const envios = (await c.query("select * from app.envios_paraguai($1::date, $2::date)", [de, ate])).rows;
  const custoVolume = Number((await c.query("select app.param('passeiro_custo_volume') v")).rows[0].v ?? 0);
  return { envios, custoVolume };
}

function Funil({ d }: { d: Dados }) {
  const f = d.funil ?? {};
  const pedidos = Number(f.pedidos_clientes ?? 0) + Number(f.pedidos_visitantes ?? 0);
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
  const maxDia = Math.max(1, ...(d.dias ?? []).map((x) => Number(x.visitas)));
  return (
    <>
      <section className="atalhos">
        <div className="atalho"><b>{Number(f.visitas ?? 0).toLocaleString("pt-BR")}</b><span>visitas (navegadores)</span></div>
        <div className="atalho"><b>{Number(f.carrinhos ?? 0).toLocaleString("pt-BR")}</b><span>montaram carrinho · {pct(Number(f.carrinhos ?? 0), Number(f.visitas ?? 0))}</span></div>
        <div className="atalho"><b>{pedidos.toLocaleString("pt-BR")}</b><span>pedidos ({f.pedidos_clientes ?? 0} de clientes, {f.pedidos_visitantes ?? 0} de visitantes) · {pct(pedidos, Number(f.carrinhos ?? 0))} dos carrinhos</span></div>
        <div className="atalho"><b>{Number(f.cadastros ?? 0)}</b><span>cadastros novos</span></div>
      </section>
      <p className="suave pequeno" style={{ margin: 0 }}>Visitas e carrinhos começaram a ser contados em 18/10/2026. Quem monta carrinho e não envia aparece em Vendas → Carrinhos parados.</p>
      {(d.dias ?? []).length > 0 && (
        <section className="painel">
          <h2 style={{ margin: 0 }}>Visitas por dia</h2>
          <div className="grafico-barras">{(d.dias ?? []).map((x) => (
            <div key={String(x.dia)} className="lin"><span>{new Date(x.dia).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" })}</span>
              <Barra percentual={(Number(x.visitas) / maxDia) * 100} /><span className="num">{x.visitas} · {x.carrinhos} carr.</span></div>
          ))}</div>
        </section>
      )}
      <div className="grade-2">
        <section className="painel">
          <h2 style={{ margin: 0 }}>O que mais procuram</h2>
          {(d.buscas ?? []).length === 0 ? <div className="vazio">Nenhuma busca no período.</div> : (
            <div className="tabela"><table><thead><tr><th>Busca</th><th className="num">Vezes</th><th className="num">Achou</th></tr></thead>
              <tbody>{(d.buscas ?? []).map((x) => <tr key={x.termo}><td>{x.termo}</td><td className="num">{x.n}</td><td className="num">{x.res}</td></tr>)}</tbody></table></div>
          )}
        </section>
        <section className="painel">
          <h2 style={{ margin: 0 }}>Procuraram e não acharam</h2>
          <p className="suave pequeno" style={{ margin: 0 }}>Produto que talvez valha comprar, ou nome que o cliente usa e não está no cadastro.</p>
          {(d.semResultado ?? []).length === 0 ? <div className="vazio">Nada por aqui.</div> : (
            <div className="tabela"><table><thead><tr><th>Busca</th><th className="num">Vezes</th></tr></thead>
              <tbody>{(d.semResultado ?? []).map((x) => <tr key={x.termo}><td>{x.termo}</td><td className="num">{x.n}</td></tr>)}</tbody></table></div>
          )}
        </section>
      </div>
      <section className="painel">
        <h2 style={{ margin: 0 }}>Mais colocados no carrinho</h2>
        {(d.maisCarrinho ?? []).length === 0 ? <div className="vazio">Nenhum ainda.</div> : (
          <div className="tabela"><table><thead><tr><th>Produto</th><th className="num">Navegadores</th></tr></thead>
            <tbody>{(d.maisCarrinho ?? []).map((x) => <tr key={x.id}><td><Link href={`/produtos/${x.id}`}>{x.nome}</Link></td><td className="num">{x.n}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </>
  );
}

function Envios({ d, de, ate }: { d: Dados; de: string; ate: string }) {
  const { envios = [], custoVolume = 0 } = d;
  const soma = (k: string) => envios.reduce((t, e) => t + Number(e[k] ?? 0), 0);
  return (
    <>
      <section className="indicadores">
        <div className="indicador"><span className="rotulo">Volumes enviados</span><span className="valor">{soma("volumes").toLocaleString("pt-BR")}</span></div>
        <div className="indicador"><span className="rotulo">Caixas fechadas de produto</span><span className="valor">{soma("caixas_fechadas").toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</span></div>
        <div className="indicador"><span className="rotulo">Peças</span><span className="valor">{soma("pecas").toLocaleString("pt-BR")}</span></div>
        <div className="indicador"><span className="rotulo">Pago ao passeiro</span><span className="valor">{dinheiro(soma("passeiro_pago"), "GS")}</span></div>
        <div className="indicador"><span className="rotulo">Custo por volume (real)</span><span className="valor">{soma("volumes") ? dinheiro(soma("passeiro_pago") / soma("volumes"), "GS") : "—"}</span></div>
      </section>
      <section className="painel">
        <p className="suave pequeno" style={{ margin: 0 }}>Pedidos de clientes do Paraguai despachados entre {data(de)} e {data(ate)}, agrupados pela semana do envio.
          Volumes = caixas de envio informadas no pedido. Pago ao passeiro = despesas da categoria Passeiro pagas na semana.
          {custoVolume > 0 ? ` Custo estimado: ${dinheiro(custoVolume, "GS")} por volume.` : " Defina o custo estimado por volume em Parâmetros."}</p>
        {envios.length === 0 ? <div className="vazio">Nenhum envio para o Paraguai no período.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Semana de</th><th>Pedidos</th><th>Clientes</th><th>Volumes</th><th>Caixas fechadas</th><th>Peças</th><th>Custo estimado</th><th>Pago ao passeiro</th></tr></thead>
            <tbody>{envios.map((e) => (
              <tr key={e.semana}>
                <td>{data(e.semana)}</td>
                <td className="num">{e.pedidos}</td>
                <td className="num">{e.clientes}</td>
                <td className="num">{e.volumes}{e.pedidos_sem_volume > 0 && <div className="pequeno suave">{e.pedidos_sem_volume} sem volume informado</div>}</td>
                <td className="num">{Number(e.caixas_fechadas).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</td>
                <td className="num">{Number(e.pecas).toLocaleString("pt-BR")}</td>
                <td className="num">{dinheiro(e.custo_estimado, "GS")}</td>
                <td className="num">{dinheiro(e.passeiro_pago, "GS")}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
