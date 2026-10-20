import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, dinheiro, pct } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import { salvarCustoVariavel, salvarFreteMarca } from "./acoes";

export const metadata = { title: "Inteligência comercial" };

type Linha = {
  produto_id: string; codigo: string; nome: string; marca: string | null; tipo: string; mostrar_no_site: boolean; unidades_caixa: number | null;
  custo_brl: string | null; frete_brl: string | null; custo_real_brl: string | null; custo_real_gs: string | null; entrega_unidade_gs: string | null;
  preco_normal: string | null; preco_vip: string | null; margem_bruta_vip: string | null; contribuicao_normal: string | null; contribuicao_vip: string | null;
  preco_minimo: string | null; margem_bruta_vip_cambio_real: string | null; vendido_90: string; saldo: string | null; situacao_giro: string | null;
  alertas: string[]; completo: boolean; impostos_pct: string; entrega_caixa_gs: string | null; cambio: string; cambio_real: string;
};

const ABAS = [
  { k: "saude", t: "Saúde dos dados", d: "O que falta no cadastro para calcular custo, margem e preço mínimo de cada produto vendido ao Paraguai." },
  { k: "rentabilidade", t: "Rentabilidade PY", d: "Margem bruta, margem de contribuição e preço mínimo por produto, nas tabelas Normal e VIP do Paraguai. Só leitura: nada aqui muda preço." },
  { k: "custos", t: "Custos e frete", d: "Frete de compra por marca, imposto e entrega usados nos cálculos. Cada mudança fica na auditoria." },
];

const ALERTAS: Record<string, { t: string; cor: string }> = {
  sem_custo: { t: "Sem custo", cor: "erro" },
  sem_frete: { t: "Sem frete", cor: "aviso" },
  sem_caixa: { t: "Sem caixa", cor: "aviso" },
  sem_preco_normal: { t: "Sem preço Normal", cor: "aviso" },
  sem_preco_vip: { t: "Sem preço VIP", cor: "aviso" },
  contribuicao_negativa: { t: "Contribuição negativa", cor: "erro" },
  abaixo_minimo: { t: "VIP abaixo do mínimo", cor: "erro" },
};

const TIPOS: Record<string, string> = { imposto: "Imposto", comissao: "Comissão", taxa_pagamento: "Taxa de pagamento", taxa_canal: "Taxa do canal", entrega: "Entrega (pasero)" };
const BASES: Record<string, string> = { venda: "% sobre a venda", caixa: "Gs por caixa", pedido: "Gs por pedido" };

const n = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const gs = (v: string | number | null | undefined) => dinheiro(v ?? null, "GS");

export default async function Inteligencia({ searchParams }: {
  searchParams: Promise<{ aba?: string; q?: string; marca?: string; alerta?: string; ok?: string; erro?: string }>;
}) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const aba = ABAS.find((a) => a.k === f.aba) ?? ABAS[0];
  const gerir = ehGestao(u);

  const d = await comUsuario(u.id, async (c) => ({
    linhas: (await c.query("select * from app.rentabilidade_py() order by marca nulls last, nome")).rows as Linha[],
    custos: (await c.query("select * from app.custos_variaveis_vigentes('PY') order by tipo, base")).rows as
      { tipo: string; base: string; percentual: string | null; valor: string | null; vigente_desde: string; observacao: string | null }[],
    historico: aba.k === "custos" ? (await c.query(`select c.*, us.nome as quem from app.custos_variaveis c left join app.usuarios us on us.id = c.definido_por
        where c.pais = 'PY' order by c.vigente_desde desc, c.criado_em desc limit 30`)).rows : [],
    fretes: aba.k === "custos" ? (await c.query(`select coalesce(p.marca, 'Sem marca') as marca, count(*)::int produtos,
        count(*) filter (where p.frete_unidade_brl is not null)::int excecoes, f.frete_unidade_brl, f.observacao
        from app.produtos p left join app.frete_marca f on f.marca = p.marca
        where p.ativo group by 1, f.frete_unidade_brl, f.observacao order by (f.frete_unidade_brl is null) desc, produtos desc`)).rows : [],
    params: Object.fromEntries((await c.query("select chave, valor from app.parametros where chave in ('cambio_custo_gs','cambio_compra_gs','margem_minima_contribuicao')")).rows
      .map((r) => [r.chave as string, Number(r.valor)])),
  }));

  const L = d.linhas;
  const total = L.length;
  const conta = (a: string) => L.filter((l) => l.alertas.includes(a)).length;
  const completos = L.filter((l) => l.completo).length;
  const cambio = d.params.cambio_custo_gs, cambioReal = d.params.cambio_compra_gs, margemMin = d.params.margem_minima_contribuicao ?? 0;
  const imposto = d.custos.filter((x) => x.base === "venda").reduce((s, x) => s + Number(x.percentual ?? 0), 0);
  const entregaCaixa = d.custos.find((x) => x.tipo === "entrega" && x.base === "caixa");

  // Filtros da rentabilidade
  const q = (f.q ?? "").trim().toLowerCase();
  const filtradas = L.filter((l) => (!q || `${l.codigo} ${l.nome} ${l.marca ?? ""}`.toLowerCase().includes(q))
    && (!f.marca || (l.marca ?? "Sem marca") === f.marca)
    && (!f.alerta || (f.alerta === "completos" ? l.completo : l.alertas.includes(f.alerta))))
    .sort((a, b) => (n(a.contribuicao_vip) ?? 9) - (n(b.contribuicao_vip) ?? 9));
  const LIMITE = 400;
  const marcas = [...new Set(L.map((l) => l.marca ?? "Sem marca"))].sort();
  const url = (p: Record<string, string | undefined>) => {
    const s = new URLSearchParams();
    Object.entries({ aba: "rentabilidade", q: f.q, marca: f.marca, alerta: f.alerta, ...p }).forEach(([k, v]) => { if (v) s.set(k, v); });
    return `/inteligencia?${s}`;
  };

  // Marcas sem frete cadastrado (para a Saúde dos dados)
  const semFretePorMarca = Object.entries(L.filter((l) => l.alertas.includes("sem_frete"))
    .reduce<Record<string, number>>((acc, l) => { const m = l.marca ?? "Sem marca"; acc[m] = (acc[m] ?? 0) + 1; return acc; }, {}))
    .sort((a, b) => b[1] - a[1]);
  const negativos = L.filter((l) => l.alertas.includes("contribuicao_negativa") || l.alertas.includes("abaixo_minimo"))
    .sort((a, b) => (n(a.contribuicao_vip) ?? 0) - (n(b.contribuicao_vip) ?? 0));

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Inteligência comercial</h1>
          <p>{aba.d}</p>
        </div>
      </section>
      <nav className="abas" aria-label="Inteligência comercial">
        {ABAS.map((a) => <a key={a.k} href={`/inteligencia?aba=${a.k}`} aria-current={a.k === aba.k ? "page" : undefined}>{a.t}</a>)}
      </nav>
      <Avisos ok={f.ok} erro={f.erro} />

      <section className="painel pequeno suave" style={{ gap: 4 }}>
        <div>
          Premissas em uso (Paraguai): câmbio de custo <b>{cambio?.toLocaleString("pt-BR")} Gs/R$</b> · câmbio real de compra <b>{cambioReal?.toLocaleString("pt-BR")}</b> ·
          imposto <b>{imposto.toLocaleString("pt-BR")}%</b> sobre a venda · entrega <b>{entregaCaixa ? gs(entregaCaixa.valor) : "—"}</b> por caixa ·
          margem mínima de contribuição <b>{margemMin.toLocaleString("pt-BR")}%</b>
        </div>
        <div>Comissão e taxas de pagamento ainda não estão cadastradas e não entram no cálculo. <Link href="/parametros">Câmbios e margem mínima em Parâmetros</Link>.</div>
      </section>

      {aba.k === "saude" && (
        <>
          <section className="indicadores">
            <div className="indicador"><span className="rotulo">Produtos ativos</span><span className="valor">{total}</span></div>
            <div className="indicador"><span className="rotulo">Com cálculo completo</span><span className="valor">{completos}</span>
              <span className="pequeno suave">{total ? Math.round((completos / total) * 100) : 0}% do cadastro</span></div>
            {Object.entries(ALERTAS).map(([k, a]) => (
              <a key={k} className="indicador" href={url({ alerta: k, q: undefined, marca: undefined })} style={{ textDecoration: "none", color: "inherit" }}>
                <span className="rotulo">{a.t}</span><span className="valor">{conta(k)}</span>
              </a>
            ))}
          </section>

          <section className="painel">
            <div className="linha entre"><h2>Marcas sem frete de compra</h2><Link className="botao" href="/inteligencia?aba=custos">Cadastrar frete</Link></div>
            <p className="pequeno suave" style={{ margin: 0 }}>Sem o frete, o custo real fica incompleto e o produto não recebe margem nem preço mínimo.
              Um valor por marca resolve a maioria; kits somam o frete dos componentes.</p>
            {semFretePorMarca.length === 0 ? <div className="vazio">Todas as marcas têm frete cadastrado.</div> : (
              <div className="tabela"><table style={{ minWidth: 0 }}>
                <thead><tr><th>Marca</th><th>Produtos sem frete</th></tr></thead>
                <tbody>{semFretePorMarca.slice(0, 30).map(([m, q2]) => (
                  <tr key={m}><td><Link href={url({ marca: m, alerta: "sem_frete", q: undefined })}>{m}</Link></td><td className="num">{q2}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>

          <section className="painel">
            <h2>Preço VIP abaixo do mínimo ou contribuição negativa</h2>
            <p className="pequeno suave" style={{ margin: 0 }}>Produtos que, pelas premissas acima, dão prejuízo ou ficam abaixo da margem mínima quando vendidos a cliente VIP.</p>
            {negativos.length === 0 ? <div className="vazio">Nenhum produto com cálculo completo está abaixo do mínimo.</div> : (
              <div className="tabela"><table>
                <thead><tr><th>Produto</th><th>Preço VIP</th><th>Preço mínimo</th><th>Contribuição VIP</th><th>Vendido 90 dias</th></tr></thead>
                <tbody>{negativos.slice(0, 50).map((l) => (
                  <tr key={l.produto_id}>
                    <td><Link href={`/produtos/${l.produto_id}`}>{l.nome}</Link><div className="pequeno suave">{l.codigo} · {l.marca ?? "Sem marca"}</div></td>
                    <td className="num">{gs(l.preco_vip)}</td><td className="num">{gs(l.preco_minimo)}</td>
                    <td className="num"><Selo cor="erro">{pct(l.contribuicao_vip)}</Selo></td><td className="num">{Number(l.vendido_90).toLocaleString("pt-BR")}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </section>
        </>
      )}

      {aba.k === "rentabilidade" && (
        <>
          <form className="painel filtros" method="get">
            <input type="hidden" name="aba" value="rentabilidade" />
            <label>Buscar<input name="q" defaultValue={f.q ?? ""} placeholder="Código, nome ou marca" /></label>
            <label>Marca<select name="marca" defaultValue={f.marca ?? ""}>
              <option value="">Todas</option>{marcas.map((m) => <option key={m} value={m}>{m}</option>)}
            </select></label>
            <label>Situação<select name="alerta" defaultValue={f.alerta ?? ""}>
              <option value="">Todas</option><option value="completos">Cálculo completo</option>
              {Object.entries(ALERTAS).map(([k, a]) => <option key={k} value={k}>{a.t}</option>)}
            </select></label>
            <button className="principal">Filtrar</button>
          </form>
          <section className="painel">
            <div className="linha entre">
              <h2>{filtradas.length} produto(s)</h2>
              <span className="pequeno suave">Ordenado pela menor margem de contribuição VIP · valores por unidade, em Gs</span>
            </div>
            <div className="tabela"><table>
              <thead><tr>
                <th>Produto</th><th>Caixa</th><th>Custo real</th><th>Preço Normal</th><th>Preço VIP</th><th>Margem bruta VIP</th>
                <th>Contribuição Normal</th><th>Contribuição VIP</th><th>Preço mínimo</th><th>VIP no câmbio real</th><th>Vendido 90 dias</th><th>Situação</th>
              </tr></thead>
              <tbody>{filtradas.slice(0, LIMITE).map((l) => {
                const cv = n(l.contribuicao_vip);
                return (
                  <tr key={l.produto_id}>
                    <td><Link href={`/produtos/${l.produto_id}`}>{l.nome}</Link>
                      <div className="pequeno suave">{l.codigo} · {l.marca ?? "Sem marca"}{l.tipo === "kit" ? " · kit" : ""}</div></td>
                    <td className="num">{l.unidades_caixa ?? "—"}</td>
                    <td className="num">{gs(l.custo_real_gs)}
                      <div className="pequeno suave">{l.custo_real_brl ? dinheiro(l.custo_real_brl, "BRL") : l.custo_brl ? `${dinheiro(l.custo_brl, "BRL")} + frete?` : "sem custo"}</div></td>
                    <td className="num">{gs(l.preco_normal)}</td>
                    <td className="num">{gs(l.preco_vip)}</td>
                    <td className="num">{pct(l.margem_bruta_vip)}</td>
                    <td className="num">{pct(l.contribuicao_normal)}</td>
                    <td className="num">{cv === null ? "—" : <Selo cor={cv < 0 ? "erro" : cv < 0.15 ? "aviso" : "ok"}>{pct(cv)}</Selo>}</td>
                    <td className="num">{gs(l.preco_minimo)}</td>
                    <td className="num">{pct(l.margem_bruta_vip_cambio_real)}</td>
                    <td className="num">{Number(l.vendido_90).toLocaleString("pt-BR")}</td>
                    <td>{l.alertas.length === 0 ? <Selo cor="ok">Completo</Selo> : l.alertas.map((a) => <Selo key={a} cor={ALERTAS[a]?.cor}>{ALERTAS[a]?.t ?? a}</Selo>)}</td>
                  </tr>);
              })}</tbody>
            </table></div>
            {filtradas.length > LIMITE && <p className="pequeno suave">Mostrando os {LIMITE} primeiros. Use a busca ou os filtros para ver os demais.</p>}
            <p className="pequeno suave" style={{ margin: 0 }}>
              Margem bruta = (preço − custo real) ÷ preço. Contribuição = (preço − custo real − imposto − entrega por unidade) ÷ preço.
              Preço mínimo = custo real + entrega, dividido por (1 − imposto − margem mínima), arredondado para cima. Margem, não markup.
            </p>
          </section>
        </>
      )}

      {aba.k === "custos" && (
        <>
          <section className="painel">
            <h2>Imposto, entrega e outros custos do Paraguai</h2>
            <div className="tabela"><table style={{ minWidth: 0 }}>
              <thead><tr><th>Custo</th><th>Como entra</th><th>Valor vigente</th><th>Desde</th><th>Observação</th></tr></thead>
              <tbody>{d.custos.length === 0 ? <tr><td colSpan={5} className="vazio">Nenhum custo cadastrado.</td></tr> : d.custos.map((x) => (
                <tr key={x.tipo + x.base}>
                  <td>{TIPOS[x.tipo] ?? x.tipo}</td><td>{BASES[x.base] ?? x.base}</td>
                  <td className="num">{x.base === "venda" ? `${Number(x.percentual).toLocaleString("pt-BR")}%` : gs(x.valor)}</td>
                  <td>{data(x.vigente_desde)}</td><td className="pequeno suave">{x.observacao}</td>
                </tr>))}</tbody>
            </table></div>
            {gerir && (
              <form action={salvarCustoVariavel} className="linha" style={{ flexWrap: "wrap", alignItems: "end" }}>
                <label>Custo<select name="tipo" defaultValue="imposto">{Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                <label>Como entra<select name="base" defaultValue="venda">{Object.entries(BASES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                <label>Valor<input name="valor" inputMode="decimal" style={{ width: 110 }} required /></label>
                <label>Vale desde<input name="desde" type="date" /></label>
                <label>Observação<input name="obs" style={{ width: 220 }} /></label>
                <button className="principal">Salvar nova vigência</button>
              </form>
            )}
            {d.historico.length > 0 && (
              <details><summary className="pequeno">Histórico</summary>
                <div className="tabela"><table style={{ minWidth: 0 }}><tbody>{d.historico.map((h) => (
                  <tr key={h.id}><td>{TIPOS[h.tipo] ?? h.tipo}</td><td>{BASES[h.base] ?? h.base}</td>
                    <td className="num">{h.base === "venda" ? `${Number(h.percentual).toLocaleString("pt-BR")}%` : gs(h.valor)}</td>
                    <td>{data(h.vigente_desde)}</td><td className="pequeno suave">{h.quem ?? "carga inicial"}</td></tr>
                ))}</tbody></table></div>
              </details>
            )}
          </section>

          <section className="painel">
            <h2>Frete de compra por marca</h2>
            <p className="pequeno suave" style={{ margin: 0 }}>Frete por unidade, em R$, somado ao custo do produto. Os valores iniciais vieram da planilha de preços.
              Kits somam o frete dos componentes. Deixe vazio e salve para remover.</p>
            <div className="tabela"><table style={{ minWidth: 0 }}>
              <thead><tr><th>Marca</th><th>Produtos ativos</th><th>Frete por unidade (R$)</th></tr></thead>
              <tbody>{d.fretes.map((r) => (
                <tr key={r.marca}>
                  <td>{r.marca}{r.excecoes > 0 && <div className="pequeno suave">{r.excecoes} produto(s) com frete próprio</div>}
                    {r.observacao && <div className="pequeno suave">{r.observacao}</div>}</td>
                  <td className="num">{r.produtos}</td>
                  <td style={{ width: 260 }}>
                    {gerir && r.marca !== "Sem marca" ? (
                      <form action={salvarFreteMarca} className="linha">
                        <input type="hidden" name="marca" value={r.marca} />
                        <input name="frete" inputMode="decimal" defaultValue={r.frete_unidade_brl === null ? "" : Number(r.frete_unidade_brl).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          aria-label={`Frete por unidade de ${r.marca}`} style={{ width: 100 }} placeholder="0,00" />
                        <button>Salvar</button>
                      </form>
                    ) : r.frete_unidade_brl === null ? <Selo cor="aviso">Sem frete</Selo> : dinheiro(r.frete_unidade_brl, "BRL")}
                  </td>
                </tr>))}</tbody>
            </table></div>
          </section>
        </>
      )}
    </>
  );
}
