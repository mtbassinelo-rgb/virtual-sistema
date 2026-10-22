import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, dinheiro, pct } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import { excluirCompra, importarCustos, ligarRetirada, registrarCompra, salvarCustoVariavel, salvarFornecedor, salvarFreteMarca, salvarRetiradaMarcas } from "./acoes";
import { decidirClienteLocal } from "../clientes/acoes";

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
  { k: "classificacao", t: "Classificação", d: "Cada produto do Paraguai classificado em atração, rentabilidade, diferenciação ou estoque parado, com uma recomendação. Recalculado ao abrir; uma foto por dia fica guardada para comparar." },
  { k: "compras", t: "Compras e fornecedores", d: "Compras com frete e câmbio, por mês, e o prazo de reposição de cada fornecedor." },
  { k: "retirada", t: "Retire em Foz", d: "Clientes locais do Paraguai que podem retirar no CD Foz e a simulação do desconto por caixa retirada. O cliente local escolhe Entrega ou Retirar em Foz ao fechar o pedido; aqui você escolhe as marcas com desconto." },
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

const CATEGORIAS: Record<string, { t: string; d: string; cor: string }> = {
  atracao: { t: "Atração", d: "Os que mais vendem: trazem o cliente", cor: "info" },
  rentabilidade: { t: "Rentabilidade", d: "Margem acima da mediana", cor: "ok" },
  diferenciacao: { t: "Diferenciação", d: "Kits e fragrâncias: vendem pelo valor", cor: "marca" },
  parado: { t: "Estoque parado", d: "Com estoque e sem giro", cor: "aviso" },
  acompanhar: { t: "Acompanhar", d: "Margem e venda medianas", cor: "" },
  incompleto: { t: "Incompleto", d: "Faltam dados para classificar", cor: "erro" },
};

const TIPOS: Record<string, string> = { imposto: "Imposto", comissao: "Comissão", taxa_pagamento: "Taxa de pagamento", taxa_canal: "Taxa do canal", entrega: "Entrega (pasero)" };
const BASES: Record<string, string> = { venda: "% sobre a venda", caixa: "Gs por caixa", pedido: "Gs por pedido" };

const n = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const gs = (v: string | number | null | undefined) => dinheiro(v ?? null, "GS");

export default async function Inteligencia({ searchParams }: {
  searchParams: Promise<{ aba?: string; q?: string; marca?: string; alerta?: string; cat?: string; ok?: string; erro?: string }>;
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
    classes: aba.k === "classificacao" ? await (async () => {
      await c.query("select app.registrar_classificacao_py()");
      return (await c.query("select * from app.classificacao_py()")).rows as
        { produto_id: string; codigo: string; nome: string; marca: string | null; categoria: string; margem_baixa: boolean | null;
          contribuicao_vip: string | null; preco_vip: string | null; preco_minimo: string | null; vendido_90: string; saldo: string | null; recomendacao: string }[];
    })() : [],
    fornecedores: aba.k === "compras" ? (await c.query(`select f.*, (select count(*) from app.compras c where c.fornecedor_id = f.id)::int compras,
        (select max(data) from app.compras c where c.fornecedor_id = f.id) ultima from app.fornecedores f order by f.ativo desc, f.nome`)).rows : [],
    compras: aba.k === "compras" ? (await c.query(`select c.*, f.nome fornecedor from app.compras c join app.fornecedores f on f.id = c.fornecedor_id
        order by c.data desc, c.criado_em desc limit 60`)).rows : [],
    meses: aba.k === "compras" ? (await c.query("select * from app.v_compras_mensal order by mes desc limit 12")).rows : [],
    fretesNotas: aba.k === "compras" ? (await c.query(`select coalesce(n.marca, fm.marca) marca, n.notas, n.unidades, n.frete_total, n.frete_unidade, n.ultima,
        fm.frete_unidade_brl em_uso, fm.observacao
      from app.frete_medio_notas() n full join app.frete_marca fm on fm.marca = n.marca order by n.notas desc nulls last, 1`)).rows as
      { marca: string; notas: number | null; unidades: string | null; frete_total: string | null; frete_unidade: string | null; ultima: string | null; em_uso: string | null; observacao: string | null }[] : [],
    marcasCadastro: aba.k === "compras" ? (await c.query("select distinct marca from app.produtos where marca is not null and ativo order by marca")).rows.map((r) => r.marca as string) : [],
    retirada: aba.k === "retirada" ? {
      pendentes: (await c.query(`select c.id, c.nome, v.nome vendedora, u2.nome sugerido_por, c.cliente_local_sugerido_em em
          from app.clientes c join app.vendedoras v on v.id = c.vendedora_id left join app.usuarios u2 on u2.id = c.cliente_local_sugerido_por
          where c.cliente_local_sugerido_em is not null and not c.cliente_local and c.mesclado_em is null order by c.cliente_local_sugerido_em`)).rows,
      locais: (await c.query(`select c.id, c.nome, v.nome vendedora from app.clientes c join app.vendedoras v on v.id = c.vendedora_id
          where c.cliente_local and c.mesclado_em is null order by c.nome`)).rows,
      sim: (await c.query("select * from app.simular_retirada_foz((date_trunc('month', current_date) - interval '5 months')::date, current_date)")).rows,
      marcas: (await c.query(`select m.marca, coalesce(r.aplica, false) aplica, m.produtos
          from (select marca, count(*)::int produtos from app.produtos where ativo and marca is not null group by marca) m
          left join app.retirada_foz_marcas r on r.marca = m.marca order by m.marca`)).rows as { marca: string; aplica: boolean; produtos: number }[],
      relatorio: (await c.query("select * from app.relatorio_retirada_foz((date_trunc('month', current_date) - interval '11 months')::date, current_date)")).rows as
        { mes: string; pedidos: number; clientes: number; vendido: string; caixas: string; desconto: string; pasero_economizado: string; saldo: string }[],
      candidatos: (await c.query("select * from app.candidatos_cliente_local()")).rows as
        { cliente_id: string; nome: string; cidade: string | null; vendedora: string; cidade_regiao: boolean; retiradas: number; pedidos_90: number; caixas_90: string; vendido_90: string; sugerido: boolean }[],
      pedidos: (await c.query(`select count(*)::int n, coalesce(sum(retirada_foz_desconto), 0) desconto from app.pedidos
          where retirada_foz and date_trunc('month', data_pedido) = date_trunc('month', current_date)`)).rows[0] as { n: number; desconto: string },
    } : null,
    params: Object.fromEntries((await c.query("select chave, valor from app.parametros where chave in ('margem_alvo_normal','margem_alvo_vip','sugestao_tolerancia_pct','cambio_custo_gs','cambio_compra_gs','margem_minima_contribuicao','retirada_foz_desconto_caixa','retirada_foz_teto_mes','retirada_foz_ativa')")).rows
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
        <Link href="/inteligencia/precificacao"><b>Precificação</b></Link>
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


      {aba.k === "classificacao" && (() => {
        const cls = d.classes;
        const lista = cls.filter((x) => (!f.cat || x.categoria === f.cat) && (!q || `${x.codigo} ${x.nome} ${x.marca ?? ""}`.toLowerCase().includes(q)))
          .sort((a, b) => Number(b.vendido_90) - Number(a.vendido_90));
        return (
          <>
            <section className="indicadores">
              {Object.entries(CATEGORIAS).map(([k, c]) => (
                <a key={k} className="indicador" href={`/inteligencia?aba=classificacao&cat=${k}`} style={{ textDecoration: "none", color: "inherit" }}
                   aria-current={f.cat === k ? "true" : undefined}>
                  <span className="rotulo">{c.t}</span><span className="valor">{cls.filter((x) => x.categoria === k).length}</span>
                  <span className="pequeno suave">{c.d}</span>
                </a>
              ))}
              <div className="indicador"><span className="rotulo">Margem baixa</span><span className="valor">{cls.filter((x) => x.margem_baixa).length}</span>
                <span className="pequeno suave">Contribuição VIP abaixo do limite</span></div>
            </section>
            <form className="painel filtros" method="get">
              <input type="hidden" name="aba" value="classificacao" />
              <label>Buscar<input name="q" defaultValue={f.q ?? ""} placeholder="Código, nome ou marca" /></label>
              <label>Categoria<select name="cat" defaultValue={f.cat ?? ""}>
                <option value="">Todas</option>{Object.entries(CATEGORIAS).map(([k, c]) => <option key={k} value={k}>{c.t}</option>)}
              </select></label>
              <button className="principal">Filtrar</button>
            </form>
            <section className="painel">
              <div className="linha entre"><h2>{lista.length} produto(s)</h2><span className="pequeno suave">Ordenado pelo que mais vendeu em 90 dias</span></div>
              <div className="tabela"><table>
                <thead><tr><th>Produto</th><th>Categoria</th><th>Contribuição VIP</th><th>Preço VIP</th><th>Preço mínimo</th><th>Vendido 90 dias</th><th>Estoque</th><th>Recomendação</th></tr></thead>
                <tbody>{lista.slice(0, LIMITE).map((x) => (
                  <tr key={x.produto_id}>
                    <td><Link href={`/produtos/${x.produto_id}`}>{x.nome}</Link><div className="pequeno suave">{x.codigo} · {x.marca ?? "Sem marca"}</div></td>
                    <td><Selo cor={CATEGORIAS[x.categoria]?.cor}>{CATEGORIAS[x.categoria]?.t ?? x.categoria}</Selo>{x.margem_baixa && <> <Selo cor="aviso">Margem baixa</Selo></>}</td>
                    <td className="num">{pct(x.contribuicao_vip)}</td><td className="num">{gs(x.preco_vip)}</td><td className="num">{gs(x.preco_minimo)}</td>
                    <td className="num">{Number(x.vendido_90).toLocaleString("pt-BR")}</td><td className="num">{x.saldo === null ? "—" : Number(x.saldo).toLocaleString("pt-BR")}</td>
                    <td className="pequeno" style={{ minWidth: 260, whiteSpace: "normal" }}>{x.recomendacao}</td>
                  </tr>))}</tbody>
              </table></div>
              {lista.length > LIMITE && <p className="pequeno suave">Mostrando os {LIMITE} primeiros. Use a busca ou a categoria.</p>}
              <p className="pequeno suave" style={{ margin: 0 }}>
                Regras: parado = estoque sem giro (ou sem venda em 90 dias com saldo); diferenciação = kit ou grupo de fragrâncias;
                atração = entre os que mais vendem (ajuste em Parâmetros); rentabilidade = contribuição VIP acima da mediana. Vendas contam só pedidos enviados ou entregues.
              </p>
            </section>
          </>
        );
      })()}

      {aba.k === "compras" && (
        <>
          <section className="painel">
            <h2>Compras por mês</h2>
            {d.meses.length === 0 ? <div className="vazio">Nenhuma compra registrada ainda.</div> : (
              <div className="tabela"><table style={{ minWidth: 0 }}>
                <thead><tr><th>Mês</th><th>Compras</th><th>Produtos</th><th>Frete</th><th>Frete / produtos</th><th>Total</th><th>Total em Gs</th></tr></thead>
                <tbody>{d.meses.map((m) => (
                  <tr key={m.mes}><td>{m.mes}</td><td className="num">{m.compras}</td><td className="num">{dinheiro(m.produtos_brl, "BRL")}</td>
                    <td className="num">{dinheiro(m.frete_brl, "BRL")}</td><td className="num">{pct(m.frete_pct)}</td><td className="num">{dinheiro(m.total_brl, "BRL")}</td>
                    <td className="num">{gs(m.total_gs)}{m.sem_cambio > 0 && <div className="pequeno suave">{m.sem_cambio} sem câmbio</div>}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>

          {gerir && (
            <section className="painel">
              <h2>Registrar compra</h2>
              <form action={registrarCompra} className="linha" style={{ flexWrap: "wrap", alignItems: "end" }}>
                <label>Fornecedor<select name="fornecedor" required defaultValue="">
                  <option value="" disabled>Escolha</option>
                  {d.fornecedores.filter((x) => x.ativo).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                </select></label>
                <label>Data<input type="date" name="data" required /></label>
                <label>Produtos (R$)<input name="valor" inputMode="decimal" required style={{ width: 120 }} /></label>
                <label>Frete (R$)<input name="frete" inputMode="decimal" style={{ width: 100 }} /></label>
                <label>Câmbio (Gs por R$)<input name="cambio" inputMode="decimal" style={{ width: 100 }} /></label>
                <label>Marca da nota<select name="marca" defaultValue="">
                  <option value="">—</option>{d.marcasCadastro.map((m) => <option key={m} value={m}>{m}</option>)}
                </select></label>
                <label title="Total de produtos (unidades) na nota">Qtd. de produtos<input name="unidades" inputMode="numeric" style={{ width: 90 }} /></label>
                <label>Nº NF-e<input name="nfe" style={{ width: 110 }} /></label>
                <label>Observação<input name="obs" style={{ width: 200 }} /></label>
                <button className="principal">Registrar</button>
              </form>
              <p className="pequeno suave" style={{ margin: 0 }}>Com a marca e a quantidade de produtos da nota, o frete por produto da marca passa a ser a média das últimas notas (frete ÷ produtos) e entra na precificação na hora.
                Registrar a compra não mexe no estoque.</p>
            </section>
          )}

          <section className="painel">
            <h2>Frete por produto, por marca</h2>
            <p className="pequeno suave" style={{ margin: 0 }}>“Em uso” é o que a precificação usa. Marcas sem nota ficam com o valor informado (padrão R$ 0,35; Maycrene R$ 0,80). Kits: frete × produtos do kit.</p>
            <div className="tabela"><table style={{ minWidth: 0 }}>
              <thead><tr><th>Marca</th><th>Notas</th><th>Produtos nas notas</th><th>Frete das notas</th><th>Média por produto</th><th>Em uso</th><th>Origem</th></tr></thead>
              <tbody>{d.fretesNotas.map((r) => (
                <tr key={r.marca}><td>{r.marca}</td><td className="num">{r.notas ?? "—"}</td><td className="num">{r.unidades ? Number(r.unidades).toLocaleString("pt-BR") : "—"}</td>
                  <td className="num">{r.frete_total ? dinheiro(r.frete_total, "BRL") : "—"}</td><td className="num">{r.frete_unidade ? dinheiro(r.frete_unidade, "BRL") : "—"}</td>
                  <td className="num"><b>{r.em_uso ? dinheiro(r.em_uso, "BRL") : "padrão"}</b></td><td className="pequeno suave">{r.observacao}</td></tr>))}</tbody>
            </table></div>
          </section>

          <section className="painel">
            <h2>Últimas compras</h2>
            {d.compras.length === 0 ? <div className="vazio">Nenhuma compra registrada.</div> : (
              <div className="tabela"><table>
                <thead><tr><th>Data</th><th>Fornecedor</th><th>Marca</th><th>NF-e</th><th>Produtos</th><th>Frete</th><th>Frete/produto</th><th>Total</th><th>Câmbio</th><th>Total em Gs</th><th></th></tr></thead>
                <tbody>{d.compras.map((x) => (
                  <tr key={x.id}><td>{data(x.data)}</td><td>{x.fornecedor}{x.observacao && <div className="pequeno suave">{x.observacao}</div>}</td>
                    <td>{x.marca ?? "—"}</td><td>{x.nfe ?? "—"}</td>
                    <td className="num">{dinheiro(x.valor_produtos, "BRL")}</td><td className="num">{dinheiro(x.frete, "BRL")}</td>
                    <td className="num">{x.unidades ? <>{dinheiro(Number(x.frete) / Number(x.unidades), "BRL")}<div className="pequeno suave">{Number(x.unidades).toLocaleString("pt-BR")} produtos</div></> : "—"}</td>
                    <td className="num">{dinheiro(x.total, "BRL")}</td>
                    <td className="num">{x.cambio ? Number(x.cambio).toLocaleString("pt-BR") : "—"}</td>
                    <td className="num">{x.cambio ? gs(Number(x.total) * Number(x.cambio)) : "—"}</td>
                    <td>{gerir && <form action={excluirCompra}><input type="hidden" name="id" value={x.id} /><button className="pequeno">Excluir</button></form>}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>

          <section className="painel">
            <h2>Fornecedores</h2>
            <p className="pequeno suave" style={{ margin: 0 }}>O prazo de reposição será usado para avisar o risco de faltar produto antes da próxima compra chegar.</p>
            <div className="tabela"><table style={{ minWidth: 0 }}>
              <thead><tr><th>Fornecedor</th><th>Compras</th><th>Prazo (dias)</th><th>Pedido mínimo (R$)</th><th></th></tr></thead>
              <tbody>{d.fornecedores.map((x) => (
                <tr key={x.id}>
                  <td>{x.nome}{!x.ativo && <> <Selo>Inativo</Selo></>}{x.ultima && <div className="pequeno suave">última compra {data(x.ultima)}</div>}</td>
                  <td className="num">{x.compras}</td>
                  {gerir ? (
                    <td colSpan={3}>
                      <form action={salvarFornecedor} className="linha">
                        <input type="hidden" name="id" value={x.id} /><input type="hidden" name="nome" value={x.nome} />
                        <input name="prazo" inputMode="numeric" defaultValue={x.prazo_reposicao_dias ?? ""} aria-label={`Prazo de ${x.nome}`} style={{ width: 70 }} />
                        <input name="pedido_minimo" inputMode="decimal" defaultValue={x.pedido_minimo_brl === null ? "" : Number(x.pedido_minimo_brl).toLocaleString("pt-BR")}
                          aria-label={`Pedido mínimo de ${x.nome}`} style={{ width: 100 }} />
                        <select name="ativo" defaultValue={x.ativo ? "1" : "0"} aria-label="Situação"><option value="1">Ativo</option><option value="0">Inativo</option></select>
                        <button>Salvar</button>
                      </form>
                    </td>
                  ) : (<><td className="num">{x.prazo_reposicao_dias ?? "—"}</td><td className="num">{x.pedido_minimo_brl ? dinheiro(x.pedido_minimo_brl, "BRL") : "—"}</td><td /></>)}
                </tr>))}</tbody>
            </table></div>
            {gerir && (
              <form action={salvarFornecedor} className="linha" style={{ flexWrap: "wrap", alignItems: "end" }}>
                <label>Novo fornecedor<input name="nome" required style={{ width: 200 }} /></label>
                <label>Prazo (dias)<input name="prazo" inputMode="numeric" style={{ width: 80 }} /></label>
                <label>Pedido mínimo (R$)<input name="pedido_minimo" inputMode="decimal" style={{ width: 110 }} /></label>
                <button className="principal">Adicionar</button>
              </form>
            )}
          </section>
        </>
      )}


      {aba.k === "retirada" && d.retirada && (
        <>
          <section className="indicadores">
            <div className="indicador"><span className="rotulo">Situação</span><span className="valor">{d.params.retirada_foz_ativa === 1 ? "Ativo na loja" : "Desligado"}</span>
              <span className="pequeno suave">{d.params.retirada_foz_ativa === 1 ? "O cliente local escolhe Entrega ou Retirar em Foz ao fechar o pedido" : "O cliente não vê a opção"}</span>
              {gerir && <form action={ligarRetirada} style={{ marginTop: 6 }}><input type="hidden" name="ligar" value={d.params.retirada_foz_ativa === 1 ? "0" : "1"} />
                <button className={d.params.retirada_foz_ativa === 1 ? "discreto" : "principal"}>{d.params.retirada_foz_ativa === 1 ? "Desligar na loja" : "Ligar na loja"}</button></form>}</div>
            <div className="indicador"><span className="rotulo">Retiradas este mês</span><span className="valor">{d.retirada.pedidos.n}</span>
              <span className="pequeno suave">{gs(d.retirada.pedidos.desconto)} de desconto dado</span></div>
            <div className="indicador"><span className="rotulo">Desconto por caixa retirada</span><span className="valor">{gs(d.params.retirada_foz_desconto_caixa)}</span>
              <span className="pequeno suave">Pasero cobra {entregaCaixa ? gs(entregaCaixa.valor) : "—"} por caixa</span></div>
            <div className="indicador"><span className="rotulo">Teto por mês</span><span className="valor">{d.params.retirada_foz_teto_mes ? gs(d.params.retirada_foz_teto_mes) : "Sem teto"}</span></div>
            <div className="indicador"><span className="rotulo">Clientes locais</span><span className="valor">{d.retirada.locais.length}</span>
              <span className="pequeno suave">{d.retirada.pendentes.length} sugestão(ões) esperando</span></div>
          </section>

          <section className="painel">
            <h2>Marcas com preço especial para clientes locais</h2>
            <p className="pequeno suave" style={{ margin: 0 }}><b>Marcadas = VIP só para locais:</b> no Paraguai o cliente local paga o preço VIP e quem não é local paga o Normal
              (seja VIP ou não). <b>Desmarcadas = mesmo preço para todos:</b> cada cliente paga a tabela dele e o cliente local que escolhe Retirar em Foz ganha o desconto por caixa.
              É a mesma escolha da coluna “Preço para quem” na Precificação.</p>
            {gerir ? (
              <form action={salvarRetiradaMarcas}>
                <div className="linha" style={{ flexWrap: "wrap", gap: "6px 18px", margin: "10px 0" }}>
                  {d.retirada.marcas.map((m) => (
                    <label key={m.marca} className="pequeno" style={{ flexDirection: "row", gap: 6, alignItems: "center", minWidth: 220 }}>
                      <input type="hidden" name="marca" value={m.marca} /><input type="hidden" name="antes" value={`${m.marca}|${m.aplica ? 1 : 0}`} />
                      <input type="checkbox" name="aplica" value={m.marca} defaultChecked={m.aplica} /> {m.marca} <span className="suave">({m.produtos})</span>
                    </label>
                  ))}
                </div>
                <button className="principal">Salvar marcas</button>
              </form>
            ) : (
              <p className="pequeno">Sem desconto: {d.retirada.marcas.filter((m) => !m.aplica).map((m) => m.marca).join(", ") || "nenhuma (todas com desconto)"}</p>
            )}
          </section>

          <section className="painel">
            <h2>Relatório das retiradas</h2>
            <p className="pequeno suave" style={{ margin: 0 }}>Pedidos em que o cliente escolheu Retirar em Foz. <b>Pasero economizado</b> = caixas retiradas × o custo do pasero por caixa;
              <b> saldo</b> = pasero economizado − desconto dado. Saldo positivo: o incentivo se paga.</p>
            {d.retirada.relatorio.length === 0 ? <div className="vazio">Nenhuma retirada ainda. Elas aparecem aqui quando os clientes locais escolherem Retirar em Foz.</div> : (
              <div className="tabela"><table style={{ minWidth: 0 }}>
                <thead><tr><th>Mês</th><th>Pedidos</th><th>Clientes</th><th>Vendido</th><th>Caixas</th><th>Desconto dado</th><th>Pasero economizado</th><th>Saldo</th></tr></thead>
                <tbody>{d.retirada.relatorio.map((m) => (
                  <tr key={m.mes}><td>{m.mes}</td><td className="num">{m.pedidos}</td><td className="num">{m.clientes}</td><td className="num">{gs(m.vendido)}</td>
                    <td className="num">{Number(m.caixas).toLocaleString("pt-BR")}</td><td className="num">{gs(m.desconto)}</td><td className="num">{gs(m.pasero_economizado)}</td>
                    <td className="num">{Number(m.saldo) >= 0 ? <Selo cor="ok">{gs(m.saldo)}</Selo> : <Selo cor="erro">{gs(m.saldo)}</Selo>}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>

          <section className="painel">
            <h2>Possíveis clientes locais ({d.retirada.candidatos.length})</h2>
            <p className="pequeno suave" style={{ margin: 0 }}>Clientes do Paraguai que ainda não são locais e parecem ser da região: cidade perto de Foz (Ciudad del Este, Hernandarias,
              Presidente Franco, Minga Guazú…) e/ou já retiraram pedido antes. Ordenados por quanto compram (últimos 90 dias). Confira e marque.</p>
            {d.retirada.candidatos.length === 0 ? <div className="vazio">Nenhum candidato: preencha a cidade dos clientes do Paraguai para o sistema sugerir.</div> : (
              <div className="tabela"><table style={{ minWidth: 0 }}>
                <thead><tr><th>Cliente</th><th>Cidade</th><th>Vendedora</th><th>Por quê</th><th>Pedidos 90d</th><th>Caixas 90d</th><th>Comprou 90d</th><th></th></tr></thead>
                <tbody>{d.retirada.candidatos.map((x) => (
                  <tr key={x.cliente_id}><td><Link href={`/clientes/${x.cliente_id}`}>{x.nome}</Link></td><td>{x.cidade ?? "—"}</td><td>{x.vendedora}</td>
                    <td>{x.cidade_regiao && <Selo cor="info">mora na região</Selo>} {x.retiradas > 0 && <Selo cor="ok">já retirou {x.retiradas}×</Selo>} {x.sugerido && <Selo cor="aviso">vendedora sugeriu</Selo>}</td>
                    <td className="num">{x.pedidos_90}</td><td className="num">{Number(x.caixas_90).toLocaleString("pt-BR")}</td><td className="num">{gs(x.vendido_90)}</td>
                    <td>{gerir && <form action={decidirClienteLocal}><input type="hidden" name="cliente_id" value={x.cliente_id} /><input type="hidden" name="local" value="1" /><input type="hidden" name="volta" value="inteligencia" /><button>Marcar como local</button></form>}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>

          <section className="painel">
            <h2>Simulação nos pedidos dos clientes locais</h2>
            <p className="pequeno suave" style={{ margin: 0 }}>Quanto o desconto teria custado se esses clientes tivessem retirado em Foz. Como a empresa não paga o pasero na retirada,
              o desconto troca um custo por outro e não reduz a margem. Itens abaixo do mínimo = preço menos o desconto por unidade fica abaixo do preço mínimo sem entrega.</p>
            {d.retirada.sim.length === 0 ? <div className="vazio">Nenhum pedido de cliente local nos últimos 6 meses. Marque os clientes locais para ver a simulação.</div> : (
              <div className="tabela"><table style={{ minWidth: 0 }}>
                <thead><tr><th>Mês</th><th>Clientes</th><th>Pedidos</th><th>Vendido</th><th>Caixas</th><th>Desconto</th><th>% das vendas</th><th>Itens abaixo do mínimo</th></tr></thead>
                <tbody>{d.retirada.sim.map((m) => (
                  <tr key={m.mes}><td>{m.mes}</td><td className="num">{m.clientes}</td><td className="num">{m.pedidos}</td><td className="num">{gs(m.vendido)}</td>
                    <td className="num">{Number(m.caixas ?? 0).toLocaleString("pt-BR")}{m.itens_sem_caixa > 0 && <div className="pequeno suave">{m.itens_sem_caixa} item(ns) sem caixa</div>}</td>
                    <td className="num">{gs(m.desconto)}</td><td className="num">{pct(m.desconto_pct)}</td>
                    <td className="num">{m.itens_abaixo_minimo > 0 ? <Selo cor="erro">{m.itens_abaixo_minimo}</Selo> : 0}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>

          <section className="painel">
            <h2>Sugestões das vendedoras</h2>
            {d.retirada.pendentes.length === 0 ? <div className="vazio">Nenhuma sugestão esperando.</div> : (
              <div className="tabela"><table style={{ minWidth: 0 }}>
                <thead><tr><th>Cliente</th><th>Vendedora</th><th>Sugerido por</th><th></th></tr></thead>
                <tbody>{d.retirada.pendentes.map((x) => (
                  <tr key={x.id}><td><Link href={`/clientes/${x.id}`}>{x.nome}</Link></td><td>{x.vendedora}</td><td>{x.sugerido_por ?? "—"}<div className="pequeno suave">{data(x.em)}</div></td>
                    <td>{gerir && <div className="linha">
                      <form action={decidirClienteLocal}><input type="hidden" name="cliente_id" value={x.id} /><input type="hidden" name="local" value="1" /><input type="hidden" name="volta" value="inteligencia" /><button>Aprovar</button></form>
                      <form action={decidirClienteLocal}><input type="hidden" name="cliente_id" value={x.id} /><input type="hidden" name="local" value="0" /><input type="hidden" name="volta" value="inteligencia" /><button className="discreto">Recusar</button></form>
                    </div>}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>

          <section className="painel">
            <h2>Clientes locais</h2>
            <p className="pequeno suave" style={{ margin: 0 }}>Para incluir, abra o cadastro do cliente (só clientes do Paraguai). A vendedora sugere e o gerente aprova.</p>
            {d.retirada.locais.length === 0 ? <div className="vazio">Nenhum cliente local ainda.</div> : (
              <div className="tabela"><table style={{ minWidth: 0 }}>
                <thead><tr><th>Cliente</th><th>Vendedora</th><th></th></tr></thead>
                <tbody>{d.retirada.locais.map((x) => (
                  <tr key={x.id}><td><Link href={`/clientes/${x.id}`}>{x.nome}</Link></td><td>{x.vendedora}</td>
                    <td>{gerir && <form action={decidirClienteLocal}><input type="hidden" name="cliente_id" value={x.id} /><input type="hidden" name="local" value="0" /><input type="hidden" name="volta" value="inteligencia" /><button className="discreto">Deixar de ser local</button></form>}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </>
      )}

      {aba.k === "custos" && (
        <>
          <section className="painel">
            <h2>Custo real por produto (planilha)</h2>
            <p className="pequeno suave" style={{ margin: 0 }}>Envie o CSV do casamento com a planilha Clientes VIP (separado por ponto e vírgula). O custo por unidade em R$ e o frete passam a valer
              em todo o sistema e não são apagados pela importação do Bling. Preço de venda só é preenchido onde está em branco; nenhum produto é ativado.</p>
            {gerir ? (
              <form action={importarCustos} className="linha" style={{ flexWrap: "wrap", alignItems: "end", gap: 12 }}>
                <label>Arquivo CSV<input type="file" name="arquivo" accept=".csv,text/csv" required /></label>
                <fieldset className="linha" style={{ gap: 10, border: 0, padding: 0 }}>
                  <legend className="pequeno">Importar casamentos com confiança</legend>
                  <label className="pequeno"><input type="checkbox" name="confianca" value="alta" defaultChecked /> alta</label>
                  <label className="pequeno"><input type="checkbox" name="confianca" value="media" defaultChecked /> média</label>
                  <label className="pequeno"><input type="checkbox" name="confianca" value="baixa" /> baixa</label>
                </fieldset>
                <label className="pequeno"><input type="checkbox" name="preencher_precos" value="1" defaultChecked /> Preencher preços PY que estão em branco</label>
                <button className="principal">Importar custos</button>
              </form>
            ) : <p className="pequeno suave">Só gerente ou dono importa custos.</p>}
          </section>
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
