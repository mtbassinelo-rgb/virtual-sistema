import Link from "next/link";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { Avisos } from "../../avisos";
import { corrigirCustos } from "./acoes";

export const metadata = { title: "Revisar custos" };

type L = { id: string; codigo: string; nome: string; marca: string | null; custo: string; origem: string | null; unidades_caixa: number | null;
  py_normal: string | null; br_normal: string | null; estoque: number };

const rs = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const gs = (v: number) => `Gs ${Math.round(v).toLocaleString("es-PY")}`;

/** Produtos cujo custo por unidade parece ser o custo da caixa (custo ≥ 90% do preço de venda). */
export default async function RevisarCustos({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; ver?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono revisa custos.</div>;
  const f = await searchParams;
  const d = await comUsuario(u.id, async (c) => {
    const cambio = Number((await c.query("select app.param('cambio_custo_gs') v")).rows[0]?.v) || 1300;
    const ultimo = (t: string) => `(select valor from app.precos z where z.produto_id = p.id and z.tabela = '${t}' and z.vigente_desde <= current_date order by vigente_desde desc limit 1)`;
    const linhas = (await c.query(`select * from (
        select p.id, p.codigo, p.nome, p.marca, app.custo_produto(p.id) custo, p.custo_origem origem, p.unidades_caixa,
               ${ultimo("py_normal")} py_normal, ${ultimo("br_normal")} br_normal,
               coalesce((select sum(quantidade) from app.estoque_saldos s where s.produto_id = p.id), 0)::float estoque
          from app.produtos p where p.ativo and p.codigo is not null) x
       where x.custo > 0 and ((x.py_normal > 0 and x.custo * $1 >= x.py_normal * 0.9) or (x.br_normal > 0 and x.custo >= x.br_normal * 0.9))
       order by x.marca nulls last, x.nome`, [cambio])).rows as L[];
    return { cambio, linhas };
  });

  const linhas = d.linhas.map((l) => {
    const custo = Number(l.custo), py = l.py_normal ? Number(l.py_normal) : null, br = l.br_normal ? Number(l.br_normal) : null;
    const venda = py ? py / d.cambio : br!;                         // preço de venda em R$ para comparar
    const uc = l.unidades_caixa && l.unidades_caixa > 1 ? l.unidades_caixa : null;
    const sugestao = uc ? custo / uc : null;
    const margemSug = sugestao != null ? 1 - sugestao / venda : null;
    const confiavel = sugestao != null && margemSug != null && margemSug > 0.05 && margemSug < 0.85;
    return { ...l, custoN: custo, py, br, venda, uc, sugestao, margemAtual: 1 - custo / venda, margemSug, confiavel };
  });
  const ver = f.ver === "todos" ? "todos" : "caixa";
  const lista = ver === "todos" ? linhas : linhas.filter((l) => l.sugestao != null);
  const estoqueErrado = linhas.reduce((s, l) => s + (l.sugestao != null ? (l.custoN - l.sugestao) * Math.max(l.estoque, 0) : 0), 0);

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/produtos">Produtos</Link> / Revisar custos</div>
          <h1>Revisar custos</h1>
          <p>Produtos em que o custo por unidade é quase igual ou maior que o preço de venda. Quase sempre é o custo da <b>caixa</b> gravado como custo da unidade.
            Isso infla o valor do estoque e mostra prejuízo falso no financeiro. Nada muda até você marcar e salvar.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <section className="indicadores">
        <div className="indicador"><span className="rotulo">Produtos suspeitos</span><span className="valor num">{linhas.length}</span></div>
        <div className="indicador"><span className="rotulo">Com unidades por caixa (dá para sugerir)</span><span className="valor num">{linhas.filter((l) => l.sugestao != null).length}</span></div>
        <div className="indicador destaque-erro"><span className="rotulo">Estoque supervalorizado (aprox.)</span><span className="valor num">{rs(estoqueErrado)}</span></div>
      </section>

      <nav className="filtros painel">
        <Link href="/produtos/custos" className={ver === "caixa" ? "ativo" : ""}>Com sugestão (custo ÷ unidades da caixa)</Link>
        <Link href="/produtos/custos?ver=todos" className={ver === "todos" ? "ativo" : ""}>Todos os suspeitos ({linhas.length})</Link>
      </nav>

      {lista.length === 0 ? <div className="painel vazio">Nenhum custo suspeito. 👍</div> : (
        <form action={corrigirCustos} className="painel">
          <p className="pequeno suave">Câmbio do custo: Gs {d.cambio.toLocaleString("es-PY")} por R$. Já vem marcado só onde a sugestão deixa uma margem normal (5% a 85%). Confira e ajuste o custo se precisar.</p>
          <div className="tabela"><table>
            <thead><tr><th>Corrigir</th><th>Produto</th><th className="num">Preço de venda</th><th className="num">Custo atual</th><th className="num">Un./caixa</th><th className="num">Novo custo por unidade (R$)</th><th className="num">Margem nova</th></tr></thead>
            <tbody>{lista.map((l) => (
              <tr key={l.id}>
                <td><input type="checkbox" name={`ok:${l.codigo}`} value="1" defaultChecked={l.confiavel} style={{ width: "auto" }} aria-label={`Corrigir ${l.nome}`} /></td>
                <td><Link href={`/produtos/${l.id}`}>{l.nome}</Link><div className="pequeno suave">{l.codigo} · {l.marca ?? "sem marca"}{l.estoque > 0 ? ` · ${l.estoque} em estoque` : ""}</div></td>
                <td className="num">{l.py ? gs(l.py) : rs(l.br!)}{l.py ? <div className="pequeno suave">≈ {rs(l.venda)}</div> : null}</td>
                <td className="num" style={{ color: "var(--erro)" }}>{rs(l.custoN)}<div className="pequeno suave">margem {Math.round(l.margemAtual * 100)}%</div></td>
                <td className="num">{l.uc ?? "—"}</td>
                <td className="num"><input name={`custo:${l.codigo}`} inputMode="decimal" defaultValue={l.sugestao != null ? l.sugestao.toFixed(2).replace(".", ",") : ""} style={{ width: 110 }} placeholder="informe" /></td>
                <td className="num">{l.margemSug != null ? `${Math.round(l.margemSug * 100)}%` : "—"}</td>
              </tr>))}</tbody>
          </table></div>
          <div className="linha" style={{ marginTop: 12 }}><button className="principal">Salvar os marcados</button></div>
        </form>
      )}
    </>
  );
}
