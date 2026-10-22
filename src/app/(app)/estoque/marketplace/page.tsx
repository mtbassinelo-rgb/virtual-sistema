import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, hojeISO } from "@/lib/formato";
import { Avisos } from "../../avisos";
import { importarRelatorio, ligarSku } from "./acoes";

export const metadata = { title: "Vendas de marketplace" };
const NOMES: Record<string, string> = { shopee: "Shopee", mercado_livre: "Mercado Livre", tiktok: "TikTok Shop" };

export default async function Marketplace({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const d = await comUsuario(u.id, async (c) => {
    const deps = (await c.query("select id, nome, codigo from app.depositos where ativo and (app.pode_gerir() or app.pode_operar_deposito(id)) order by codigo = 'cd-foz' desc, nome")).rows as { id: string; nome: string; codigo: string }[];
    const historico = (await c.query(`select m.*, d.nome deposito, app.nome_usuario(m.criado_por) quem from app.marketplace_importacoes m
      join app.depositos d on d.id = m.deposito_id order by m.criado_em desc limit 30`)).rows;
    const pend = (await c.query(`select e.codigo, count(*)::int vezes, sum(e.quantidade) qtd, max(e.detalhe) descricao from app.estoque_pendencias e
      where e.tipo = 'sku_desconhecido' and e.resolvida_em is null group by 1 order by 2 desc limit 50`)).rows;
    const mes = (await c.query(`select canal, count(*)::int pedidos, sum(valor_total) total, sum(taxa_marketplace) taxas from app.pedidos
      where canal in ('shopee','mercado_livre','tiktok') and app.conta_como_venda(status_comercial) and date_trunc('month', data_pedido) = date_trunc('month', current_date)
      group by 1 order by 1`)).rows;
    const produtos = (await c.query("select codigo, nome from app.produtos where ativo and codigo is not null order by nome")).rows as { codigo: string; nome: string }[];
    return { deps, historico, pend, mes, produtos };
  });
  if (!d.deps.length) return <div className="painel">Só gerente, dono ou quem opera um estoque lança vendas de marketplace.</div>;
  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/estoque">Estoque</Link> / Vendas de marketplace</div>
          <h1>Vendas da Shopee e do Mercado Livre</h1>
          <p>Baixe o relatório de pedidos do dia no painel do marketplace e envie aqui (CSV), ou copie as linhas da planilha e cole.
            Cada pedido entra no sistema (vendas e lucro) e o estoque sai da unidade escolhida. O mesmo pedido nunca entra duas vezes.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      {d.mes.length > 0 && (
        <section className="indicadores">{d.mes.map((m) => (
          <div key={m.canal} className="indicador"><span className="rotulo">{NOMES[m.canal] ?? m.canal} no mês</span><span className="valor num">{dinheiro(m.total, "BRL")}</span>
            <span className="pequeno suave">{m.pedidos} pedidos{Number(m.taxas) ? ` · taxas ${dinheiro(m.taxas, "BRL")}` : ""}</span></div>))}</section>
      )}

      <section className="painel">
        <h2>Lançar relatório</h2>
        <form action={importarRelatorio} className="campos">
          <label>Marketplace<select name="canal" defaultValue="shopee">{Object.entries(NOMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Sai do estoque de<select name="deposito" defaultValue={d.deps[0].id}>{d.deps.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
          <label>Data (se o relatório não tiver)<input type="date" name="data" defaultValue={hojeISO()} /></label>
          <label className="largo">Arquivo CSV<input type="file" name="arquivo" accept=".csv,.txt,text/csv" /></label>
          <label className="largo">…ou cole as linhas da planilha (com o cabeçalho)
            <textarea name="colado" rows={6} style={{ fontFamily: "monospace" }} placeholder={"ID do pedido\tNúmero de referência SKU\tQuantidade\tPreço acordado\n2510ABC\tSHP-001\t2\t29,90\n\nSem cabeçalho: SKU e quantidade, um por linha"} /></label>
          <button className="principal">Lançar vendas e baixar estoque</button>
        </form>
        <p className="pequeno suave" style={{ margin: 0 }}>Colunas reconhecidas: nº do pedido, SKU (número de referência SKU), quantidade/unidades, preço, data, status (cancelados ficam de fora) e taxa/tarifa.
          Kits saem pelos componentes. Sem preço no relatório, usa o preço Brasil Normal como estimativa.</p>
      </section>

      {d.pend.length > 0 && (
        <section className="painel" style={{ borderColor: "var(--aviso)" }}>
          <h2>SKUs sem cadastro ({d.pend.length})</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>Diga qual produto do sistema é cada SKU: fica guardado para as próximas vezes e o estoque que faltou sai agora.</p>
          <datalist id="produtos-sku">{d.produtos.map((p) => <option key={p.codigo} value={`${p.codigo} · ${p.nome}`} />)}</datalist>
          <div className="tabela"><table>
            <thead><tr><th>SKU</th><th>Descrição</th><th className="num">Qtd</th><th>Produto do sistema</th></tr></thead>
            <tbody>{d.pend.map((x) => (
              <tr key={x.codigo}>
                <td><b>{x.codigo}</b></td><td className="pequeno">{x.descricao}</td><td className="num">{Number(x.qtd).toLocaleString("pt-BR")}</td>
                <td><form action={ligarSku} className="linha" style={{ gap: 6 }}>
                  <input type="hidden" name="sku" value={x.codigo} />
                  <input name="produto" list="produtos-sku" required placeholder="código ou nome" style={{ minWidth: 220 }} aria-label={`Produto para ${x.codigo}`} />
                  <button className="pequeno">Ligar</button>
                </form></td>
              </tr>))}</tbody>
          </table></div>
        </section>
      )}

      <section className="painel">
        <h2>Últimos lançamentos</h2>
        {d.historico.length === 0 ? <div className="vazio">Nenhum relatório lançado ainda.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Quando</th><th>Canal</th><th>Estoque</th><th>Arquivo</th><th className="num">Pedidos</th><th className="num">Repetidos</th><th className="num">Sem SKU</th><th className="num">Total</th><th>Quem</th></tr></thead>
            <tbody>{d.historico.map((h) => (
              <tr key={h.id}><td>{new Date(h.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td><td>{NOMES[h.canal] ?? h.canal}</td><td>{h.deposito}</td>
                <td className="pequeno">{h.arquivo}</td><td className="num">{h.pedidos}</td><td className="num">{h.repetidos}</td><td className="num">{h.sem_sku}</td>
                <td className="num">{dinheiro(h.total, "BRL")}</td><td>{h.quem}</td></tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
