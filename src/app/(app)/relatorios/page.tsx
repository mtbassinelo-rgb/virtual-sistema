import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, data, hojeISO, type Moeda } from "@/lib/formato";
import { Barra, Selo } from "../avisos";

export const metadata = { title: "Relatórios" };

const ABAS = [
  { k: "vendas", t: "Resumo de vendas", d: "Quanto foi vendido no período, por vendedora e por mês." },
  { k: "produtos", t: "Mais vendidos", d: "Os produtos que mais saíram no período, em quantidade." },
  { k: "estoque", t: "Estoque baixo e parado", d: "O que está acabando, esgotado ou sem venda há muito tempo." },
  { k: "catalogo", t: "Saúde do catálogo", d: "Produtos sem preço, sem foto ou sem peças por caixa: o que falta arrumar na loja." },
] as const;

type Soma = { moeda: Moeda; pedidos: number; vendido: string; recebido: string; saldo: string };

export default async function Relatorios({ searchParams }: { searchParams: Promise<{ aba?: string; de?: string; ate?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const aba = ABAS.find((a) => a.k === f.aba) ?? ABAS[0];
  const de = /^\d{4}-\d{2}-\d{2}$/.test(f.de ?? "") ? f.de! : hojeISO(-30);
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(f.ate ?? "") ? f.ate! : hojeISO();
  const url = (m: Record<string, string>) => `/relatorios?${new URLSearchParams({ aba: aba.k, de, ate, ...m })}`;

  const d = await comUsuario(u.id, async (c) => {
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
      return { g };
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

  const maxMes = (moeda: string) => Math.max(1, ...((d as { meses?: { moeda: string; vendido: string }[] }).meses ?? []).filter((m) => m.moeda === moeda).map((m) => Number(m.vendido)));

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Relatórios</h1>
          <p>{aba.d}</p>
        </div>
        {(aba.k === "vendas" || aba.k === "produtos") && (
          <form className="linha" method="get">
            <input type="hidden" name="aba" value={aba.k} />
            <label>De<input type="date" name="de" defaultValue={de} /></label>
            <label>Até<input type="date" name="ate" defaultValue={ate} /></label>
            <button className="principal">Ver período</button>
          </form>
        )}
      </section>
      <nav className="abas" aria-label="Relatórios">
        {ABAS.map((a) => <a key={a.k} href={url({ aba: a.k })} aria-current={a.k === aba.k ? "page" : undefined}>{a.t}</a>)}
      </nav>
      {(aba.k === "vendas" || aba.k === "produtos") && (
        <div className="filtros">
          {[["Últimos 7 dias", hojeISO(-7)], ["Últimos 30 dias", hojeISO(-30)], ["Últimos 90 dias", hojeISO(-90)], ["Este ano", `${new Date().getFullYear()}-01-01`]].map(([t, ini]) => (
            <a key={t} href={url({ de: ini, ate: hojeISO() })} className={de === ini && ate === hojeISO() ? "ativo" : ""}>{t}</a>
          ))}
        </div>
      )}

      {aba.k === "vendas" && "totais" in d && (
        <>
          {d.totais.length === 0 && <div className="painel vazio">Nenhuma venda entre {data(de)} e {data(ate)}.</div>}
          {d.totais.map((t) => (
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
              {d.vend.length === 0 ? <div className="vazio">Sem vendas no período.</div> : (
                <div className="grafico-barras">{d.vend.map((v) => {
                  const max = Math.max(...d.vend.filter((x) => x.moeda === v.moeda).map((x) => Number(x.vendido)), 1);
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
              {d.canais.length === 0 ? <div className="vazio">Sem vendas no período.</div> : (
                <div className="tabela"><table style={{ minWidth: 0 }}><tbody>{d.canais.map((c) => (
                  <tr key={c.canal + c.moeda}><td>{c.canal}</td><td className="num">{c.pedidos} ped.</td><td className="num">{dinheiro(c.vendido, c.moeda)}</td></tr>
                ))}</tbody></table></div>
              )}
            </section>
          </div>
          <section className="painel">
            <h2>Últimos 6 meses</h2>
            {["GS", "BRL"].map((m) => {
              const lin = d.meses.filter((x) => x.moeda === m);
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

      {aba.k === "produtos" && "itens" in d && (
        <div className="duas-colunas">
          <section className="painel">
            <h2>Produtos mais vendidos</h2>
            {d.itens.length === 0 ? <div className="vazio">Nenhum item vendido no período.</div> : (
              <div className="tabela"><table>
                <thead><tr><th>#</th><th>Produto</th><th>Qtd.</th><th>Pedidos</th><th>Total</th></tr></thead>
                <tbody>{d.itens.map((i, n) => (
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
            <div className="grafico-barras">{d.marcas.map((m) => (
              <div key={m.marca} className="lin">
                <span>{m.marca}</span>
                <Barra percentual={(Number(m.qtd) / Math.max(1, Number(d.marcas[0]?.qtd ?? 1))) * 100} />
                <span className="num">{Number(m.qtd).toLocaleString("pt-BR")}</span>
              </div>))}
            </div>
          </section>
        </div>
      )}

      {aba.k === "estoque" && "g" in d && (
        <section className="painel">
          <p className="suave pequeno" style={{ margin: 0 }}>Baixo: acaba em poucos dias no ritmo atual. Esgotado: saldo zero. Parado: tem estoque mas quase não vende. Os números usam as vendas enviadas ou entregues.</p>
          {d.g.length === 0 ? <div className="vazio">Nada acabando nem parado. Tudo certo.</div> : (
            <div className="tabela"><table>
              <thead><tr><th>Situação</th><th>Produto</th><th>Depósito</th><th>Saldo</th><th>Vendido 30 dias</th><th>Dura</th><th>Última venda</th></tr></thead>
              <tbody>{d.g.map((x) => (
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
      )}

      {aba.k === "catalogo" && "cat" in d && (
        <>
          <section className="atalhos">
            <Link className="atalho" href="/produtos/precos-rapido?mostrar=sem-preco"><b>{d.cat.sem_preco}</b><span>sem nenhum preço · arrumar agora</span></Link>
            <Link className="atalho" href="/produtos/precos-rapido?mostrar=incompleto"><b>{Math.max(d.cat.sem_gs, d.cat.sem_brl)}</b><span>falta preço em Gs ({d.cat.sem_gs}) ou em R$ ({d.cat.sem_brl})</span></Link>
            <Link className="atalho" href="/produtos?filtro=sem-foto"><b>{d.cat.sem_foto}</b><span>sem foto</span></Link>
            <Link className="atalho" href="/produtos/precos-rapido?mostrar=sem-caixa"><b>{d.cat.sem_caixa}</b><span>sem peças por caixa</span></Link>
            {d.fotos > 0 && <Link className="atalho" href="/produtos/fotos"><b>{d.fotos}</b><span>fotos do catálogo para conferir</span></Link>}
            <Link className="atalho" href="/produtos?filtro=inativos"><b>{d.cat.inativos}</b><span>inativos (não aparecem na loja)</span></Link>
          </section>
          <section className="painel">
            <h2>Por marca</h2>
            <p className="suave pequeno" style={{ margin: 0 }}>{d.cat.ativos} produtos ativos. Clique na marca para preencher os preços que faltam.</p>
            <div className="tabela"><table>
              <thead><tr><th>Marca</th><th>Ativos</th><th>Sem preço</th><th>Sem foto</th><th>Pronto para vender</th></tr></thead>
              <tbody>{d.marcas.map((m) => {
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
