import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, dinheiro } from "@/lib/formato";
import { Avisos, Selo } from "../../../avisos";
import { ligarItens, receberNota } from "../acoes";

export const metadata = { title: "Nota a chegar" };

export default async function Nota({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono vê notas.</div>;
  const { id } = await params;
  const f = await searchParams;
  const d = await comUsuario(u.id, async (c) => {
    const nota = (await c.query(`select c.*, f.nome fornecedor, dp.nome deposito, us.nome recebida_por_nome from app.compras c
      join app.fornecedores f on f.id = c.fornecedor_id left join app.depositos dp on dp.id = c.deposito_id
      left join app.usuarios us on us.id = c.recebida_por where c.id = $1`, [id])).rows[0];
    if (!nota) return null;
    const itens = (await c.query(`select i.*, p.nome produto, p.codigo produto_codigo, p.custo_unitario_brl custo_atual from app.compra_itens i
      left join app.produtos p on p.id = i.produto_id where i.compra_id = $1 order by i.ordem`, [id])).rows;
    const produtos = (await c.query(`select id, nome, codigo, ativo from app.produtos where marca = $1 order by ativo desc, nome`, [nota.marca])).rows as
      { id: string; nome: string; codigo: string; ativo: boolean }[];
    const depositos = (await c.query("select id, nome from app.depositos where ativo order by tipo, nome")).rows as { id: string; nome: string }[];
    return { nota, itens, produtos, depositos };
  });
  if (!d) return <div className="painel">Nota não encontrada.</div>;
  const n = d.nota;
  const aCaminho = n.status === "a_caminho";
  const freteUn = n.unidades ? Number(n.frete) / Number(n.unidades) : null;
  const semProduto = d.itens.filter((i) => !i.produto_id).length;
  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/estoque/notas">Notas a chegar</Link> / {n.nfe ?? "Nota"}</div>
          <h1>Nota {n.nfe ?? ""} · {n.fornecedor}</h1>
          <p>{n.marca} · {data(n.data)} · {aCaminho ? <Selo cor="aviso">A caminho</Selo> : <Selo cor="ok">Recebida em {data(n.recebida_em)} por {n.recebida_por_nome} ({n.deposito})</Selo>}</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <section className="indicadores">
        <div className="indicador"><span className="rotulo">Produtos na nota</span><span className="valor">{Number(n.unidades ?? 0).toLocaleString("pt-BR")}</span></div>
        <div className="indicador"><span className="rotulo">Valor (com desconto {n.desconto_pct ? `${Number(n.desconto_pct)}%` : "—"})</span><span className="valor">{dinheiro(n.valor_produtos, "BRL")}</span></div>
        <div className="indicador"><span className="rotulo">Frete</span><span className="valor">{dinheiro(n.frete, "BRL")}</span></div>
        <div className="indicador"><span className="rotulo">Frete por produto</span><span className="valor">{freteUn != null ? dinheiro(freteUn, "BRL") : "—"}</span></div>
      </section>

      <section className="painel">
        <h2>Itens</h2>
        {semProduto > 0 && aCaminho && <p className="pequeno" style={{ margin: 0 }}><Selo cor="aviso">{semProduto} item(ns) sem produto</Selo> Escolha o produto cadastrado ou deixe “não subir”: não será criado produto novo.</p>}
        <form action={ligarItens}>
          <input type="hidden" name="compra" value={n.id} />
          <div className="tabela"><table>
            <thead><tr><th>Cód. nota</th><th>Descrição na nota</th><th>Qtd</th><th>Valor unit.</th><th>Custo c/ desconto</th><th>Custo atual</th><th>Produto do sistema</th></tr></thead>
            <tbody>{d.itens.map((i) => (
              <tr key={i.id}>
                <td>{i.codigo_nota}</td><td>{i.descricao}</td><td className="num">{Number(i.quantidade).toLocaleString("pt-BR")}</td>
                <td className="num">{i.valor_unit != null ? dinheiro(i.valor_unit, "BRL") : "—"}</td>
                <td className="num">{i.custo_unit != null ? dinheiro(i.custo_unit, "BRL") : "—"}</td>
                <td className="num">{i.custo_atual != null ? dinheiro(i.custo_atual, "BRL") : "—"}</td>
                <td style={{ minWidth: 280 }}>{aCaminho ? (
                  <select name={`item:${i.id}`} defaultValue={i.produto_id ?? ""} aria-label={`Produto para ${i.descricao}`}>
                    <option value="">— não subir —</option>
                    {d.produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.ativo ? "" : " (inativo)"}</option>)}
                  </select>) : (i.produto ?? <span className="suave">não subiu</span>)}</td>
              </tr>))}</tbody>
          </table></div>
          {aCaminho && <button style={{ marginTop: 8 }}>Salvar produtos ligados</button>}
        </form>
      </section>

      {aCaminho && (
        <section className="painel">
          <h2>Chegou?</h2>
          <form action={receberNota} className="linha" style={{ flexWrap: "wrap", alignItems: "end" }}>
            <input type="hidden" name="compra" value={n.id} />
            <label>Depósito<select name="deposito" required defaultValue={d.depositos[0]?.id}>
              {d.depositos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
            <label className="pequeno"><input type="checkbox" name="atualizar_custo" value="1" /> Atualizar o custo dos produtos com o valor da nota</label>
            <button className="principal">Confirmar chegada e subir estoque</button>
          </form>
          <p className="pequeno suave" style={{ margin: 0 }}>Salve os produtos ligados antes. Sobe o estoque só dos itens ligados; o frete desta nota entra na média de frete por produto da marca {n.marca}.</p>
        </section>
      )}
    </>
  );
}
