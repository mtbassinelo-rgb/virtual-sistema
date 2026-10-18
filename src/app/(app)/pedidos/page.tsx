import Link from "next/link";
import { exigirUsuario, ehGestao, podeEscrever } from "@/lib/auth";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { comUsuario } from "@/lib/db";
import { dinheiro, data, STATUS_COMERCIAL, STATUS_PAGAMENTO, COR_PAGAMENTO, MODALIDADES, type Moeda } from "@/lib/formato";
import { Selo } from "../avisos";

export const metadata = { title: "Pedidos" };

type Filtros = {
  q?: string; vendedora?: string; de?: string; ate?: string; comercial?: string;
  pagamento?: string; modalidade?: string; canal?: string; deposito?: string; desconto?: string;
};

const ATALHOS: [string, string][] = [
  ["", "Todos"], ["pago", "Pagos"], ["aguardando", "Aguardando pagamento"], ["a_credito", "A crédito"],
  ["parcial", "Parcialmente pagos"], ["atrasado", "Atrasados"], ["cancelado", "Cancelados"],
];

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
  if (f.deposito) add("p.deposito_id = ?::uuid", f.deposito);
  if (f.desconto === "pendente") cond.push("p.desconto_qtd_status = 'pendente'");
  if (f.modalidade) add("exists (select 1 from app.pagamentos g where g.pedido_id = p.id and g.modalidade = ?::app.modalidade_pagamento)", f.modalidade);
  const where = cond.length ? `where ${cond.join(" and ")}` : "";

  const d = await comUsuario(u.id, async (c) => {
    const pedidos = (await c.query(
      `select p.id, p.data_pedido, p.bling_numero, p.numero_externo, p.cliente_nome, p.vendedora_nome, p.moeda,
              p.valor_total, p.recebido, p.saldo, p.a_conferir, p.status_comercial, p.status_pagamento,
              p.envio_atrasado, p.bling_mudou, p.canal, p.origem
         from app.v_pedidos p ${where}
        order by p.data_pedido desc, p.criado_em desc limit 300`, par)).rows;
    const vendedoras = (await c.query("select id, nome from app.vendedoras where ativo order by nome")).rows;
    const canais = (await c.query("select codigo, nome from app.canais order by nome")).rows;
    const depositos = (await c.query("select id, nome from app.depositos where ativo order by nome")).rows;
    return { pedidos, vendedoras, canais, depositos };
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

      <nav className="filtros" aria-label="Situação de pagamento">
        {ATALHOS.map(([s, rot]) => (
          <Link key={s} href={linkAtalho(s)} className={(f.pagamento ?? "") === s ? "ativo" : ""}>{rot}</Link>
        ))}
      </nav>

      <form className="painel campos" method="get">
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
                <th>Total</th><th>Saldo</th><th>Pagamento</th><th>Status</th>
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
                    {STATUS_COMERCIAL[p.status_comercial]}
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
