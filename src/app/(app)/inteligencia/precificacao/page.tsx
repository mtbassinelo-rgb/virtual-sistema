import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { Avisos } from "../../avisos";
import { salvarMarcaInteligencia } from "../acoes";
import { salvarPrecificacao } from "./acoes";
import { GradePrecificacao, type LinhaPrec } from "./grade";

export const metadata = { title: "Precificação" };

const PAPEIS: Record<string, string> = { atracao: "Atração", rentabilidade: "Rentabilidade", diferenciacao: "Diferenciação", acompanhar: "Acompanhar" };

export default async function Precificacao({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono vê a precificação.</div>;
  const f = await searchParams;
  const d = await comUsuario(u.id, async (c) => {
    const linhas = (await c.query("select * from app.precificacao_py()")).rows as LinhaPrec[];
    const params = Object.fromEntries((await c.query(`select chave, valor from app.parametros
      where chave in ('cambio_custo_gs','margem_minima_contribuicao','arredondamento_gs','margem_alvo_normal','margem_alvo_vip','frete_padrao_brl')`)).rows.map((r) => [r.chave as string, Number(r.valor)]));
    const custos = (await c.query("select * from app.custos_variaveis_vigentes('PY')")).rows as { tipo: string; base: string; percentual: string | null; valor: string | null; moeda: string | null }[];
    const marcas = (await c.query(`select coalesce(nullif(trim(p.marca), ''), 'Sem marca') marca, count(*)::int n,
        coalesce(mi.gatilho, false) gatilho, coalesce(mi.papel, 'acompanhar') papel, mi.margem_alvo_normal, mi.margem_alvo_vip
      from app.produtos p left join app.marcas_inteligencia mi on mi.marca = coalesce(nullif(trim(p.marca), ''), 'Sem marca')
      where p.ativo group by 1, 3, 4, 5, 6 order by 3 desc, 2 desc`)).rows as
      { marca: string; n: number; gatilho: boolean; papel: string; margem_alvo_normal: string | null; margem_alvo_vip: string | null }[];
    return { linhas, params, custos, marcas };
  });
  const imposto = d.custos.filter((x) => x.base === "venda").reduce((s, x) => s + Number(x.percentual ?? 0), 0);
  const entregaCaixa = d.custos.filter((x) => x.base === "caixa" && x.moeda === "GS").reduce((s, x) => s + Number(x.valor ?? 0), 0);
  const premissas = { cambio: d.params.cambio_custo_gs ?? 1300, imposto, entregaCaixa, margemMin: d.params.margem_minima_contribuicao ?? 0, arred: d.params.arredondamento_gs || 500 };
  const noMotor = d.marcas.filter((m) => m.gatilho);
  const an = d.params.margem_alvo_normal ?? 35, av = d.params.margem_alvo_vip ?? 25;

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/inteligencia">Inteligência comercial</Link> / Precificação</div>
          <h1>Precificação Paraguai</h1>
          <p>Custo, frete, caixa e preços Normal e VIP de cada produto numa tabela só. Edite, veja a margem na hora e salve quando quiser.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      {(() => {
        // Exemplo fixo para explicar a conta: custo R$ 2,34 + frete, caixa de 12, VIP Gs 6.500
        const fr = d.params.frete_padrao_brl ?? 0.35, cf = 2.34 + fr, real = cf * premissas.cambio, ent = premissas.entregaCaixa / 12, imp = imposto / 100;
        const ar = (v: number) => Math.ceil(v / premissas.arred) * premissas.arred;
        const sv = ar((real + ent) / (1 - imp - av / 100)), sn = ar((real + ent) / (1 - imp - an / 100));
        const p = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
        const g = (v: number) => Math.round(v).toLocaleString("es-PY");
        return (
          <section className="painel" style={{ gap: 6 }}>
            <h2 style={{ margin: 0 }}>Como o motor calcula</h2>
            <div className="tabela"><table style={{ minWidth: 0 }}>
              <thead><tr><th>Passo</th><th>Conta</th><th>Exemplo (custo R$ 2,34, caixa de 12)</th></tr></thead>
              <tbody>
                <tr><td>1. Custo com frete</td><td>custo + frete por produto: média das notas fiscais da marca (Compras); sem notas, padrão R$ {fr.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} e Maycrene R$ 0,80; kit = frete × nº de produtos</td><td>R$ {cf.toFixed(2).replace(".", ",")}</td></tr>
                <tr><td>2. Em guaranis</td><td>× câmbio de custo {premissas.cambio.toLocaleString("pt-BR")}</td><td>Gs {g(real)}</td></tr>
                <tr><td>3. Margem de lucro</td><td>(preço − custo com frete) ÷ preço — igual à planilha Clientes VIP</td><td>VIP Gs 6.500 → {p((6500 - real) / 6500)}</td></tr>
                <tr><td>4. Margem líquida</td><td>tira imposto {imposto.toLocaleString("pt-BR")}% e entrega Gs {g(premissas.entregaCaixa)} ÷ peças da caixa</td><td>{p((6500 * (1 - imp) - real - ent) / 6500)}</td></tr>
                <tr><td>5. Preço mínimo</td><td>abaixo dele a venda dá prejuízo (margem líquida {premissas.margemMin}%)</td><td>Gs {g(ar((real + ent) / (1 - imp - premissas.margemMin / 100)))}</td></tr>
                <tr><td>6. Motor sugere</td><td>preço para ter margem líquida de {an}% no Normal e {av}% no VIP, arredondado em Gs {premissas.arred}</td>
                  <td>Normal Gs {g(sn)} (lucro {p((sn - real) / sn)}) · VIP Gs {g(sv)} (lucro {p((sv - real) / sv)})</td></tr>
              </tbody>
            </table></div>
            <div className="pequeno suave">Na tabela, cada preço mostra a <b>margem de lucro</b> em negrito e a líquida ao lado. Câmbio, frete padrão e margens-alvo: <Link href="/parametros">Parâmetros</Link>; margem por marca: quadro “Marcas do motor”.</div>
          </section>
        );
      })()}

      <details className="painel">
        <summary><b>Marcas do motor</b> <span className="pequeno suave">({noMotor.length} marcada(s){noMotor.length ? ": " + noMotor.map((m) => m.marca).join(", ") : ""}) · margem-alvo própria por marca</span></summary>
        <p className="pequeno suave">Marque as marcas que o motor acompanha e, se quiser, uma margem-alvo diferente do padrão (ex.: marca de atração com margem menor). O filtro “Só marcas do motor” mostra só elas.</p>
        <div className="tabela"><table style={{ minWidth: 0 }}>
          <thead><tr><th>Marca</th><th>Produtos</th><th>No motor</th><th>Papel</th><th>Alvo Normal %</th><th>Alvo VIP %</th><th></th></tr></thead>
          <tbody>{d.marcas.map((m) => (
            <tr key={m.marca}>
              <td>{m.marca}</td><td className="num">{m.n}</td>
              <td colSpan={5}>
                <form action={salvarMarcaInteligencia} className="linha" style={{ gap: 8 }}>
                  <input type="hidden" name="marca" value={m.marca} />
                  <input type="hidden" name="volta" value="precificacao" />
                  <label className="pequeno" style={{ width: 70 }}><input type="checkbox" name="gatilho" value="1" defaultChecked={m.gatilho} /> sim</label>
                  <select name="papel" defaultValue={m.papel} aria-label={`Papel de ${m.marca}`} style={{ width: 140 }}>
                    {Object.entries(PAPEIS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                  </select>
                  <input name="margem_normal" inputMode="decimal" style={{ width: 70 }} placeholder={String(an)} aria-label={`Alvo Normal de ${m.marca}`}
                    defaultValue={m.margem_alvo_normal == null ? "" : Number(m.margem_alvo_normal).toLocaleString("pt-BR")} />
                  <input name="margem_vip" inputMode="decimal" style={{ width: 70 }} placeholder={String(av)} aria-label={`Alvo VIP de ${m.marca}`}
                    defaultValue={m.margem_alvo_vip == null ? "" : Number(m.margem_alvo_vip).toLocaleString("pt-BR")} />
                  <button>Salvar</button>
                </form>
              </td>
            </tr>))}</tbody>
        </table></div>
      </details>

      <GradePrecificacao linhas={d.linhas} premissas={premissas} acao={salvarPrecificacao} />
    </>
  );
}
