import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, dinheiro, hojeISO, type Moeda } from "@/lib/formato";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { Avisos, Selo } from "../../avisos";
import { apagarContaUnidade, lancarContaUnidade, pagarContaUnidade } from "./acoes";

export const metadata = { title: "Contas da unidade" };

export default async function ContasUnidade({ searchParams }: { searchParams: Promise<{ u?: string; ver?: string; mes?: string; ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const gestao = u.perfil === "dono" || u.perfil === "gerente";
  const f = await searchParams;
  const { atual } = await unidadeSistema(u);
  const mes = /^\d{4}-\d{2}$/.test(f.mes ?? "") ? f.mes! : hojeISO().slice(0, 7);
  const ver = f.ver === "pagas" ? "pagas" : "abertas";
  const d = await comUsuario(u.id, async (c) => {
    const deps = (await c.query("select id, nome, pais from app.depositos where ativo and app.pode_operar_deposito(id) order by tipo, nome")).rows as { id: string; nome: string; pais: string }[];
    const dep = deps.find((x) => x.id === f.u) ?? deps.find((x) => x.id === atual?.id) ?? deps[0];
    if (!dep) return null;
    const lista = (await c.query(`select * from app.v_despesas where deposito_id = $1 and ${ver === "pagas" ? "date_trunc('month', pago_em) = $2::date" : "pago_em is null and $2::date is not null"}
      order by vencimento nulls last, criado_em limit 300`, [dep.id, `${mes}-01`])).rows;
    const resumo = (await c.query(`select moeda,
        coalesce(sum(valor) filter (where pago_em is null), 0) a_pagar,
        coalesce(sum(valor) filter (where pago_em is null and vencimento < current_date), 0) vencido,
        coalesce(sum(valor_pago) filter (where date_trunc('month', pago_em) = $2::date), 0) pago_mes
      from app.despesas where deposito_id = $1 group by moeda`, [dep.id, `${mes}-01`])).rows;
    const transf = (await c.query(`select coalesce(sum(valor_custo), 0) custo, count(*)::int n from app.transferencias
      where destino_id = $1 and status in ('enviada','recebida','recebida_com_divergencia') and date_trunc('month', enviada_em) = $2::date`, [dep.id, `${mes}-01`])).rows[0];
    const categorias = (await c.query("select codigo, nome from app.despesa_categorias where ativo and codigo <> 'mercadoria' order by ordem, nome")).rows as { codigo: string; nome: string }[];
    return { deps, dep, lista, resumo, transf, categorias };
  });
  if (!d) return <div className="painel">Você não é responsável por nenhuma unidade. O gerente marca em Equipe → acessos.</div>;
  const q = (o: Record<string, string>) => "/caixa/contas?" + new URLSearchParams({ u: d.dep.id, ver, mes, ...o });
  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/caixa">Caixa</Link> / Contas da unidade</div>
          <h1>Contas a pagar · {d.dep.nome}</h1>
          <p>Aluguel, luz, internet, limpeza… da unidade. Despesas pagas no caixa entram aqui sozinhas. A mercadoria recebida de outra unidade conta como custo.</p>
        </div>
        {d.deps.length > 1 && <nav className="troca-unidade">{d.deps.map((x) => <Link key={x.id} href={`/caixa/contas?u=${x.id}`} className={x.id === d.dep.id ? "atual" : ""}>{x.nome}</Link>)}</nav>}
      </section>
      <Avisos ok={f.ok} erro={f.erro} />
      <section className="indicadores">
        {d.resumo.map((r) => (
          <div key={r.moeda} className="indicador"><span className="rotulo">A pagar ({r.moeda === "GS" ? "Gs" : "R$"})</span><span className="valor num">{dinheiro(r.a_pagar, r.moeda)}</span>
            <span className="pequeno suave">vencido {dinheiro(r.vencido, r.moeda)} · pago no mês {dinheiro(r.pago_mes, r.moeda)}</span></div>))}
        {gestao && <div className="indicador"><span className="rotulo">Mercadoria recebida no mês (custo)</span><span className="valor num">{dinheiro(d.transf.custo, "BRL")}</span>
          <Link className="pequeno" href="/estoque/transferencias?ver=recebidas">{d.transf.n} envio(s) →</Link></div>}
      </section>
      <div className="linha" style={{ flexWrap: "wrap" }}>
        <nav className="filtros"><Link href={q({ ver: "abertas" })} className={ver === "abertas" ? "ativo" : ""}>A pagar</Link><Link href={q({ ver: "pagas" })} className={ver === "pagas" ? "ativo" : ""}>Pagas no mês</Link></nav>
        {ver === "pagas" && <form className="linha" method="get"><input type="hidden" name="u" value={d.dep.id} /><input type="hidden" name="ver" value="pagas" /><input type="month" name="mes" defaultValue={mes} aria-label="Mês" /><button>Ver</button></form>}
      </div>
      <section className="painel">
        {d.lista.length === 0 ? <div className="vazio">Nada aqui.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Vencimento</th><th>Conta</th><th>Categoria</th><th className="num">Valor</th><th>Situação</th><th></th></tr></thead>
            <tbody>{d.lista.map((x) => (
              <tr key={x.id}>
                <td>{x.vencimento ? data(x.vencimento) : "—"}</td>
                <td>{x.descricao}<div className="pequeno suave">{[x.fornecedor, x.documento, x.forma].filter(Boolean).join(" · ")}</div></td>
                <td>{x.categoria_nome}</td>
                <td className="num">{dinheiro(x.valor, x.moeda as Moeda)}</td>
                <td>{x.pago_em ? <Selo cor="ok">paga {data(x.pago_em)}</Selo> : x.situacao === "vencida" ? <Selo cor="erro">vencida</Selo> : <Selo cor="aviso">a pagar</Selo>}</td>
                <td>{!x.pago_em && (
                  <div className="linha" style={{ gap: 6 }}>
                    <form action={pagarContaUnidade} className="linha" style={{ gap: 4 }}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="deposito" value={d.dep.id} />
                      <input type="date" name="pago_em" defaultValue={hojeISO()} aria-label="Pago em" /><button className="principal pequeno">Pagar</button></form>
                    <form action={apagarContaUnidade}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="deposito" value={d.dep.id} /><button className="perigo pequeno">Apagar</button></form>
                  </div>)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      <section className="painel">
        <h2>Lançar conta</h2>
        <form action={lancarContaUnidade} className="campos">
          <input type="hidden" name="deposito" value={d.dep.id} />
          <label>Categoria<select name="categoria" required defaultValue="">{[<option key="" value="">Escolha…</option>, ...d.categorias.map((c) => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)]}</select></label>
          <label className="largo">Descrição<input name="descricao" required maxLength={200} placeholder="Ex.: Aluguel da loja, ANDE (luz)" /></label>
          <label>A quem pagar<input name="fornecedor" maxLength={120} /></label>
          <label>Moeda<select name="moeda" defaultValue={d.dep.pais === "PY" ? "GS" : "BRL"}><option value="GS">Gs</option><option value="BRL">R$</option></select></label>
          <label>Valor<input name="valor" inputMode="decimal" required /></label>
          <label>Vencimento<input name="vencimento" type="date" /></label>
          <label>Nº documento<input name="documento" maxLength={80} /></label>
          <label>Forma<input name="forma" maxLength={60} placeholder="Efetivo, transferência…" /></label>
          <label className="linha"><input type="checkbox" name="paga" value="1" style={{ width: "auto" }} /> Já está paga</label>
          <label>Pago em<input name="pago_em" type="date" defaultValue={hojeISO()} /></label>
          <button className="principal">Lançar</button>
        </form>
      </section>
    </>
  );
}
