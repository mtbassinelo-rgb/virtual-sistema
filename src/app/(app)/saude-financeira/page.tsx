import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { data, nomeMes } from "@/lib/formato";
import { LEVANTAMENTO as L } from "@/lib/saude-financeira";
import { Barra, Selo } from "../avisos";

export const metadata = { title: "Saúde financeira" };

const gs = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi`;
const rs = (v: number) => `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
const mesCurto = (m: string) => new Date(m + "-15T12:00:00").toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(". de ", "/").replace(" de ", "/");

/** Área exclusiva do dono (e de quem o dono liberar em Equipe → Acessos). A rota é protegida pela permissão "saude_financeira". */
export default async function SaudeFinanceira() {
  await exigirUsuario();
  const r = L.resumo;
  const maxVenda = Math.max(...L.vendasMensais.map((v) => v.recorrente + v.pontual));
  const ultimo = L.vendasMensais.at(-1)!, anterior = L.vendasMensais.at(-2)!;
  const queda = Math.round((1 - ultimo.recorrente / anterior.recorrente) * 100);
  const maxForn = Math.max(...L.compras.fornecedores.map((f) => f.reais));
  const top4 = L.compras.fornecedores.slice(0, 4).reduce((s, f) => s + f.reais, 0);
  const tri = L.resultado.reduce((s, x) => ({ v: s.v + x.vendas, c: s.c + x.compras, d: s.d + x.despesas, r: s.r + x.resultado }), { v: 0, c: 0, d: 0, r: 0 });

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Saúde financeira</h1>
          <p>Levantamento da distribuidora: vendas, compras com frete, despesas, margens e o que corrigir. Fotografia de {data(L.data)}, a partir das planilhas
            Controle Mensal, Central Financeira e Financas 2026. <Selo cor="marca">Área do dono</Selo></p>
        </div>
        <a className="botao" href={L.relatorio} target="_blank" rel="noopener noreferrer">Relatório completo ↗</a>
      </section>

      <section className="indicadores" aria-label="Números de jul a set/26">
        <div className="indicador"><span className="rotulo">Vendas jul–set/26</span><span className="valor">{gs(r.vendas)} Gs</span></div>
        <div className="indicador"><span className="rotulo">Compras com frete</span><span className="valor">{gs(r.compras)} Gs</span><span className="pequeno suave">{Math.round(r.compras / r.vendas * 100)}% das vendas</span></div>
        <div className="indicador"><span className="rotulo">Despesas</span><span className="valor">{gs(r.despesas)} Gs</span><span className="pequeno suave">{Math.round(r.despesas / r.vendas * 100)}% das vendas</span></div>
        <div className="indicador"><span className="rotulo">Resultado de caixa</span><span className="valor">{gs(r.resultado)} Gs</span><span className="pequeno suave">margem {r.margem.toLocaleString("pt-BR")}%</span></div>
        <div className="indicador"><span className="rotulo">Empate (vendas/mês)</span><span className="valor">≈ {r.empate} mi Gs</span></div>
        <div className="indicador"><span className="rotulo">Keila nas vendas recorrentes</span><span className="valor">{r.concentracaoKeila}</span></div>
      </section>

      <section className="painel">
        <h2>Atenção</h2>
        <ul className="saude-alertas">{L.alertas.map((a) => (
          <li key={a.titulo}><b>{a.titulo}.</b> <span>{a.texto}</span></li>
        ))}</ul>
      </section>

      <section className="painel">
        <div className="linha entre"><h2>Vendas por mês</h2><span className="pequeno suave">mi Gs · meta mensal somada {gs(L.metaMensal)}</span></div>
        <p className="pequeno suave" style={{ margin: 0 }}>Recorrentes triplicaram desde mai/25, mas set/26 caiu {queda}% contra ago/26. O pedido pontual do Freddy aparece à parte.</p>
        <div className="grafico-barras">{[...L.vendasMensais].reverse().map((v) => (
          <div key={v.mes} className="lin">
            <span>{nomeMes(v.mes)}</span>
            <Barra percentual={(v.recorrente / maxVenda) * 100} ok={v.recorrente >= L.metaMensal} />
            <span className="num">{gs(v.recorrente)}{v.pontual > 0 && <span className="pequeno suave"> + {gs(v.pontual)} pontual</span>}</span>
          </div>
        ))}</div>
        <div className="tabela"><table>
          <thead><tr><th>Canal (mi Gs)</th><th>Jul/26</th><th>Ago/26</th><th>Set/26</th><th>Meta</th><th>Média da meta</th></tr></thead>
          <tbody>{L.canais.map((c) => {
            const m = Math.round(((c.jul + c.ago + c.set) / 3 / c.meta) * 100);
            return (
              <tr key={c.canal}>
                <td>{c.canal}</td>
                <td className="num">{gs(c.jul)}</td><td className="num">{gs(c.ago)}</td><td className="num">{gs(c.set)}</td><td className="num">{gs(c.meta)}</td>
                <td className="num"><Selo cor={m >= 100 ? "ok" : m >= 85 ? "aviso" : "erro"}>{m}%</Selo></td>
              </tr>);
          })}</tbody>
        </table></div>
      </section>

      <section className="painel">
        <h2>Resultado de caixa</h2>
        <p className="pequeno suave" style={{ margin: 0 }}>Vendas − compras pagas no mês (com frete) − despesas. Não é o lucro contábil: sem controle de estoque, um mês que compra para estocar parece pior.</p>
        <div className="tabela"><table>
          <thead><tr><th>Mês</th><th>Vendas</th><th>Compras</th><th>Despesas</th><th>Resultado</th><th>Margem</th></tr></thead>
          <tbody>
            {L.resultado.map((x) => (
              <tr key={x.mes}>
                <td>{nomeMes(x.mes)}{x.nota && <div className="pequeno suave">{x.nota}</div>}</td>
                <td className="num">{gs(x.vendas)}</td><td className="num">{gs(x.compras)}</td><td className="num">{gs(x.despesas)}</td>
                <td className="num"><Selo cor={x.resultado >= 0 ? "ok" : "erro"}>{gs(x.resultado)}</Selo></td>
                <td className="num">{Math.round((x.resultado / x.vendas) * 1000) / 10}%</td>
              </tr>))}
            <tr className="total">
              <td><b>Jul–set/26</b></td>
              <td className="num"><b>{gs(tri.v)}</b></td><td className="num"><b>{gs(tri.c)}</b></td><td className="num"><b>{gs(tri.d)}</b></td>
              <td className="num"><b>{gs(tri.r)}</b></td><td className="num"><b>{Math.round((tri.r / tri.v) * 1000) / 10}%</b></td>
            </tr>
          </tbody>
        </table></div>
      </section>

      <section className="painel">
        <div className="linha entre"><h2>Compras por fornecedor</h2><span className="pequeno suave">jul a {data(L.data)}, com frete</span></div>
        <p className="pequeno suave" style={{ margin: 0 }}>Total {rs(L.compras.total)}, dos quais {rs(L.compras.frete)} de frete ({L.compras.fretePct.toLocaleString("pt-BR")}% sobre os produtos).
          Soul, Maycrene, Rhenuks e Bio Instinto somam {Math.round((top4 / L.compras.total) * 100)}%.</p>
        <div className="grafico-barras">{L.compras.fornecedores.map((f) => (
          <div key={f.nome} className="lin">
            <span>{f.nome}{f.fretePct > 0 && <span className="pequeno suave"> · frete {f.fretePct}%</span>}</span>
            <Barra percentual={(f.reais / maxForn) * 100} />
            <span className="num">{rs(f.reais)} <span className="pequeno suave">{Math.round((f.reais / L.compras.total) * 100)}%</span></span>
          </div>
        ))}</div>
        <div className="tabela"><table style={{ minWidth: 0 }}>
          <thead><tr><th>Mês</th><th>Produtos</th><th>Frete</th><th>Frete / produtos</th><th>Câmbio médio</th><th>Total</th></tr></thead>
          <tbody>{[...L.compras.cambio].reverse().map((m) => (
            <tr key={m.mes}>
              <td>{mesCurto(m.mes)}</td><td className="num">{rs(m.produtos)}</td><td className="num">{rs(m.frete)}</td>
              <td className="num">{Math.round((m.frete / m.produtos) * 1000) / 10}%</td>
              <td className="num">{m.cambio.toLocaleString("pt-BR")} Gs/R$</td><td className="num">{gs(m.totalGs)} Gs</td>
            </tr>))}</tbody>
        </table></div>
      </section>

      <section className="painel">
        <div className="linha entre"><h2>Despesas</h2><Link className="botao" href="/despesas">Lançar e pagar contas</Link></div>
        <div className="tabela"><table style={{ minWidth: 0 }}>
          <thead><tr><th>Despesa (mi Gs)</th><th>Jul/26</th><th>Ago/26</th><th>Set/26</th></tr></thead>
          <tbody>
            {L.despesas.map((d) => (
              <tr key={d.tipo}><td>{d.tipo}</td><td className="num">{gs(d.jul)}</td><td className="num">{gs(d.ago)}</td><td className="num">{gs(d.set)}</td></tr>
            ))}
            <tr className="total"><td><b>Total</b></td>
              {(["jul", "ago", "set"] as const).map((k) => <td key={k} className="num"><b>{gs(L.despesas.reduce((s, d) => s + d[k], 0))}</b></td>)}
            </tr>
          </tbody>
        </table></div>
        <div className="pequeno"><b>Ainda não aparecem como despesa:</b>
          <ul style={{ margin: "4px 0 0" }}>{L.despesasFaltando.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </section>

      <section className="painel">
        <div className="linha entre"><h2>Margem VIP por fornecedor</h2><span className="pequeno suave">preço VIP em Gs sobre custo com frete</span></div>
        <p className="pequeno suave" style={{ margin: 0 }}>A planilha calcula com 1.300 Gs/R$; o câmbio de compra hoje é 1.120. Média de {L.margemMedia.planilha}% na planilha e {L.margemMedia.real}% no câmbio real
          (preço Normal: {L.margemMedia.normalReal}%).</p>
        <div className="saude-legenda pequeno suave"><span className="ponto planilha" /> câmbio da planilha (1.300) <span className="ponto real" /> câmbio real (1.120)</div>
        <div className="grafico-barras">{L.margens.map((m) => (
          <div key={m.fornecedor} className="lin">
            <span>{m.fornecedor} <span className="pequeno suave">({m.produtos})</span></span>
            <div className="saude-faixa" role="img" aria-label={`${m.fornecedor}: ${m.planilha}% na planilha, ${m.real}% no câmbio real`}>
              <span className="trilho" style={{ left: `${(m.planilha / 60) * 100}%`, width: `${((m.real - m.planilha) / 60) * 100}%` }} />
              <span className="ponto planilha" style={{ left: `${(m.planilha / 60) * 100}%` }} />
              <span className="ponto real" style={{ left: `${(m.real / 60) * 100}%` }} />
            </div>
            <span className="num"><Selo cor={m.real < 35 ? "aviso" : "ok"}>{Math.round(m.real)}%</Selo></span>
          </div>
        ))}</div>
      </section>

      <section className="painel">
        <h2>Plano de ação</h2>
        <div className="saude-plano">{L.plano.map((g) => (
          <div key={g.grupo}>
            <h3>{g.grupo}</h3>
            <ul>{g.itens.map((i) => <li key={i}>{i}</li>)}</ul>
          </div>
        ))}</div>
      </section>
    </>
  );
}
