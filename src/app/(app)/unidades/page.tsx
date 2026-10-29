import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, hojeISO, nomeMes } from "@/lib/formato";

export const metadata = { title: "Painel das unidades" };

const R = (v: number) => dinheiro(v, "BRL");
const n = (v: unknown) => Number(v ?? 0);
const pct = (v: number | null) => v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const somaMes = (m: string, k: number) => { const [a, b] = m.split("-").map(Number); return new Date(Date.UTC(a, b - 1 + k, 1)).toISOString().slice(0, 7); };
const fimMes = (m: string) => { const [a, b] = m.split("-").map(Number); return new Date(Date.UTC(a, b, 0)).toISOString().slice(0, 10); };

type Un = {
  id: string; nome: string; codigo: string; vendas: number; rc: number; custo: number; pedidos: number; clientes: number; vendas_gs: number; vendas_brl_orig: number;
  hoje: number; hoje_pedidos: number; recebido: number; transf_entrou: number; transf_saiu: number; fixas: number; variaveis: number;
  a_receber: number; vencido: number; estoque_valor: number; estoque_itens: number; a_separar: number; transf_pend: number;
  caixa_aberto: boolean; caixa_gs: number; a_confirmar: number;
  lucro_gs: number; lucro_brl: number; hoje_gs: number; hoje_brl: number; desp_gs: number; desp_brl: number; ar_gs: number; ar_brl: number;
};

export default async function Unidades({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) redirect("/");
  const f = await searchParams;
  const hoje = hojeISO();
  const mes = /^\d{4}-\d{2}$/.test(f.mes ?? "") ? f.mes! : hoje.slice(0, 7);
  const ini = `${mes}-01`, fim = fimMes(mes), ini12 = `${somaMes(mes, -11)}-01`;

  const d = await comUsuario(u.id, async (c) => {
    const cambio = n((await c.query("select app.param('cambio_custo_gs') v")).rows[0]?.v) || 1300;
    const gs = (col: string, moeda = "moeda", camb = "null") => `case when ${moeda} = 'GS' then ${col} / coalesce(${camb}, ${cambio}) else ${col} end`;
    const unidades = (await c.query(`
      with dep as (select id, nome, codigo from app.depositos where ativo),
      it as (select p.deposito_id, sum(x.receita_brl) vendas, sum(x.receita_brl) filter (where x.custo_brl is not null) rc, sum(x.custo_brl) custo,
                    count(distinct x.pedido_id) pedidos, count(distinct x.cliente_id) clientes,
                    sum(x.receita - x.custo_brl * x.receita / nullif(x.receita_brl, 0)) filter (where x.moeda = 'GS' and x.custo_brl is not null) lucro_gs,
                    sum(x.receita - x.custo_brl) filter (where x.moeda = 'BRL' and x.custo_brl is not null) lucro_brl
               from app.fin_itens($1, $2) x join app.pedidos p on p.id = x.pedido_id group by 1),
      ped as (select deposito_id, sum(valor_total) filter (where moeda = 'GS') gs, sum(valor_total) filter (where moeda = 'BRL') brl,
                     sum(${gs("valor_total")}) filter (where data_pedido = current_date) hoje, count(*) filter (where data_pedido = current_date) hoje_n,
                     sum(valor_total) filter (where moeda = 'GS' and data_pedido = current_date) hoje_gs, sum(valor_total) filter (where moeda = 'BRL' and data_pedido = current_date) hoje_brl
                from app.pedidos where app.conta_como_venda(status_comercial) and data_pedido between $1 and $2 group by 1),
      rec as (select p.deposito_id, sum(${gs("pg.valor", "p.moeda")}) v from app.pagamentos pg join app.pedidos p on p.id = pg.pedido_id
               where pg.status_conferencia <> 'recusado' and pg.data between $1 and $2 group by 1),
      tin as (select destino_id dep, sum(valor_custo) v from app.transferencias where status in ('enviada','recebida','recebida_com_divergencia') and enviada_em::date between $1 and $2 group by 1),
      tout as (select origem_id dep, sum(valor_custo) v from app.transferencias where status in ('enviada','recebida','recebida_com_divergencia') and enviada_em::date between $1 and $2 group by 1),
      des as (select d.deposito_id, sum(${gs("d.valor", "d.moeda", "d.cambio")}) filter (where c.operacional and c.tipo = 'fixa') fixas,
                     sum(${gs("d.valor", "d.moeda", "d.cambio")}) filter (where c.operacional and c.tipo = 'variavel') variaveis,
                     sum(d.valor) filter (where c.operacional and d.moeda = 'GS') desp_gs, sum(d.valor) filter (where c.operacional and d.moeda = 'BRL') desp_brl
                from app.despesas d join app.despesa_categorias c on c.codigo = d.categoria where d.competencia = $1::date group by 1),
      ar as (select deposito_id, sum(${gs("saldo")}) v, sum(${gs("saldo")}) filter (where vencimento < current_date) venc,
                     sum(saldo) filter (where moeda = 'GS') ar_gs, sum(saldo) filter (where moeda = 'BRL') ar_brl from app.v_pedidos
              where status_comercial <> 'cancelado' and app.conta_como_venda(status_comercial) and saldo > 0 group by 1),
      est as (select s.deposito_id, sum(s.quantidade * coalesce(app.custo_produto(s.produto_id), 0)) v, count(*) filter (where s.quantidade > 0) itens
                from app.estoque_saldos s group by 1),
      sep as (select deposito_id, count(*) n from app.pedidos where status_comercial = 'em_separacao' and origem <> 'bling' and separacao_conferida_em is null group by 1),
      tp as (select dep, count(*) n from (select destino_id dep from app.transferencias where status in ('solicitada','separada','enviada')
                                          union all select origem_id from app.transferencias where status in ('solicitada','separada')) z group by 1),
      cx as (select deposito_id, true aberto, app.caixa_esperado(id, 'GS') gs from app.caixas where status = 'aberto'),
      conf as (select cx.deposito_id, count(*) n from app.caixa_movimentos m join app.caixas cx on cx.id = m.caixa_id where m.confirmacao = 'pendente' group by 1)
      select dep.id, dep.nome, dep.codigo, coalesce(it.vendas, 0) vendas, coalesce(it.rc, 0) rc, coalesce(it.custo, 0) custo, coalesce(it.pedidos, 0) pedidos,
             coalesce(it.clientes, 0) clientes, coalesce(ped.gs, 0) vendas_gs, coalesce(ped.brl, 0) vendas_brl_orig, coalesce(ped.hoje, 0) hoje, coalesce(ped.hoje_n, 0) hoje_pedidos,
             coalesce(rec.v, 0) recebido, coalesce(tin.v, 0) transf_entrou, coalesce(tout.v, 0) transf_saiu, coalesce(des.fixas, 0) fixas, coalesce(des.variaveis, 0) variaveis,
             coalesce(ar.v, 0) a_receber, coalesce(ar.venc, 0) vencido, coalesce(est.v, 0) estoque_valor, coalesce(est.itens, 0) estoque_itens,
             coalesce(sep.n, 0) a_separar, coalesce(tp.n, 0) transf_pend, coalesce(cx.aberto, false) caixa_aberto, coalesce(cx.gs, 0) caixa_gs, coalesce(conf.n, 0) a_confirmar,
             coalesce(it.lucro_gs, 0) lucro_gs, coalesce(it.lucro_brl, 0) lucro_brl, coalesce(ped.hoje_gs, 0) hoje_gs, coalesce(ped.hoje_brl, 0) hoje_brl,
             coalesce(des.desp_gs, 0) desp_gs, coalesce(des.desp_brl, 0) desp_brl, coalesce(ar.ar_gs, 0) ar_gs, coalesce(ar.ar_brl, 0) ar_brl
        from dep left join it on it.deposito_id = dep.id left join ped on ped.deposito_id = dep.id left join rec on rec.deposito_id = dep.id
        left join tin on tin.dep = dep.id left join tout on tout.dep = dep.id left join des on des.deposito_id = dep.id left join ar on ar.deposito_id = dep.id
        left join est on est.deposito_id = dep.id left join sep on sep.deposito_id = dep.id left join tp on tp.dep = dep.id left join cx on cx.deposito_id = dep.id
        left join conf on conf.deposito_id = dep.id
       order by dep.codigo = 'cd-foz' desc, dep.nome`, [ini, fim])).rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) =>
         [k, ["id", "nome", "codigo", "caixa_aberto"].includes(k) ? v : n(v)]))) as Un[];
    // despesas da empresa sem unidade (geral)
    const geral = (await c.query(`select coalesce(sum(${gs("d.valor", "d.moeda", "d.cambio")}) filter (where c.tipo = 'fixa'), 0) fixas,
        coalesce(sum(${gs("d.valor", "d.moeda", "d.cambio")}) filter (where c.tipo = 'variavel'), 0) variaveis
      from app.despesas d join app.despesa_categorias c on c.codigo = d.categoria where c.operacional and d.deposito_id is null and d.competencia = $1::date`, [ini])).rows[0];
    const evolucao = (await c.query(`select to_char(date_trunc('month', x.data_pedido), 'YYYY-MM') mes, p.deposito_id,
        sum(x.receita_brl) vendas, sum(x.receita_brl) filter (where x.custo_brl is not null) - coalesce(sum(x.custo_brl), 0) lucro,
        coalesce(sum(x.receita) filter (where x.moeda = 'GS'), 0) vendas_gs, coalesce(sum(x.receita) filter (where x.moeda = 'BRL'), 0) vendas_brl,
        coalesce(sum(x.receita - x.custo_brl * x.receita / nullif(x.receita_brl, 0)) filter (where x.moeda = 'GS' and x.custo_brl is not null), 0) lucro_gs,
        coalesce(sum(x.receita - x.custo_brl) filter (where x.moeda = 'BRL' and x.custo_brl is not null), 0) lucro_brl
      from app.fin_itens($1, $2) x join app.pedidos p on p.id = x.pedido_id group by 1, 2`, [ini12, fim])).rows;
    return { cambio, unidades, geral, evolucao };
  });

  const lb = (x: Un) => x.rc - x.custo;
  const res = (x: Un) => lb(x) - x.fixas - x.variaveis;
  const fluxo = (x: Un) => x.recebido - x.transf_entrou - x.fixas - x.variaveis;
  const NUM = ["vendas", "rc", "custo", "pedidos", "clientes", "vendas_gs", "vendas_brl_orig", "hoje", "hoje_pedidos", "recebido", "transf_entrou", "transf_saiu",
    "fixas", "variaveis", "a_receber", "vencido", "estoque_valor", "estoque_itens", "a_separar", "transf_pend", "caixa_gs", "a_confirmar",
    "lucro_gs", "lucro_brl", "hoje_gs", "hoje_brl", "desp_gs", "desp_brl", "ar_gs", "ar_brl"] as const;
  const tot = { id: "todas", nome: "Geral", codigo: "geral", caixa_aberto: false,
    ...Object.fromEntries(NUM.map((k) => [k, d.unidades.reduce((s, x) => s + x[k], 0)])) } as Un;
  tot.fixas += n(d.geral.fixas); tot.variaveis += n(d.geral.variaveis);
  // geral: transferência entre unidades não é custo da empresa (só muda de lugar)
  const meses = Array.from({ length: 12 }, (_, i) => somaMes(mes, i - 11)).reverse();
  type K = "vendas" | "lucro" | "vendas_gs" | "vendas_brl" | "lucro_gs" | "lucro_brl";
  const evo = (m: string, dep: string, k: K) => n(d.evolucao.find((r) => r.mes === m && r.deposito_id === dep)?.[k]);
  const evoT = (m: string, k: K) => d.unidades.reduce((s, x) => s + evo(m, x.id, k), 0);
  // célula da tabela: valor real em Gs (+ R$ se houver) e o total convertido embaixo
  const celReal = (g: number, b: number, tot: number) => <>{g || !b ? dinheiro(g, "GS") : R(b)}{g && b ? <span className="pequeno"> + {R(b)}</span> : null}
    <div className="pequeno suave">≈ {R(tot)}</div></>;

  // Moeda de destaque: a moeda em que a unidade mais vendeu no mês (Paraguai = Gs). O outro valor aparece pequeno, pelo câmbio.
  const cam = d.cambio;
  const moedaDe = (x: Un): "GS" | "BRL" => (x.vendas_gs / cam >= x.vendas_brl_orig ? "GS" : "BRL");
  const Val = ({ v, m }: { v: number; m: "GS" | "BRL" }) => m === "GS"
    ? <><b>{dinheiro(v * cam, "GS")}</b><small className="conv">{R(v)} · câmbio {cam.toLocaleString("pt-BR")}</small></>
    : <><b>{R(v)}</b><small className="conv">{dinheiro(v * cam, "GS")} · câmbio {cam.toLocaleString("pt-BR")}</small></>;
  // Valor real por moeda (o que está nos pedidos): Gs em destaque, R$ ao lado se houver; embaixo o total convertido
  const Real = ({ gs, brl, total }: { gs: number; brl: number; total: number }) => (
    <><b>{gs || !brl ? dinheiro(gs, "GS") : R(brl)}{gs && brl ? <span className="pequeno"> + {R(brl)}</span> : null}</b>
      <small className="conv">total ≈ {R(total)} · câmbio {cam.toLocaleString("pt-BR")}</small></>);
  const curto = (v: number, m: "GS" | "BRL") => (m === "GS" ? dinheiro(v * cam, "GS") : R(v));

  const Cartao = ({ x, geral }: { x: Un; geral?: boolean }) => { const m = moedaDe(x); return (
    <section className={`painel unidade-cartao ${geral ? "geral" : ""}`}>
      <div className="linha entre"><h2>{x.nome}</h2>{!geral && <Link className="pequeno" href={`/unidade?d=${x.id}`}>Abrir esta unidade →</Link>}</div>
      <div className="unidade-grade">
        <div><span>Vendas no mês</span><Real gs={x.vendas_gs} brl={x.vendas_brl_orig} total={x.vendas_gs / cam + x.vendas_brl_orig} /><small>{x.pedidos} pedidos · {x.clientes} clientes</small></div>
        <div><span>Vendas hoje</span><Real gs={x.hoje_gs} brl={x.hoje_brl} total={x.hoje} /><small>{x.hoje_pedidos} pedido(s)</small></div>
        <div><span>Lucro bruto</span><Real gs={x.lucro_gs} brl={x.lucro_brl} total={lb(x)} /><small>margem {pct(x.rc ? lb(x) / x.rc : null)}</small></div>
        <div><span>Despesas</span><Real gs={x.desp_gs} brl={x.desp_brl} total={x.fixas + x.variaveis} /><small>fixas {curto(x.fixas, m)}</small></div>
        <div className={res(x) < 0 ? "ruim" : "bom"}><span>Resultado (lucro − despesas)</span><Val v={res(x)} m={m} /></div>
        {!geral && <div><span>Mercadoria recebida (custo)</span><Val v={x.transf_entrou} m="BRL" /><small>enviada a outras: {R(x.transf_saiu)}</small></div>}
        {!geral && <div className={fluxo(x) < 0 ? "ruim" : ""}><span>Caixa do mês</span><Val v={fluxo(x)} m={m} /><small>recebido − mercadoria − despesas</small></div>}
        <div><span>A receber</span><Real gs={x.ar_gs} brl={x.ar_brl} total={x.a_receber} /><small>{x.vencido > 0 ? `${curto(x.vencido, m)} vencido` : "nada vencido"}</small></div>
        <div><span>Estoque (custo)</span><Val v={x.estoque_valor} m="BRL" /><small>{x.estoque_itens} produtos com saldo</small></div>
        {!geral && <div><span>Caixa do dia</span><b>{x.caixa_aberto ? dinheiro(x.caixa_gs, "GS") : "fechado"}</b><small>{x.a_confirmar ? `${x.a_confirmar} transferência(s) a confirmar` : "nada a confirmar"}</small></div>}
        {!geral && <div><span>Operação</span><b>{x.a_separar} a separar</b><small>{x.transf_pend} pedido(s) entre unidades</small></div>}
      </div>
    </section>
  ); };

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Painel das unidades</h1>
          <p>Vendas, lucro, despesas e a receber mostram o valor real de cada moeda, como está nos pedidos (Gs em destaque; R$ ao lado quando houver venda em reais).
            Embaixo, o total convertido pelo câmbio de {d.cambio.toLocaleString("pt-BR")} Gs/R$. Resultado e caixa juntam as duas moedas, então aparecem convertidos; estoque é custo em R$. Na unidade que recebe mercadoria de outra, o custo enviado conta no "Caixa do mês";
            no geral, transferência não é custo (a mercadoria só muda de lugar).</p>
        </div>
        <form className="linha" method="get"><label>Mês<input type="month" name="mes" defaultValue={mes} /></label><button>Ver</button></form>
      </section>
      <Cartao x={tot} geral />
      <div className="unidades-lado">{d.unidades.map((x) => <Cartao key={x.id} x={x} />)}</div>
      {n(d.geral.fixas) + n(d.geral.variaveis) > 0 && <p className="pequeno suave">Despesas da empresa sem unidade (entram só no Geral): {R(n(d.geral.fixas) + n(d.geral.variaveis))}.</p>}

      <section className="painel">
        <h2>Últimos 12 meses por unidade</h2>
        <div className="tabela"><table className="dre">
          <thead><tr><th>Mês</th>{d.unidades.map((x) => <th key={x.id} colSpan={2}>{x.nome}</th>)}<th colSpan={2}>Geral</th></tr>
            <tr><th></th>{[...d.unidades, tot].map((x) => [<th key={x.id + "v"}>Vendas</th>, <th key={x.id + "l"}>Lucro</th>])}</tr></thead>
          <tbody>{meses.map((m) => (
            <tr key={m} className={m === mes ? "atual" : ""}>
              <td><Link href={`/unidades?mes=${m}`}>{nomeMes(m)}</Link></td>
              {d.unidades.map((x) => [<td key={x.id + "v"} className="num">{celReal(evo(m, x.id, "vendas_gs"), evo(m, x.id, "vendas_brl"), evo(m, x.id, "vendas"))}</td>,
                <td key={x.id + "l"} className="num">{celReal(evo(m, x.id, "lucro_gs"), evo(m, x.id, "lucro_brl"), evo(m, x.id, "lucro"))}</td>])}
              <td className="num"><b>{celReal(evoT(m, "vendas_gs"), evoT(m, "vendas_brl"), evoT(m, "vendas"))}</b></td>
              <td className="num"><b>{celReal(evoT(m, "lucro_gs"), evoT(m, "lucro_brl"), evoT(m, "lucro"))}</b></td>
            </tr>))}</tbody>
        </table></div>
      </section>
      <p className="pequeno"><Link href="/financeiro">Painel financeiro completo →</Link> · <Link href="/estoque/transferencias">Pedidos entre unidades →</Link> · <Link href="/caixa">Caixa →</Link></p>
    </>
  );
}
