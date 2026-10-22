import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, hojeISO, nomeMes } from "@/lib/formato";
import { Avisos, Barra, Selo } from "../avisos";
import { salvarMetaEmpresa } from "./acoes";

export const metadata = { title: "Painel financeiro" };

const ABAS = [
  { k: "resumo", t: "Resumo e DRE" }, { k: "marcas", t: "Lucro por marca" }, { k: "clientes", t: "Lucro por cliente" },
  { k: "compras", t: "Compras" }, { k: "metas", t: "Metas" },
] as const;
const PERIODOS = [{ k: "mes", t: "No mês", n: 1 }, { k: "3m", t: "3 meses", n: 3 }, { k: "12m", t: "12 meses", n: 12 }] as const;

/** "AAAA-MM" + n meses */
const somaMes = (m: string, n: number) => { const [a, b] = m.split("-").map(Number); const d = new Date(Date.UTC(a, b - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const fimMes = (m: string) => { const [a, b] = m.split("-").map(Number); return new Date(Date.UTC(a, b, 0)).toISOString().slice(0, 10); };
const R = (v: number | string | null | undefined) => dinheiro(Number(v ?? 0), "BRL");
const pct = (v: number | null) => v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const n = (v: unknown) => Number(v ?? 0);

type Mes = { mes: string; vendas: number; rc: number; custo: number; fixas: number; variaveis: number; compras: number; recebido: number; pago: number; vendas_gs: number };

export default async function Financeiro({ searchParams }: { searchParams: Promise<{ aba?: string; mes?: string; per?: string; ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) redirect("/");
  const f = await searchParams;
  const aba = ABAS.find((a) => a.k === f.aba)?.k ?? "resumo";
  const hoje = hojeISO();
  const mes = /^\d{4}-\d{2}$/.test(f.mes ?? "") ? f.mes! : hoje.slice(0, 7);
  const per = PERIODOS.find((p) => p.k === f.per) ?? PERIODOS[0];
  const ini12 = `${somaMes(mes, -11)}-01`, iniMes = `${mes}-01`, fim = fimMes(mes);
  const iniPer = `${somaMes(mes, 1 - per.n)}-01`;
  const gerir = u.perfil === "dono" || u.perfil === "gerente";

  const d = await comUsuario(u.id, async (c) => {
    const cambio = n((await c.query("select app.param('cambio_custo_gs') v")).rows[0]?.v) || 1300;
    const meses = (await c.query(`
      with m as (select generate_series($1::date, $2::date, interval '1 month')::date mes),
      it as (select date_trunc('month', data_pedido)::date mes, sum(receita_brl) vendas,
                    sum(receita_brl) filter (where custo_brl is not null) rc, sum(custo_brl) custo,
                    sum(receita) filter (where moeda = 'GS') vendas_gs
               from app.fin_itens($1, $3) group by 1),
      de as (select d.competencia mes,
                    sum(case when d.moeda = 'GS' then d.valor / coalesce(d.cambio, $4) else d.valor end) filter (where c.operacional and c.tipo = 'fixa') fixas,
                    sum(case when d.moeda = 'GS' then d.valor / coalesce(d.cambio, $4) else d.valor end) filter (where c.operacional and c.tipo = 'variavel') variaveis
               from app.despesas d join app.despesa_categorias c on c.codigo = d.categoria
              where d.competencia between $1 and $2 group by 1),
      co as (select date_trunc('month', data)::date mes, sum(total) compras from app.compras where data between $1 and $3 group by 1),
      re as (select date_trunc('month', pg.data)::date mes, sum(case when p.moeda = 'GS' then pg.valor / $4 else pg.valor end) recebido
               from app.pagamentos pg join app.pedidos p on p.id = pg.pedido_id
              where pg.status_conferencia = 'conferido' and pg.data between $1 and $3 group by 1),
      pa as (select date_trunc('month', pago_em)::date mes, sum(case when moeda = 'GS' then valor_pago / coalesce(cambio, $4) else valor_pago end) pago
               from app.despesas where pago_em between $1 and $3 group by 1)
      select to_char(m.mes, 'YYYY-MM') mes, coalesce(it.vendas, 0) vendas, coalesce(it.rc, 0) rc, coalesce(it.custo, 0) custo,
             coalesce(it.vendas_gs, 0) vendas_gs, coalesce(de.fixas, 0) fixas, coalesce(de.variaveis, 0) variaveis,
             coalesce(co.compras, 0) compras, coalesce(re.recebido, 0) recebido, coalesce(pa.pago, 0) pago
        from m left join it using (mes) left join de using (mes) left join co using (mes) left join re using (mes) left join pa using (mes)
       order by m.mes`, [ini12, iniMes, fim, cambio])).rows.map((r) => ({
        mes: r.mes, vendas: n(r.vendas), rc: n(r.rc), custo: n(r.custo), fixas: n(r.fixas), variaveis: n(r.variaveis),
        compras: n(r.compras), recebido: n(r.recebido), pago: n(r.pago), vendas_gs: n(r.vendas_gs) })) as Mes[];
    const saldos = (await c.query(`select
        (select coalesce(sum(case when moeda = 'GS' then saldo / $1 else saldo end), 0) from app.v_pedidos
          where status_comercial <> 'cancelado' and app.conta_como_venda(status_comercial) and saldo > 0) receber,
        (select coalesce(sum(case when moeda = 'GS' then saldo / $1 else saldo end), 0) from app.v_pedidos
          where status_comercial <> 'cancelado' and app.conta_como_venda(status_comercial) and saldo > 0 and vencimento < current_date) receber_vencido,
        (select coalesce(sum(case when moeda = 'GS' then valor / coalesce(cambio, $1) else valor end), 0) from app.despesas where pago_em is null) pagar,
        (select coalesce(sum(case when moeda = 'GS' then valor / coalesce(cambio, $1) else valor end), 0) from app.despesas where pago_em is null and vencimento < current_date) pagar_vencido,
        (select coalesce(sum(case when moeda = 'GS' then valor / coalesce(cambio, $1) else valor end), 0) from app.despesas where pago_em is null and vencimento between current_date and current_date + 30) pagar_30,
        (select coalesce(sum(case when moeda = 'GS' then saldo / $1 else saldo end), 0) from app.v_pedidos
          where status_comercial <> 'cancelado' and app.conta_como_venda(status_comercial) and saldo > 0 and vencimento between current_date and current_date + 30) receber_30,
        (select coalesce(sum(total), 0) from app.compras where status = 'a_caminho') a_caminho`, [cambio])).rows[0];
    const meta = (await c.query("select * from app.metas_empresa where mes = $1", [iniMes])).rows[0] ?? null;
    const metas = (await c.query("select to_char(mes, 'YYYY-MM') mes, vendas_brl, vendas_gs, compras_brl, lucro_brl from app.metas_empresa where mes between $1 and $2", [ini12, iniMes])).rows;
    const marcas = aba === "marcas" || aba === "resumo" ? (await c.query(`
      with v as (select marca, sum(receita_brl) vendas, sum(receita_brl) filter (where custo_brl is not null) rc, sum(custo_brl) custo,
                        sum(receita_brl) filter (where custo_brl is null) sem_custo, count(distinct pedido_id) pedidos, count(distinct cliente_id) clientes
                   from app.fin_itens($1, $2) group by marca),
      co as (select coalesce(nullif(trim(marca), ''), 'Sem marca') marca, sum(total) compras from app.compras where data between $1 and $2 group by 1)
      select coalesce(v.marca, co.marca) marca, coalesce(v.vendas, 0) vendas, coalesce(v.rc, 0) rc, coalesce(v.custo, 0) custo,
             coalesce(v.sem_custo, 0) sem_custo, coalesce(v.pedidos, 0) pedidos, coalesce(v.clientes, 0) clientes, coalesce(co.compras, 0) compras
        from v full join co on co.marca = v.marca`, [iniPer, fim])).rows.map((r) => ({ ...r, vendas: n(r.vendas), rc: n(r.rc), custo: n(r.custo),
          sem_custo: n(r.sem_custo), compras: n(r.compras), lucro: n(r.rc) - n(r.custo) })) : [];
    const clientes = aba === "clientes" || aba === "resumo" ? (await c.query(`
      select x.cliente_id, cl.nome, vd.nome vendedora, cl.pais, sum(x.receita_brl) vendas, sum(x.receita_brl) filter (where x.custo_brl is not null) rc,
             sum(x.custo_brl) custo, count(distinct x.pedido_id) pedidos
        from app.fin_itens($1, $2) x join app.clientes cl on cl.id = x.cliente_id join app.vendedoras vd on vd.id = cl.vendedora_id
       group by 1, 2, 3, 4`, [iniPer, fim])).rows.map((r) => ({ ...r, vendas: n(r.vendas), rc: n(r.rc), custo: n(r.custo), lucro: n(r.rc) - n(r.custo) })) : [];
    const compras = aba === "compras" ? {
      porMarca: (await c.query(`select coalesce(nullif(trim(marca), ''), 'Sem marca') marca, to_char(date_trunc('month', data), 'YYYY-MM') mes, sum(total) total
                                  from app.compras where data between $1 and $2 group by 1, 2`, [ini12, fim])).rows,
      notas: (await c.query(`select c.id, c.data, c.nfe, c.marca, c.status, c.total, f.nome fornecedor,
            (select coalesce(sum(valor), 0) from app.despesas d where d.compra_id = c.id and d.pago_em is null) em_aberto,
            (select count(*) from app.despesas d where d.compra_id = c.id)::int contas
          from app.compras c join app.fornecedores f on f.id = c.fornecedor_id where c.data between $1 and $2 order by c.data desc limit 200`, [iniPer, fim])).rows,
      fornecedores: (await c.query(`select f.nome, count(*)::int notas, sum(c.total) total from app.compras c join app.fornecedores f on f.id = c.fornecedor_id
          where c.data between $1 and $2 group by 1 order by 3 desc limit 15`, [iniPer, fim])).rows,
    } : null;
    return { cambio, meses, saldos, meta, metas, marcas, clientes, compras };
  });

  const atual = d.meses[d.meses.length - 1];
  const lucroBruto = (m: Mes) => m.rc - m.custo;
  const mc = (m: Mes) => lucroBruto(m) - m.variaveis;
  const resultado = (m: Mes) => mc(m) - m.fixas;
  // ponto de equilíbrio: custo fixo ÷ margem de contribuição (% sobre o que tem custo), base últimos 3 meses
  const base = d.meses.slice(-3).filter((m) => m.rc > 0);
  const mcPct = base.length ? base.reduce((s, m) => s + mc(m), 0) / base.reduce((s, m) => s + m.rc, 0) : null;
  const fixosBase = d.meses.slice(-4, -1).filter((m) => m.fixas > 0);
  const fixoMes = atual.fixas > 0 ? atual.fixas : fixosBase.length ? fixosBase.reduce((s, m) => s + m.fixas, 0) / fixosBase.length : 0;
  const pe = mcPct && mcPct > 0 ? fixoMes / mcPct : null;
  const mesAtual = mes === hoje.slice(0, 7);
  const diaHoje = Number(hoje.slice(8, 10)), diasMes = Number(fim.slice(8, 10));
  const projecao = mesAtual && diaHoje > 0 ? (atual.vendas / diaHoje) * diasMes : atual.vendas;
  const lucroProj = mesAtual && diaHoje > 0 && mcPct != null ? projecao * mcPct - fixoMes : resultado(atual);
  const meta = d.meta;
  const href = (o: Record<string, string>) => "/financeiro?" + new URLSearchParams({ aba, mes, per: per.k, ...o }).toString();

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Painel financeiro</h1>
          <p>Tudo em R$ (Gs convertido pelo câmbio de custo, hoje {d.cambio.toLocaleString("pt-BR")} Gs/R$). Lucro = venda − custo do produto; resultado = lucro − despesas do mês.</p>
        </div>
        <form className="linha" method="get">
          <input type="hidden" name="aba" value={aba} /><input type="hidden" name="per" value={per.k} />
          <label>Mês<input type="month" name="mes" defaultValue={mes} /></label>
          <button>Ver</button>
        </form>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <section className="indicadores">
        <div className="indicador"><span className="rotulo">Vendas {nomeMes(mes)}</span><span className="valor num">{R(atual.vendas)}</span>
          {mesAtual && <span className="pequeno suave">projeção do mês: {R(projecao)}</span>}</div>
        <div className="indicador"><span className="rotulo">Lucro bruto · margem</span><span className="valor num">{R(lucroBruto(atual))}</span>
          <span className="pequeno suave">{pct(atual.rc ? lucroBruto(atual) / atual.rc : null)} sobre a venda</span></div>
        <div className="indicador"><span className="rotulo">Despesas (fixas + variáveis)</span><span className="valor num">{R(atual.fixas + atual.variaveis)}</span>
          <span className="pequeno suave">fixas {R(atual.fixas)} · variáveis {R(atual.variaveis)}</span></div>
        <div className={`indicador ${resultado(atual) < 0 ? "destaque-erro" : ""}`}><span className="rotulo">Resultado do mês</span><span className="valor num">{R(resultado(atual))}</span>
          {mesAtual && <span className="pequeno suave">projeção: {R(lucroProj)}</span>}</div>
        <div className="indicador"><span className="rotulo">Ponto de equilíbrio</span><span className="valor num">{pe != null ? R(pe) : "—"}</span>
          <span className="pequeno suave">{pe != null ? `${pct(atual.vendas / pe)} atingido · ${dinheiro(pe * d.cambio, "GS")}` : "lance as despesas fixas e o custo dos produtos"}</span></div>
      </section>
      <section className="indicadores">
        <div className="indicador"><span className="rotulo">A receber</span><span className="valor num">{R(d.saldos.receber)}</span>
          <Link className="pequeno" href="/financeiro/receber?faixa=vencidas">{R(d.saldos.receber_vencido)} vencido →</Link></div>
        <div className="indicador"><span className="rotulo">A pagar</span><span className="valor num">{R(d.saldos.pagar)}</span>
          <Link className="pequeno" href="/despesas?ver=vencidas">{R(d.saldos.pagar_vencido)} vencido →</Link></div>
        <div className={`indicador ${n(d.saldos.receber_30) - n(d.saldos.pagar_30) < 0 ? "destaque-aviso" : ""}`}><span className="rotulo">Caixa previsto 30 dias</span>
          <span className="valor num">{R(n(d.saldos.receber_30) - n(d.saldos.pagar_30))}</span>
          <span className="pequeno suave">entra {R(d.saldos.receber_30)} · sai {R(d.saldos.pagar_30)}</span></div>
        <div className="indicador"><span className="rotulo">Compras no mês</span><span className="valor num">{R(atual.compras)}</span>
          <span className="pequeno suave">{n(d.saldos.a_caminho) > 0 ? `${R(d.saldos.a_caminho)} em notas a caminho` : "nenhuma nota a caminho"}</span></div>
      </section>

      <nav className="abas" aria-label="Financeiro">
        {ABAS.map((a) => <Link key={a.k} href={"/financeiro?" + new URLSearchParams({ aba: a.k, mes, per: per.k })} aria-current={a.k === aba ? "page" : undefined}>{a.t}</Link>)}
      </nav>

      {aba === "resumo" && (<>
        {meta && <MetasProgresso meta={meta} m={atual} lucro={resultado(atual)} />}
        <section className="painel">
          <h2>Ponto de equilíbrio</h2>
          {pe == null ? <p className="suave" style={{ margin: 0 }}>Para calcular, cadastre as despesas fixas (aluguel, salários…) em Contas a pagar e mantenha o custo dos produtos em dia.</p> : (<>
            <p style={{ margin: 0 }}>Com custo fixo de <b>{R(fixoMes)}</b> por mês e margem de contribuição de <b>{pct(mcPct)}</b> (lucro bruto menos despesas variáveis, últimos 3 meses),
              a empresa empata vendendo <b>{R(pe)}</b> no mês ({dinheiro(pe * d.cambio, "GS")}). Por dia útil (26): <b>{R(pe / 26)}</b>.</p>
            <Barra percentual={(atual.vendas / pe) * 100} ok={atual.vendas >= pe} />
            <p className="pequeno suave" style={{ margin: 0 }}>Vendido no mês: {R(atual.vendas)} ({pct(atual.vendas / pe)}).
              {atual.vendas < pe ? ` Faltam ${R(pe - atual.vendas)} para empatar.` : ` Acima do empate: ${R(atual.vendas - pe)} de vendas já geram lucro.`}
              {atual.fixas === 0 && fixoMes > 0 ? " (Custo fixo do mês ainda não lançado: usei a média dos últimos meses.)" : ""}</p>
          </>)}
        </section>
        <section className="painel">
          <h2>DRE dos últimos 12 meses (R$)</h2>
          <div className="tabela"><table className="dre">
            <thead><tr><th>Mês</th><th>Vendas</th><th>Custo produtos</th><th>Lucro bruto</th><th>Margem</th><th>Desp. variáveis</th><th>Desp. fixas</th><th>Resultado</th><th>Compras</th><th>Recebido</th><th>Pago</th></tr></thead>
            <tbody>{[...d.meses].reverse().map((m) => (
              <tr key={m.mes} className={m.mes === mes ? "atual" : ""}>
                <td><Link href={href({ mes: m.mes })}>{nomeMes(m.mes)}</Link></td>
                <td className="num">{R(m.vendas)}</td><td className="num">{R(m.custo)}</td><td className="num">{R(lucroBruto(m))}</td>
                <td className="num">{pct(m.rc ? lucroBruto(m) / m.rc : null)}</td><td className="num">{R(m.variaveis)}</td><td className="num">{R(m.fixas)}</td>
                <td className="num" style={{ color: resultado(m) < 0 ? "var(--erro)" : "var(--ok)", fontWeight: 700 }}>{R(resultado(m))}</td>
                <td className="num">{R(m.compras)}</td><td className="num">{R(m.recebido)}</td><td className="num">{R(m.pago)}</td>
              </tr>))}</tbody>
            <tfoot><tr><th>12 meses</th>{(["vendas", "custo"] as const).map((k) => <th key={k} className="num">{R(d.meses.reduce((s, m) => s + m[k], 0))}</th>)}
              <th className="num">{R(d.meses.reduce((s, m) => s + lucroBruto(m), 0))}</th>
              <th className="num">{pct(d.meses.reduce((s, m) => s + lucroBruto(m), 0) / (d.meses.reduce((s, m) => s + m.rc, 0) || NaN))}</th>
              {(["variaveis", "fixas"] as const).map((k) => <th key={k} className="num">{R(d.meses.reduce((s, m) => s + m[k], 0))}</th>)}
              <th className="num">{R(d.meses.reduce((s, m) => s + resultado(m), 0))}</th>
              {(["compras", "recebido", "pago"] as const).map((k) => <th key={k} className="num">{R(d.meses.reduce((s, m) => s + m[k], 0))}</th>)}</tr></tfoot>
          </table></div>
          {d.meses.some((m) => m.vendas - m.rc > 0) && <p className="pequeno suave" style={{ margin: 0 }}>Venda de produto sem custo cadastrado entra em Vendas mas não no lucro.
            Mês atual: {R(atual.vendas - atual.rc)} sem custo. <Link href="/inteligencia/precificacao">Completar custos</Link>.</p>}
          <p className="pequeno suave" style={{ margin: 0 }}>Compras de mercadoria não entram no resultado: viram custo quando o produto é vendido. Comissões entram quando lançadas em Contas a pagar.</p>
        </section>
        <div className="duas-colunas">
          <Ranking titulo="Marcas que mais dão lucro" linhas={d.marcas} chave="marca" nome={(x) => String(x.marca)} max={8} link={href({ aba: "marcas" })} />
          <Ranking titulo="Clientes que mais dão lucro" linhas={d.clientes} chave="cliente_id" nome={(x) => String(x.nome)} max={8} link={href({ aba: "clientes" })} />
        </div>
      </>)}

      {(aba === "marcas" || aba === "clientes") && (
        <nav className="filtros">{PERIODOS.map((p) => <Link key={p.k} href={href({ per: p.k })} className={p.k === per.k ? "ativo" : ""}>{p.t}</Link>)}</nav>
      )}

      {aba === "marcas" && (() => {
        const ls = d.marcas.filter((x) => x.vendas > 0 || x.compras > 0);
        const tot = ls.reduce((s, x) => s + x.lucro, 0);
        const piores = ls.filter((x) => x.rc > 0).sort((a, b) => a.lucro / a.rc - b.lucro / b.rc).slice(0, 8);
        return (<>
          <div className="duas-colunas">
            <Ranking titulo={`Maior lucro · ${per.t.toLowerCase()}`} linhas={ls} chave="marca" nome={(x) => String(x.marca)} max={10} />
            <section className="painel">
              <h2>Menor margem</h2>
              <div className="tabela"><table><thead><tr><th>Marca</th><th>Margem</th><th>Lucro</th></tr></thead>
                <tbody>{piores.map((x) => <tr key={x.marca}><td>{x.marca}</td><td className="num" style={{ color: x.lucro < 0 ? "var(--erro)" : undefined }}>{pct(x.lucro / x.rc)}</td><td className="num">{R(x.lucro)}</td></tr>)}</tbody>
              </table></div>
            </section>
          </div>
          <section className="painel">
            <h2>Todas as marcas · {per.t.toLowerCase()} até {nomeMes(mes)}</h2>
            <div className="tabela"><table>
              <thead><tr><th>Marca</th><th>Vendas</th><th>Custo</th><th>Lucro</th><th>Margem</th><th>% do lucro</th><th>Compras</th><th>Compra ÷ venda</th><th>Clientes</th><th>Sem custo</th></tr></thead>
              <tbody>{[...ls].sort((a, b) => b.lucro - a.lucro).map((x) => (
                <tr key={x.marca}>
                  <td>{x.marca}</td><td className="num">{R(x.vendas)}</td><td className="num">{R(x.custo)}</td>
                  <td className="num" style={{ color: x.lucro < 0 ? "var(--erro)" : undefined, fontWeight: 700 }}>{R(x.lucro)}</td>
                  <td className="num">{pct(x.rc ? x.lucro / x.rc : null)}</td><td className="num">{pct(tot ? x.lucro / tot : null)}</td>
                  <td className="num">{R(x.compras)}</td>
                  <td className="num">{x.vendas ? pct(x.compras / x.vendas) : x.compras ? <Selo cor="aviso">sem venda</Selo> : "—"}</td>
                  <td className="num">{x.clientes}</td>
                  <td className="num">{x.sem_custo > 0 ? <span style={{ color: "var(--aviso)" }}>{R(x.sem_custo)}</span> : "—"}</td>
                </tr>))}</tbody>
            </table></div>
            <p className="pequeno suave" style={{ margin: 0 }}>Compra ÷ venda acima de 100% = comprando mais do que vende (estoque crescendo). "Sem custo" = vendas de produtos sem custo cadastrado, fora do lucro.</p>
          </section>
        </>);
      })()}

      {aba === "clientes" && (() => {
        const ls = d.clientes.filter((x) => x.rc > 0);
        const top = [...ls].sort((a, b) => b.lucro - a.lucro).slice(0, 25);
        const piores = [...ls].sort((a, b) => a.lucro / a.rc - b.lucro / b.rc).slice(0, 15);
        const tot = ls.reduce((s, x) => s + x.lucro, 0);
        const top20 = top.slice(0, Math.max(1, Math.ceil(ls.length * 0.2))).reduce((s, x) => s + x.lucro, 0);
        return (<>
          <p className="suave" style={{ margin: 0 }}>{ls.length} clientes compraram com custo cadastrado; os 20% melhores trazem <b>{pct(tot ? top20 / tot : null)}</b> do lucro.</p>
          <div className="duas-colunas">
            <section className="painel">
              <h2>Clientes que mais deram lucro</h2>
              <TabelaClientes ls={top} />
            </section>
            <section className="painel">
              <h2>Menor margem (atenção ao desconto e ao preço)</h2>
              <TabelaClientes ls={piores} />
            </section>
          </div>
        </>);
      })()}

      {aba === "compras" && d.compras && (() => {
        const ms = d.meses.map((m) => m.mes);
        const tot = new Map<string, number>();
        for (const r of d.compras.porMarca) tot.set(r.marca, (tot.get(r.marca) ?? 0) + n(r.total));
        const marcas = [...tot.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
        const val = (marca: string, m: string) => n(d.compras!.porMarca.find((r) => r.marca === marca && r.mes === m)?.total);
        return (<>
          <section className="painel">
            <h2>Compras x mês x marca (R$, 12 meses)</h2>
            <div className="tabela"><table className="dre">
              <thead><tr><th>Marca</th>{ms.map((m) => <th key={m}>{nomeMes(m).slice(0, 3)}/{m.slice(2, 4)}</th>)}<th>Total</th></tr></thead>
              <tbody>{marcas.map((mc) => (
                <tr key={mc}><td>{mc}</td>{ms.map((m) => <td key={m} className="num">{val(mc, m) ? Math.round(val(mc, m)).toLocaleString("pt-BR") : ""}</td>)}<td className="num"><b>{R(tot.get(mc))}</b></td></tr>))}</tbody>
              <tfoot><tr><th>Total</th>{d.meses.map((m) => <th key={m.mes} className="num">{Math.round(m.compras).toLocaleString("pt-BR")}</th>)}<th className="num">{R(d.meses.reduce((s, m) => s + m.compras, 0))}</th></tr>
                <tr><th>Vendas</th>{d.meses.map((m) => <th key={m.mes} className="num suave">{Math.round(m.vendas).toLocaleString("pt-BR")}</th>)}<th className="num">{R(d.meses.reduce((s, m) => s + m.vendas, 0))}</th></tr></tfoot>
            </table></div>
          </section>
          <nav className="filtros">{PERIODOS.map((p) => <Link key={p.k} href={href({ per: p.k })} className={p.k === per.k ? "ativo" : ""}>{p.t}</Link>)}</nav>
          <div className="duas-colunas">
            <section className="painel">
              <div className="linha entre"><h2>Notas de compra · {per.t.toLowerCase()}</h2><Link href="/estoque/notas">Importar XML / lançar nota →</Link></div>
              {d.compras.notas.length === 0 ? <div className="vazio">Nenhuma nota no período.</div> : (
                <div className="tabela"><table>
                  <thead><tr><th>Data</th><th>Nota</th><th>Fornecedor</th><th>Marca</th><th>Total</th><th>Em aberto</th></tr></thead>
                  <tbody>{d.compras.notas.map((x) => (
                    <tr key={x.id}><td>{new Date(x.data).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</td>
                      <td><Link href={`/estoque/notas/${x.id}`}>{x.nfe ?? "ver"}</Link> {x.status === "a_caminho" && <Selo cor="aviso">a caminho</Selo>}</td>
                      <td>{x.fornecedor}</td><td>{x.marca}</td><td className="num">{R(x.total)}</td>
                      <td className="num">{x.contas === 0 ? <span className="suave">sem conta</span> : n(x.em_aberto) > 0 ? R(x.em_aberto) : <Selo cor="ok">pago</Selo>}</td></tr>))}</tbody>
                </table></div>
              )}
            </section>
            <section className="painel">
              <h2>Maiores fornecedores</h2>
              <div className="tabela"><table><thead><tr><th>Fornecedor</th><th>Notas</th><th>Total</th></tr></thead>
                <tbody>{d.compras.fornecedores.map((x) => <tr key={x.nome}><td>{x.nome}</td><td className="num">{x.notas}</td><td className="num">{R(x.total)}</td></tr>)}</tbody></table></div>
            </section>
          </div>
        </>);
      })()}

      {aba === "metas" && (<>
        {meta ? <MetasProgresso meta={meta} m={atual} lucro={resultado(atual)} /> : <div className="painel suave">Sem metas para {nomeMes(mes)}.</div>}
        {gerir && (
          <section className="painel">
            <h2>Metas de {nomeMes(mes)}</h2>
            <form action={salvarMetaEmpresa} className="campos">
              <input type="hidden" name="mes" value={mes} />
              <label>Vender no mês (R$, tudo convertido)<input name="vendas_brl" inputMode="decimal" defaultValue={meta?.vendas_brl != null ? String(Number(meta.vendas_brl)) : ""} placeholder={pe ? `empate: ${Math.round(pe)}` : ""} /></label>
              <label>Vender em Gs (Paraguai)<input name="vendas_gs" inputMode="decimal" defaultValue={meta?.vendas_gs != null ? String(Number(meta.vendas_gs)) : ""} /></label>
              <label>Comprar no máximo (R$)<input name="compras_brl" inputMode="decimal" defaultValue={meta?.compras_brl != null ? String(Number(meta.compras_brl)) : ""} /></label>
              <label>Lucro do mês (R$, resultado)<input name="lucro_brl" inputMode="decimal" defaultValue={meta?.lucro_brl != null ? String(Number(meta.lucro_brl)) : ""} /></label>
              <label className="largo">Observação<input name="obs" maxLength={300} defaultValue={meta?.observacao ?? ""} /></label>
              <button className="principal">Salvar metas</button>
            </form>
            {pe != null && <p className="pequeno suave" style={{ margin: 0 }}>Referência: o ponto de equilíbrio é {R(pe)}. Uma meta de lucro de {R(fixoMes * 0.3)} pede vendas de cerca de {R((fixoMes * 1.3) / (mcPct || 1))}.</p>}
          </section>
        )}
        <section className="painel">
          <h2>Metas x realizado (12 meses)</h2>
          <div className="tabela"><table>
            <thead><tr><th>Mês</th><th>Vendas</th><th>Meta</th><th>%</th><th>Compras</th><th>Teto</th><th>Lucro</th><th>Meta</th></tr></thead>
            <tbody>{[...d.meses].reverse().map((m) => {
              const mt = d.metas.find((x) => x.mes === m.mes);
              return (
                <tr key={m.mes}><td><Link href={href({ mes: m.mes })}>{nomeMes(m.mes)}</Link></td>
                  <td className="num">{R(m.vendas)}</td><td className="num">{mt?.vendas_brl ? R(mt.vendas_brl) : "—"}</td>
                  <td className="num">{mt?.vendas_brl ? <Selo cor={m.vendas >= n(mt.vendas_brl) ? "ok" : "aviso"}>{pct(m.vendas / n(mt.vendas_brl))}</Selo> : ""}</td>
                  <td className="num">{R(m.compras)}</td><td className="num" style={mt?.compras_brl && m.compras > n(mt.compras_brl) ? { color: "var(--erro)" } : undefined}>{mt?.compras_brl ? R(mt.compras_brl) : "—"}</td>
                  <td className="num">{R(resultado(m))}</td><td className="num">{mt?.lucro_brl != null ? R(mt.lucro_brl) : "—"}</td></tr>);
            })}</tbody>
          </table></div>
        </section>
      </>)}
    </>
  );
}

function MetasProgresso({ meta, m, lucro }: { meta: Record<string, string | null>; m: Mes; lucro: number }) {
  const itens = [
    meta.vendas_brl ? { t: "Meta de vendas (R$)", feito: m.vendas, alvo: n(meta.vendas_brl), fmt: R, bom: true } : null,
    meta.vendas_gs ? { t: "Meta de vendas em Gs", feito: m.vendas_gs, alvo: n(meta.vendas_gs), fmt: (v: number) => dinheiro(v, "GS"), bom: true } : null,
    meta.lucro_brl ? { t: "Meta de lucro", feito: lucro, alvo: n(meta.lucro_brl), fmt: R, bom: true } : null,
    meta.compras_brl ? { t: "Teto de compras", feito: m.compras, alvo: n(meta.compras_brl), fmt: R, bom: false } : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);
  if (!itens.length) return null;
  return (
    <section className="painel">
      <h2>Metas do mês</h2>
      <div className="fin-metas">{itens.map((x) => {
        const p = x.alvo ? (x.feito / x.alvo) * 100 : 0;
        const ok = x.bom ? x.feito >= x.alvo : x.feito <= x.alvo;
        return (
          <div key={x.t} className="fin-meta">
            <div className="linha entre"><b>{x.t}</b><Selo cor={ok ? "ok" : x.bom ? "aviso" : "erro"}>{Math.round(p)}%</Selo></div>
            <Barra percentual={p} ok={ok} />
            <span className="pequeno suave">{x.fmt(x.feito)} de {x.fmt(x.alvo)}{x.bom && !ok ? ` · faltam ${x.fmt(x.alvo - x.feito)}` : !x.bom && !ok ? ` · passou ${x.fmt(x.feito - x.alvo)}` : ""}</span>
          </div>);
      })}</div>
      {meta.observacao && <p className="pequeno suave" style={{ margin: 0 }}>{meta.observacao}</p>}
    </section>
  );
}

type LinhaRank = { vendas: number; rc: number; lucro: number } & Record<string, unknown>;
function Ranking({ titulo, linhas, chave, nome, max, link }: { titulo: string; linhas: LinhaRank[]; chave: string; nome: (x: LinhaRank) => string; max: number; link?: string }) {
  const ls = linhas.filter((x) => x.rc > 0).sort((a, b) => b.lucro - a.lucro).slice(0, max);
  const topo = Math.max(...ls.map((x) => x.lucro), 1);
  return (
    <section className="painel">
      <div className="linha entre"><h2>{titulo}</h2>{link && <Link href={link}>Ver tudo →</Link>}</div>
      {ls.length === 0 ? <div className="vazio">Sem vendas com custo no período.</div> : (
        <ul className="fin-rank">{ls.map((x) => (
          <li key={String(x[chave])}>
            <div className="linha entre"><span>{nome(x)}</span><b className="num">{R(x.lucro)}</b></div>
            <div className="fin-rank-barra"><span style={{ width: `${Math.max(2, (x.lucro / topo) * 100)}%` }} /></div>
            <span className="pequeno suave">vendas {R(x.vendas)} · margem {pct(x.lucro / x.rc)}</span>
          </li>))}</ul>
      )}
    </section>
  );
}

function TabelaClientes({ ls }: { ls: { cliente_id: string; nome: string; vendedora: string; pais: string; vendas: number; rc: number; lucro: number; pedidos: string }[] }) {
  return (
    <div className="tabela"><table>
      <thead><tr><th>Cliente</th><th>Vendas</th><th>Lucro</th><th>Margem</th></tr></thead>
      <tbody>{ls.map((x) => (
        <tr key={x.cliente_id}>
          <td><Link href={`/clientes/${x.cliente_id}`}>{x.nome}</Link><div className="pequeno suave">{x.vendedora} · {x.pais} · {x.pedidos} pedido(s)</div></td>
          <td className="num">{R(x.vendas)}</td>
          <td className="num" style={{ color: x.lucro < 0 ? "var(--erro)" : undefined, fontWeight: 700 }}>{R(x.lucro)}</td>
          <td className="num">{pct(x.rc ? x.lucro / x.rc : null)}</td>
        </tr>))}</tbody>
    </table></div>
  );
}
