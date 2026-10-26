import Link from "next/link";
import { exigirUsuario, ehGestao, podeEscrever } from "@/lib/auth";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { comUsuario } from "@/lib/db";
import { dinheiro, data, STATUS_COMERCIAL, STATUS_PAGAMENTO, COR_PAGAMENTO, MODALIDADES, type Moeda } from "@/lib/formato";
import { Selo } from "../avisos";
import { carregarFila, etapaSql, ETAPA_POR_ID, FilaPedidos } from "./fila";

export const metadata = { title: "Pedidos" };

type Filtros = {
  q?: string; vendedora?: string; de?: string; ate?: string; comercial?: string;
  pagamento?: string; modalidade?: string; canal?: string; deposito?: string; desconto?: string; remocao?: string; origem?: string; etapa?: string;
};

const ATALHOS: [string, string][] = [
  ["", "Todos"], ["pago", "Pagos"], ["aguardando", "Aguardando pagamento"], ["a_credito", "A crédito"],
  ["parcial", "Parcialmente pagos"], ["atrasado", "Atrasados"], ["cancelado", "Cancelados"],
];

type Resumo = {
  hoje: string; site: { moeda: Moeda; n: number; t: string }[]; siteSolic: number;
  mk: { dia: string; canal: string; nome: string; n: number; t: string; taxa: string }[];
  geral: { grupo: string; moeda: Moeda; n: number; t: string }[];
};

function ResumoVendas({ r }: { r: Resumo }) {
  const brl = (v: number) => dinheiro(v, "BRL");
  const hojeMk = r.mk.filter((x) => x.dia === r.hoje);
  const canaisMk = [...new Map(r.mk.map((x) => [x.canal, x.nome])).entries()];
  if (!canaisMk.some(([c]) => c === "shopee")) canaisMk.push(["shopee", "Shopee"]);
  if (!canaisMk.some(([c]) => c === "mercado_livre")) canaisMk.push(["mercado_livre", "Mercado Livre"]);
  const dias = [...new Set(r.mk.map((x) => x.dia))];
  const grupos = [...new Set(r.geral.map((g) => g.grupo))];
  const soma = (m: Moeda) => r.geral.filter((g) => g.moeda === m).reduce((s, g) => s + Number(g.t), 0);
  return (
    <>
      <section className="painel" style={{ borderLeft: "4px solid var(--marca, #7b2d5b)" }}>
        <div className="linha entre" style={{ flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Vendas do nosso site · hoje</h2>
          <Link href={`/pedidos?origem=portal&de=${r.hoje}`}>ver pedidos do site</Link>
        </div>
        <div className="indicadores" style={{ marginTop: 8 }}>
          {r.site.length === 0 && <div className="indicador"><span className="rotulo">Pedidos pela loja online</span><span className="valor num">0</span></div>}
          {r.site.map((x) => (
            <div key={x.moeda} className="indicador destaque">
              <span className="rotulo">Pedidos pela loja online ({x.moeda === "GS" ? "Gs" : "R$"})</span>
              <span className="valor num">{dinheiro(x.t, x.moeda)}</span>
              <span className="pequeno suave">{x.n} pedido(s)</span>
            </div>))}
          <div className="indicador"><span className="rotulo">Pedidos rápidos do site (sem login)</span><span className="valor num">{r.siteSolic}</span>
            <span className="pequeno suave"><Link href="/">atender no painel</Link></span></div>
        </div>
      </section>

      <section className="painel">
        <h2 style={{ marginTop: 0 }}>Marketplaces · resumo do corte das 14h</h2>
        <div className="indicadores">
          {canaisMk.map(([c, nome]) => {
            const x = hojeMk.find((m) => m.canal === c);
            return (
              <div key={c} className="indicador">
                <span className="rotulo">{nome} hoje</span>
                <span className="valor num">{brl(Number(x?.t ?? 0))}</span>
                <span className="pequeno suave">{x?.n ?? 0} pedido(s) · taxas {brl(Number(x?.taxa ?? 0))} · líquido {brl(Number(x?.t ?? 0) - Number(x?.taxa ?? 0))}</span>
                <span className="pequeno"><Link href={`/pedidos?canal=${c}`}>ver pedidos</Link></span>
              </div>);
          })}
        </div>
        {dias.length > 0 && (
          <div className="tabela"><table>
            <thead><tr><th>Dia (corte 14h)</th>{canaisMk.map(([c, nome]) => <th key={c} className="num">{nome}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>{dias.map((dia) => {
              const linha = canaisMk.map(([c]) => r.mk.find((m) => m.dia === dia && m.canal === c));
              const tot = linha.reduce((s, x) => s + Number(x?.t ?? 0), 0);
              return (
                <tr key={dia}><td className="num">{data(dia)}</td>
                  {linha.map((x, i) => <td key={i} className="num">{x ? <>{brl(Number(x.t))}<div className="pequeno suave">{x.n} pedido(s)</div></> : "—"}</td>)}
                  <td className="num"><b>{brl(tot)}</b></td></tr>);
            })}</tbody>
          </table></div>
        )}
        <p className="pequeno suave" style={{ margin: 0 }}>Os pedidos da Shopee e do Mercado Livre entram uma vez por dia, às 14h, e dão baixa no estoque. Eles não aparecem um a um na lista abaixo.</p>
      </section>

      <section className="painel">
        <h2 style={{ marginTop: 0 }}>Resumo de todas as vendas de hoje</h2>
        <div className="tabela"><table>
          <thead><tr><th>Canal</th><th className="num">Pedidos</th><th className="num">Gs</th><th className="num">R$</th></tr></thead>
          <tbody>
            {grupos.map((g) => {
              const gs = r.geral.find((x) => x.grupo === g && x.moeda === "GS"), br = r.geral.find((x) => x.grupo === g && x.moeda === "BRL");
              return <tr key={g}><td>{g}</td><td className="num">{(gs?.n ?? 0) + (br?.n ?? 0)}</td>
                <td className="num">{gs ? dinheiro(gs.t, "GS") : "—"}</td><td className="num">{br ? dinheiro(br.t, "BRL") : "—"}</td></tr>;
            })}
            <tr><td><b>Total</b></td><td className="num"><b>{r.geral.reduce((s, g) => s + g.n, 0)}</b></td>
              <td className="num"><b>{dinheiro(soma("GS"), "GS")}</b></td><td className="num"><b>{dinheiro(soma("BRL"), "BRL")}</b></td></tr>
          </tbody>
        </table></div>
      </section>
    </>
  );
}

export default async function Pedidos({ searchParams }: { searchParams: Promise<Filtros> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  // sem filtro de depósito na busca: usa a unidade escolhida no topo
  if (f.deposito === undefined) { const { atual } = await unidadeSistema(u); if (atual) f.deposito = atual.id; }

  const cond: string[] = [];
  const par: unknown[] = [];
  const add = (sql: string, v: unknown) => { par.push(v); cond.push(sql.replace("?", `$${par.length}`)); };
  if (f.q) {
    if (/^\d+$/.test(f.q)) add("(p.bling_numero = ?::bigint or p.numero_externo = p.bling_numero::text)".replace("p.bling_numero::text", `$${par.length + 1}::bigint::text`), f.q);
    else add("p.cliente_nome ilike ?", `%${f.q}%`);
  }
  if (f.vendedora) add("p.vendedora_id = ?::uuid", f.vendedora);
  if (f.de) add("p.data_pedido >= ?::date", f.de);
  if (f.ate) add("p.data_pedido <= ?::date", f.ate);
  if (f.comercial) add("p.status_comercial = ?::app.status_comercial", f.comercial);
  if (f.pagamento) add("p.status_pagamento = ?", f.pagamento);
  if (f.canal) add("p.canal = ?", f.canal);
  // Shopee e Mercado Livre não aparecem pedido a pedido: ficam no resumo diário (corte das 14h). Filtrando o canal, aparecem.
  else cond.push("not exists (select 1 from app.canais k where k.codigo = p.canal and k.marketplace)");
  if (f.origem === "portal") cond.push("p.origem = 'portal'");
  if (f.deposito) add("p.deposito_id = ?::uuid", f.deposito);
  if (f.desconto === "pendente") cond.push("p.desconto_qtd_status = 'pendente'");
  if (f.remocao === "pendente") cond.push("exists (select 1 from app.pedido_remocoes r where r.pedido_id = p.id and r.status = 'pendente')");
  if (f.etapa && ETAPA_POR_ID[f.etapa]) add(`${etapaSql("p", "px")} = ?`, f.etapa);
  if (f.modalidade) add("exists (select 1 from app.pagamentos g where g.pedido_id = p.id and g.modalidade = ?::app.modalidade_pagamento)", f.modalidade);
  const where = cond.length ? `where ${cond.join(" and ")}` : "";

  const d = await comUsuario(u.id, async (c) => {
    const pedidos = (await c.query(
      `select p.id, p.data_pedido, p.bling_numero, p.numero_externo, p.cliente_nome, p.vendedora_nome, p.moeda,
              p.valor_total, p.recebido, p.saldo, p.a_conferir, p.status_comercial, p.status_pagamento,
              p.envio_atrasado, p.bling_mudou, p.canal, p.origem, ${etapaSql("p", "px")} etapa
         from app.v_pedidos p join app.pedidos px on px.id = p.id ${where}
        order by p.data_pedido desc, p.criado_em desc limit 300`, par)).rows;
    const vendedoras = (await c.query("select id, nome from app.vendedoras where ativo order by nome")).rows;
    const canais = (await c.query("select codigo, nome from app.canais order by nome")).rows;
    const depositos = (await c.query("select id, nome from app.depositos where ativo order by nome")).rows;
    let resumo: Resumo | null = null;
    if (ehGestao(u)) {
      const hoje = (await c.query("select (now() at time zone 'America/Sao_Paulo')::date::text h")).rows[0].h as string;
      const site = (await c.query(`select moeda, count(*)::int n, sum(valor_total) t from app.pedidos
          where origem = 'portal' and status_comercial <> 'cancelado' and (criado_em at time zone 'America/Sao_Paulo')::date = $1::date group by 1`, [hoje])).rows;
      const siteSolic = Number((await c.query(`select count(*) n from app.pedidos_site where (criado_em at time zone 'America/Sao_Paulo')::date = $1::date`, [hoje])).rows[0].n);
      const mk = (await c.query(`select app.dia_corte_marketplace(p.criado_em)::text dia, p.canal, k.nome, count(*)::int n, sum(p.valor_total) t, sum(coalesce(p.taxa_marketplace, 0)) taxa
          from app.pedidos p join app.canais k on k.codigo = p.canal and k.marketplace
         where p.status_comercial <> 'cancelado' and app.dia_corte_marketplace(p.criado_em) >= $1::date - 6
         group by 1, 2, 3 order by 1 desc, 3`, [hoje])).rows;
      const geral = (await c.query(`select case when p.origem = 'portal' then 'Site (loja online)' when k.marketplace then k.nome else 'Vendedoras' end grupo,
             p.moeda, count(*)::int n, sum(p.valor_total) t
          from app.pedidos p left join app.canais k on k.codigo = p.canal
         where p.status_comercial <> 'cancelado'
           and case when coalesce(k.marketplace, false) then app.dia_corte_marketplace(p.criado_em) else (p.criado_em at time zone 'America/Sao_Paulo')::date end = $1::date
         group by 1, 2 order by 1`, [hoje])).rows;
      resumo = { hoje, site, siteSolic, mk, geral };
    }
    const fila = await carregarFila(c, f.deposito || null);
    return { pedidos, vendedoras, canais, depositos, resumo, fila };
  });

  const totais = new Map<string, { vendido: number; recebido: number; saldo: number }>();
  for (const p of d.pedidos) {
    if (p.status_comercial === "cancelado") continue;
    const t = totais.get(p.moeda) ?? { vendido: 0, recebido: 0, saldo: 0 };
    t.vendido += Number(p.valor_total); t.recebido += Number(p.recebido); t.saldo += Number(p.saldo);
    totais.set(p.moeda, t);
  }
  const linkAtalho = (s: string) => {
    const q = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && k !== "pagamento") as [string, string][]);
    if (s) q.set("pagamento", s);
    return `/pedidos?${q.toString()}`;
  };

  return (
    <>
      <section className="linha entre">
        <div>
          <h1>Pedidos</h1>
          <div className="suave pequeno">{d.pedidos.length} pedido(s){d.pedidos.length === 300 ? " (mostrando os 300 mais recentes)" : ""}</div>
        </div>
        {podeEscrever(u) && <Link className="botao principal" href="/pedidos/novo">Novo pedido</Link>}
      </section>

      <FilaPedidos itens={d.fila} titulo="O que fazer em cada pedido" />

      {f.etapa && ETAPA_POR_ID[f.etapa] && (
        <div className="aviso-caixa info linha entre">
          <span>Mostrando só: <b>{ETAPA_POR_ID[f.etapa].titulo}</b> ({ETAPA_POR_ID[f.etapa].dica.toLowerCase()})</span>
          <Link href="/pedidos">mostrar todos</Link>
        </div>
      )}

      {d.resumo && (
        <details className="painel" open={!f.etapa}>
          <summary><b>Vendas de hoje: site, marketplaces e vendedoras</b></summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}><ResumoVendas r={d.resumo} /></div>
        </details>
      )}

      <nav className="filtros" aria-label="Situação de pagamento">
        {ATALHOS.map(([s, rot]) => (
          <Link key={s} href={linkAtalho(s)} className={(f.pagamento ?? "") === s ? "ativo" : ""}>{rot}</Link>
        ))}
      </nav>

      <details className="painel" open={Boolean(f.q || f.vendedora || f.de || f.ate || f.comercial || f.modalidade || f.canal)}>
      <summary><b>Buscar e filtrar</b> <span className="suave pequeno">(nº do Bling, cliente, datas, vendedora, canal…)</span></summary>
      <form className="campos" method="get" style={{ marginTop: 10 }}>
        {f.etapa && <input type="hidden" name="etapa" value={f.etapa} />}
        <label>Nº Bling ou cliente<input id="q" name="q" defaultValue={f.q} placeholder="Ex.: 555 ou Julisa" /></label>
        {ehGestao(u) && (
          <label>Vendedora
            <select id="vendedora" name="vendedora" defaultValue={f.vendedora ?? ""}>
              <option value="">Todas</option>
              {d.vendedoras.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
            </select>
          </label>
        )}
        <label>De<input id="de" name="de" type="date" defaultValue={f.de} /></label>
        <label>Até<input id="ate" name="ate" type="date" defaultValue={f.ate} /></label>
        <label>Status comercial
          <select id="comercial" name="comercial" defaultValue={f.comercial ?? ""}>
            <option value="">Todos</option>
            {Object.entries(STATUS_COMERCIAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Pagamento
          <select id="pagamento" name="pagamento" defaultValue={f.pagamento ?? ""}>
            <option value="">Todos</option>
            {Object.entries(STATUS_PAGAMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Modalidade
          <select id="modalidade" name="modalidade" defaultValue={f.modalidade ?? ""}>
            <option value="">Todas</option>
            {Object.entries(MODALIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Canal
          <select id="canal" name="canal" defaultValue={f.canal ?? ""}>
            <option value="">Todos</option>
            {d.canais.map((c) => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)}
          </select>
        </label>
        <label>Depósito
          <select id="deposito" name="deposito" defaultValue={f.deposito ?? ""}>
            <option value="">Todos</option>
            {d.depositos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
        <div className="linha">
          <button className="principal" type="submit">Filtrar</button>
          <Link href="/pedidos">Limpar</Link>
        </div>
      </form>
      </details>

      {totais.size > 0 && (
        <div className="indicadores">
          {[...totais.entries()].map(([moeda, t]) => (
            <div key={moeda} className="indicador">
              <span className="rotulo">Vendido · Recebido · Saldo ({moeda === "GS" ? "Gs" : "R$"})</span>
              <span className="num">{dinheiro(t.vendido, moeda as Moeda)}</span>
              <span className="num suave">{dinheiro(t.recebido, moeda as Moeda)} recebido</span>
              <span className="num suave">{dinheiro(t.saldo, moeda as Moeda)} em aberto</span>
            </div>
          ))}
        </div>
      )}

      {d.pedidos.length === 0 ? (
        <div className="painel vazio">Nenhum pedido com esses filtros.</div>
      ) : (
        <div className="tabela">
          <table>
            <thead>
              <tr>
                <th>Data</th><th>Nº Bling</th><th>Cliente</th>{ehGestao(u) && <th>Vendedora</th>}
                <th>Total</th><th>Saldo</th><th>Pagamento</th><th>O que falta</th>
              </tr>
            </thead>
            <tbody>
              {d.pedidos.map((p) => (
                <tr key={p.id}>
                  <td className="num">{data(p.data_pedido)}</td>
                  <td className="num">{p.bling_numero ?? <span className="suave">—</span>}</td>
                  <td>
                    <Link href={`/pedidos/${p.id}`}>{p.cliente_nome ?? "Sem cliente"}</Link>
                    {p.canal !== "direto" && <> <Selo>{p.canal}</Selo></>}
                    {p.bling_mudou && <> <Selo cor="aviso">mudou no Bling</Selo></>}
                  </td>
                  {ehGestao(u) && <td>{p.vendedora_nome}</td>}
                  <td className="num">{dinheiro(p.valor_total, p.moeda as Moeda)}</td>
                  <td className="num">
                    {dinheiro(p.saldo, p.moeda as Moeda)}
                    {Number(p.a_conferir) > 0 && <div className="pequeno suave">{dinheiro(p.a_conferir, p.moeda as Moeda)} a conferir</div>}
                  </td>
                  <td><Selo cor={COR_PAGAMENTO[p.status_pagamento]}>{STATUS_PAGAMENTO[p.status_pagamento]}</Selo></td>
                  <td>
                    {p.etapa && ETAPA_POR_ID[p.etapa]
                      ? <Link href={`/pedidos/${p.id}`} className={`selo ${ETAPA_POR_ID[p.etapa].cor}`} style={{ textDecoration: "none" }}>{ETAPA_POR_ID[p.etapa].titulo}</Link>
                      : <span className="pequeno suave">{STATUS_COMERCIAL[p.status_comercial]}</span>}
                    {p.envio_atrasado && <> <Selo cor="erro">envio atrasado</Selo></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
