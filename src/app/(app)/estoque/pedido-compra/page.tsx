import Link from "next/link";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro } from "@/lib/formato";
import { linhasCompra } from "./dados";
import { GradeCompra } from "./grade";

export const metadata = { title: "Pedido de compra" };

/**
 * Pedido de compra por marca: a lista de produtos fica no sistema, cada um preenche a quantidade
 * (salva na hora) e no fim exporta a planilha para o fornecedor. Custo sempre sem frete.
 */
export default async function PedidoCompra({ searchParams }: { searchParams: Promise<{ marca?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) redirect("/relatorios/compra");
  const f = await searchParams;
  const marca = (f.marca ?? "").trim() || null;

  const d = await comUsuario(u.id, async (c) => ({
    marcas: (await c.query(`
      select p.marca, count(*)::int n, count(l.produto_id)::int no_pedido,
             coalesce(sum(l.quantidade * app.custo_produto(p.id)), 0) as total
        from app.produtos p left join app.compra_lista l on l.produto_id = p.id
       where p.ativo and p.marca is not null and trim(p.marca) <> ''
       group by 1 order by 1`)).rows as { marca: string; n: number; no_pedido: number; total: string }[],
    linhas: marca ? await linhasCompra(c, marca) : [],
  }));
  const emAndamento = d.marcas.filter((m) => m.no_pedido > 0);

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/estoque">Estoque e compras</Link> / Pedido de compra</div>
          <h1>Pedido de compra{marca ? `: ${marca}` : ""}</h1>
          <p>Escolha a marca e preencha a quantidade de cada produto: fica salvo na hora, e qualquer gerente pode continuar depois.
            No fim, exporte a planilha e mande ao fornecedor. Custo por unidade sempre <b>sem frete</b>.</p>
        </div>
      </section>

      <form className="painel campos" method="get">
        <label>Marca
          <select name="marca" defaultValue={marca ?? ""}>
            <option value="">—</option>
            {d.marcas.map((m) => <option key={m.marca} value={m.marca}>{m.marca} ({m.n}){m.no_pedido ? ` · ${m.no_pedido} no pedido` : ""}</option>)}
          </select>
        </label>
        <div className="largo"><button className="principal">Abrir</button>
          <Link className="botao" href={`/relatorios/compra${marca ? `?marca=${encodeURIComponent(marca)}` : ""}`} style={{ marginLeft: 8 }}>Ver sugestão de compra (vendas e estoque)</Link></div>
      </form>

      {!marca ? (
        emAndamento.length === 0 ? <div className="vazio">Escolha uma marca para montar o pedido.</div> : (
          <section className="painel">
            <h2>Pedidos em andamento</h2>
            <div className="tabela"><table>
              <thead><tr><th>Marca</th><th className="num">Produtos no pedido</th><th className="num">Total (sem frete)</th><th></th></tr></thead>
              <tbody>{emAndamento.map((m) => (
                <tr key={m.marca}><td><Link href={`?marca=${encodeURIComponent(m.marca)}`}>{m.marca}</Link></td>
                  <td className="num">{m.no_pedido}</td><td className="num">{dinheiro(Number(m.total), "BRL")}</td>
                  <td><Link href={`?marca=${encodeURIComponent(m.marca)}`}>Continuar</Link></td></tr>
              ))}</tbody>
            </table></div>
          </section>
        )
      ) : d.linhas.length === 0 ? <div className="vazio">Nenhum produto ativo desta marca.</div> : (
        <GradeCompra key={marca} marca={marca} linhas={d.linhas} />
      )}
    </>
  );
}
