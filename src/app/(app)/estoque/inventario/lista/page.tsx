import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { sugerirProdutos, sugestaoSegura, type ProdutoBase } from "@/lib/lista-inventario";
import { Avisos, Selo } from "../../../avisos";
import { salvarLista } from "./acoes";

export const metadata = { title: "Lista de inventário para conferir" };

type Linha = {
  id: string; ordem: number; descricao: string; marca: string | null; quantidade: number | null; caixas: number | null;
  foto_ref: string | null; observacao: string | null; decisao: string; produto_id: string | null; status: string;
  produto_nome: string | null; produto_codigo: string | null;
};
type Produto = ProdutoBase & { codigo: string; foto: string | null; caixa: number | null; saldo: number };

const qtd = (n: number | null) => (n == null ? "" : Number(n).toLocaleString("pt-BR"));

export default async function ListaInventario({ searchParams }: { searchParams: Promise<{ l?: string; ok?: string; erro?: string; ver?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono confere a lista de inventário.</div>;
  const f = await searchParams;
  const d = await comUsuario(u.id, async (c) => {
    const listas = (await c.query(`select l.lista, dp.nome deposito, dp.id deposito_id, count(*) filter (where l.status = 'aberto')::int abertos, max(l.criado_em) em
        from app.inventario_lista l join app.depositos dp on dp.id = l.deposito_id group by l.lista, dp.nome, dp.id order by em desc`)).rows as
      { lista: string; deposito: string; deposito_id: string; abertos: number }[];
    const atual = listas.find((x) => x.lista === f.l) ?? listas.find((x) => x.abertos > 0) ?? listas[0];
    if (!atual) return null;
    const linhas = (await c.query(`select l.*, l.quantidade::float quantidade, l.caixas::float caixas, p.nome produto_nome, p.codigo produto_codigo
        from app.inventario_lista l left join app.produtos p on p.id = l.produto_id where l.lista = $1 order by l.ordem`, [atual.lista])).rows as Linha[];
    const produtos = (await c.query(`select p.id, p.codigo, p.nome, p.marca, p.ativo, p.tipo, p.foto, p.unidades_caixa_fornecedor::float caixa,
        coalesce((select quantidade from app.estoque_saldos s where s.deposito_id = $1 and s.produto_id = p.id), 0)::float saldo
        from app.produtos p`, [atual.deposito_id])).rows as Produto[];
    return { listas, atual, linhas, produtos };
  });
  if (!d) return <div className="painel">Nenhuma lista de inventário para conferir.</div>;

  const porId = new Map(d.produtos.map((p) => [p.id, p]));
  const abertas = d.linhas.filter((l) => l.status === "aberto");
  const fechadas = d.linhas.filter((l) => l.status !== "aberto");
  const opcoes = abertas.map((l) => {
    const sug = sugerirProdutos(l.descricao, l.marca, d.produtos);
    const escolhido = l.decisao === "existente" && l.produto_id ? `p:${l.produto_id}`
      : l.decisao === "novo" || l.decisao === "ignorar" ? l.decisao
      : (() => { const s = sugestaoSegura(sug); return s ? `p:${s}` : ""; })();
    const ids = [...new Set([...(l.produto_id ? [l.produto_id] : []), ...sug.map((s) => s.id)])];
    const prod = escolhido.startsWith("p:") ? porId.get(escolhido.slice(2)) : undefined;
    const quantidade = l.quantidade ?? (l.caixas && prod?.caixa ? l.caixas * prod.caixa : null);
    return { l, ids, escolhido, prod, quantidade, sugerido: !!sug.length && escolhido === `p:${sug[0].id}` && l.decisao === "pendente" };
  });
  const semEscolha = opcoes.filter((o) => !o.escolhido).length;

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/estoque">Estoque</Link> / <Link href={`/estoque/inventario?u=${d.atual.deposito_id}`}>Inventário</Link> / Lista para conferir</div>
          <h1>Lista {d.atual.lista} · {d.atual.deposito}</h1>
          <p>Para cada item, confira a foto e escolha o produto do sistema. A quantidade <b>soma</b> ao estoque de {d.atual.deposito} (não substitui).
            Se o produto não existir, escolha <b>Cadastrar como produto novo</b>: ele é criado sem preço, com estoque 0 no Brasil, e a foto da lista vira a foto do produto.
            Kit escolhido soma no shampoo e na máscara do kit.</p>
        </div>
        {d.listas.length > 1 && (
          <nav className="troca-unidade" aria-label="Lista">
            {d.listas.map((x) => <Link key={x.lista} href={`/estoque/inventario/lista?l=${encodeURIComponent(x.lista)}`} className={x.lista === d.atual.lista ? "atual" : ""}>{x.lista}</Link>)}
          </nav>
        )}
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <section className="indicadores">
        <div className="indicador"><span className="rotulo">Para conferir</span><span className="valor">{abertas.length}</span></div>
        <div className="indicador"><span className="rotulo">Sem escolha</span><span className="valor">{semEscolha}</span></div>
        <div className="indicador"><span className="rotulo">Já lançados</span><span className="valor">{fechadas.filter((x) => x.status === "lancado").length}</span></div>
        <div className="indicador"><span className="rotulo">Unidades a lançar</span><span className="valor">{opcoes.reduce((s, o) => s + (o.quantidade ?? 0), 0).toLocaleString("pt-BR")}</span></div>
      </section>

      {abertas.length > 0 ? (
        <form action={salvarLista} className="painel">
          <input type="hidden" name="lista" value={d.atual.lista} />
          <p className="pequeno suave" style={{ marginTop: 0 }}>
            <Selo cor="ok">sugestão</Selo> = o sistema achou um produto bem parecido: confira a foto. Linhas sem escolha ficam para depois.
          </p>
          <div className="tabela"><table>
            <thead><tr><th>Foto</th><th>Item da lista</th><th>Produto do sistema</th><th>Quantidade (un)</th></tr></thead>
            <tbody>{opcoes.map(({ l, ids, escolhido, prod, quantidade, sugerido }) => (
              <tr key={l.id}>
                <td style={{ width: 132 }}>
                  <div className="linha" style={{ gap: 6 }}>
                    {l.foto_ref ? <a href={l.foto_ref} target="_blank" rel="noreferrer"><img src={l.foto_ref} alt={l.descricao} width={60} height={60} style={{ objectFit: "cover", borderRadius: 6 }} /></a>
                      : <span className="pequeno suave" style={{ width: 60 }}>sem foto</span>}
                    {prod?.foto && <img src={prod.foto} alt={prod.nome} title="Foto do produto escolhido" width={60} height={60} style={{ objectFit: "cover", borderRadius: 6, outline: "2px solid var(--ok, #2e7d32)" }} />}
                  </div>
                </td>
                <td>
                  <b>{l.descricao}</b>{l.marca && <span className="pequeno suave"> · {l.marca}</span>}
                  {l.caixas != null && <div className="pequeno"><Selo cor="aviso">{qtd(l.caixas)} caixa(s)</Selo> informe em unidades</div>}
                  {l.observacao && <div className="pequeno suave">{l.observacao}</div>}
                </td>
                <td style={{ minWidth: 300 }}>
                  <select name={`d:${l.id}`} defaultValue={escolhido} aria-label={`Produto para ${l.descricao}`}>
                    <option value="">— decidir depois —</option>
                    {ids.map((id) => { const p = porId.get(id); return p ? (
                      <option key={id} value={`p:${id}`}>{p.nome}{p.marca ? ` · ${p.marca}` : ""} · {p.codigo} · tem {qtd(p.saldo)} aqui{p.tipo === "kit" ? " (kit)" : ""}{p.ativo ? "" : " (inativo)"}</option>) : null; })}
                    <option value="novo">➕ Cadastrar como produto novo</option>
                    <option value="ignorar">Não lançar</option>
                  </select>
                  {sugerido && <div className="pequeno"><Selo cor="ok">sugestão</Selo></div>}
                  {!ids.length && <div className="pequeno suave">Nada parecido no cadastro: provavelmente é produto novo.</div>}
                </td>
                <td style={{ width: 110 }}>
                  <input name={`q:${l.id}`} inputMode="numeric" defaultValue={quantidade ?? ""} placeholder={l.caixas != null ? "unidades" : ""} style={{ width: 90 }} aria-label={`Quantidade de ${l.descricao}`} />
                </td>
              </tr>))}</tbody>
          </table></div>
          <div className="linha" style={{ marginTop: 12, flexWrap: "wrap" }}>
            <button name="acao" value="salvar">Salvar escolhas</button>
            <button name="acao" value="lancar" className="principal">Salvar e lançar no estoque de {d.atual.deposito}</button>
          </div>
          <p className="pequeno suave" style={{ marginBottom: 0 }}>Lança só as linhas com produto escolhido (ou “produto novo”) e quantidade. As outras continuam aqui para depois.</p>
        </form>
      ) : <div className="painel">Tudo desta lista já foi lançado. ✔</div>}

      {fechadas.length > 0 && (
        <details className="painel" open={f.ver === "lancados"}>
          <summary><Selo cor="ok">{fechadas.length}</Selo> Já lançados ou deixados de fora</summary>
          <div className="tabela"><table>
            <thead><tr><th>Item da lista</th><th>Produto</th><th>Quantidade</th><th>Situação</th></tr></thead>
            <tbody>{fechadas.map((l) => (
              <tr key={l.id}>
                <td>{l.descricao}</td>
                <td>{l.produto_id ? <Link href={`/produtos/${l.produto_id}`}>{l.produto_nome}</Link> : "—"}{l.produto_codigo && <span className="pequeno suave"> · {l.produto_codigo}</span>}</td>
                <td className="num">{qtd(l.quantidade)}</td>
                <td>{l.status === "lancado" ? <Selo cor="ok">{l.decisao === "novo" ? "Produto novo + estoque" : "Somado ao estoque"}</Selo> : <Selo cor="aviso">Não lançado</Selo>}</td>
              </tr>))}</tbody>
          </table></div>
        </details>
      )}
    </>
  );
}
