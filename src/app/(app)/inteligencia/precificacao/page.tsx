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
      where chave in ('cambio_custo_gs','margem_minima_contribuicao','arredondamento_gs','margem_alvo_normal','margem_alvo_vip')`)).rows.map((r) => [r.chave as string, Number(r.valor)]));
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

      <section className="painel pequeno suave" style={{ gap: 4 }}>
        <div>
          Câmbio de custo <b>{premissas.cambio.toLocaleString("pt-BR")} Gs/R$</b> · imposto <b>{imposto.toLocaleString("pt-BR")}%</b> · entrega <b>Gs {entregaCaixa.toLocaleString("es-PY")}</b> por caixa ·
          margem-alvo padrão <b>Normal {an}% · VIP {av}%</b> · margem mínima <b>{premissas.margemMin}%</b> · <Link href="/parametros">mudar em Parâmetros</Link>
        </div>
        <div>Margem = (preço − imposto − custo total) ÷ preço. Preço sugerido = custo total ÷ (1 − imposto − margem-alvo), arredondado para cima em Gs {premissas.arred} e nunca abaixo do mínimo.
          Custos vieram da planilha PRODUCTOS VC (aba Clientes VIP e abas de cada fornecedor); a origem aparece embaixo do nome.</div>
      </section>

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
