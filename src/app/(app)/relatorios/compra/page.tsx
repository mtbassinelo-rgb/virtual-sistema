import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro } from "@/lib/formato";
import { CopiarLista } from "./copiar";

export const metadata = { title: "Planejar compra" };

type Linha = {
  produto_id: string; codigo: string; nome: string; marca: string | null; fornecedor: string | null; unidades_caixa: number | null;
  estoque_minimo: number | null; custo: number | null; saldo: number; v30: number; v90: number;
};

const num = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/**
 * Planejar compra: escolhe a marca (ou fornecedor), vê o estoque de cada produto, quanto vende e quando acaba,
 * e quanto comprar para cobrir os próximos dias (mais o prazo de entrega), arredondado para caixa fechada.
 */
export default async function PlanejarCompra({ searchParams }: {
  searchParams: Promise<{ marca?: string; fornecedor?: string; dias?: string; prazo?: string; todos?: string; q?: string; unidade?: string }>;
}) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const gestao = ehGestao(u);
  const dias = Math.min(Math.max(Number(f.dias) || 30, 7), 180);
  const prazo = Math.min(Math.max(Number(f.prazo) || 15, 0), 120);
  const todos = f.todos === "1";
  const marca = (f.marca ?? "").trim() || null;
  const fornecedor = (f.fornecedor ?? "").trim() || null;
  const q = (f.q ?? "").trim() || null;

  const d = await comUsuario(u.id, async (c) => {
    const depositos = (await c.query("select id, codigo, nome from app.depositos where ativo order by tipo, nome")).rows as { id: string; codigo: string; nome: string }[];
    // padrão: CD Foz (a distribuidora); dá para ver outra unidade ou todas
    const principal = depositos.find((x) => x.codigo === "cd-foz") ?? depositos[0];
    const dep = f.unidade === "todas" ? null : depositos.find((x) => x.id === f.unidade) ?? principal;
    return {
    depositos, dep,
    marcas: (await c.query("select marca, count(*)::int n from app.produtos where ativo and marca is not null group by 1 order by 1")).rows as { marca: string; n: number }[],
    fornecedores: (await c.query("select fornecedor, count(*)::int n from app.produtos where ativo and fornecedor is not null and fornecedor <> '' group by 1 order by 1")).rows as { fornecedor: string; n: number }[],
    linhas: (marca || fornecedor || q) ? (await c.query(`
      with vendas as (
        select x.produto_id,
               sum(x.quantidade) filter (where pe.data_pedido > current_date - 30) as v30,
               sum(x.quantidade) as v90
          from app.pedido_itens i join app.pedidos pe on pe.id = i.pedido_id
          cross join lateral app.componentes(i.produto_id, i.quantidade) x
         where pe.status_comercial not in ('cancelado') and pe.data_pedido > current_date - 90
           and ($4::uuid is null or coalesce(pe.deposito_id, $5::uuid) = $4::uuid)
         group by 1)
      select p.id as produto_id, p.codigo, p.nome, p.marca, p.fornecedor, p.unidades_caixa_fornecedor as unidades_caixa, p.estoque_minimo, p.custo,
             coalesce(s.saldo, 0)::numeric as saldo, coalesce(v.v30, 0)::numeric as v30, coalesce(v.v90, 0)::numeric as v90
        from app.produtos p
        left join lateral (select sum(es.quantidade) as saldo from app.estoque_saldos es
                             join app.depositos dd on dd.id = es.deposito_id and dd.ativo
                            where es.produto_id = p.id and ($4::uuid is null or es.deposito_id = $4::uuid)) s on true
        left join vendas v on v.produto_id = p.id
       where p.ativo and p.tipo <> 'kit'
         and ($1::text is null or p.marca = $1) and ($2::text is null or p.fornecedor = $2)
         and ($3::text is null or app.nome_normal(p.nome) like '%' || app.nome_normal($3) || '%' or p.codigo ilike $3 || '%')
       order by p.nome limit 800`, [marca, fornecedor, q, dep?.id ?? null, principal?.id ?? null])).rows.map((r) => ({
        ...r, saldo: Number(r.saldo), v30: Number(r.v30), v90: Number(r.v90),
        unidades_caixa: r.unidades_caixa ? Number(r.unidades_caixa) : null, estoque_minimo: r.estoque_minimo != null ? Number(r.estoque_minimo) : null,
        custo: r.custo != null ? Number(r.custo) : null })) as Linha[] : [],
    };
  });

  // Previsão: ritmo de venda (o maior entre os últimos 30 e 90 dias, para não comprar de menos), dias até acabar
  // e quanto comprar para cobrir o período escolhido + o prazo de entrega, sem ficar abaixo do mínimo.
  const calc = d.linhas.map((l) => {
    const porDia = Math.max(l.v30 / 30, l.v90 / 90);
    const acabaEm = porDia > 0 ? Math.floor(Math.max(l.saldo, 0) / porDia) : null;
    const precisa = Math.max(Math.ceil(porDia * (dias + prazo)), l.estoque_minimo ?? 0);
    const falta = Math.max(precisa - Math.max(l.saldo, 0), 0);
    const cx = l.unidades_caixa && l.unidades_caixa > 1 ? l.unidades_caixa : null;
    const caixas = cx ? Math.ceil(falta / cx) : null;
    const comprar = cx ? (caixas ?? 0) * cx : falta;
    const urgente = acabaEm != null && acabaEm <= prazo;
    return { ...l, porDia, acabaEm, comprar, caixas, cx, urgente, custoTotal: l.custo != null ? l.custo * comprar : null };
  });
  const lista = (todos ? calc : calc.filter((x) => x.comprar > 0))
    .sort((a, b) => Number(b.urgente) - Number(a.urgente) || (a.acabaEm ?? 9999) - (b.acabaEm ?? 9999) || a.nome.localeCompare(b.nome, "pt-BR"));
  const aComprar = calc.filter((x) => x.comprar > 0);
  const totUn = aComprar.reduce((s, x) => s + x.comprar, 0);
  const totCx = aComprar.reduce((s, x) => s + (x.caixas ?? 0), 0);
  const totCusto = aComprar.reduce((s, x) => s + (x.custoTotal ?? 0), 0);
  const semCusto = aComprar.filter((x) => x.custo == null).length;
  const hoje = new Date();
  const dataAcaba = (n: number) => new Date(hoje.getTime() + n * 86400000).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
  const textoLista = aComprar.map((x) => `• ${x.caixas ? `${x.caixas} cx (${x.comprar} un)` : `${x.comprar} un`} — ${x.nome}${x.codigo ? ` [${x.codigo}]` : ""}`).join("\n");
  const titulo = marca ?? fornecedor ?? (q ? `“${q}”` : "");

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/relatorios?aba=estoque">Relatórios</Link> / Planejar compra</div>
          <h1>Planejar compra{titulo ? `: ${titulo}` : ""}</h1>
          <div className="suave pequeno">Estoque e vendas de: <b>{d.dep ? (d.dep.codigo === "cd-foz" ? "CD Foz (distribuidora)" : d.dep.nome) : "todas as unidades"}</b></div>
          <p>Escolha a marca: aparece o estoque de cada produto, quanto vende por mês, quando acaba e quanto comprar para cobrir os próximos dias, já em caixas fechadas.</p>
        </div>
      </section>

      <form className="painel campos" method="get">
        <label>Marca
          <select name="marca" defaultValue={marca ?? ""}>
            <option value="">—</option>
            {d.marcas.map((m) => <option key={m.marca} value={m.marca}>{m.marca} ({m.n})</option>)}
          </select>
        </label>
        <label>ou Fornecedor
          <select name="fornecedor" defaultValue={fornecedor ?? ""}>
            <option value="">—</option>
            {d.fornecedores.map((m) => <option key={m.fornecedor} value={m.fornecedor}>{m.fornecedor} ({m.n})</option>)}
          </select>
        </label>
        <label>Unidade
          <select name="unidade" defaultValue={d.dep?.id ?? "todas"}>
            {d.depositos.map((x) => <option key={x.id} value={x.id}>{x.codigo === "cd-foz" ? "CD Foz (distribuidora)" : x.nome}</option>)}
            <option value="todas">Todas somadas</option>
          </select>
        </label>
        <label>Produto (opcional)<input name="q" defaultValue={q ?? ""} placeholder="ex.: shampoo, matizador" /></label>
        <label>Cobrir quantos dias
          <select name="dias" defaultValue={String(dias)}>
            {[15, 30, 45, 60, 90, 120].map((n) => <option key={n} value={n}>{n} dias</option>)}
          </select>
        </label>
        <label>Prazo de entrega do fornecedor (dias)<input name="prazo" type="number" min={0} max={120} defaultValue={prazo} /></label>
        <label className="linha" style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <input type="checkbox" name="todos" value="1" defaultChecked={todos} /> Mostrar também o que não precisa comprar
        </label>
        <div className="largo"><button className="principal">Ver previsão</button></div>
      </form>

      {!titulo ? <div className="vazio">Escolha uma marca ou um fornecedor para ver a previsão de compra.</div> : (
        <section className="painel">
          <div className="resumo-compra">
            <div><small>Produtos para comprar</small><b>{aComprar.length}</b><span className="suave pequeno">de {calc.length}</span></div>
            <div><small>Caixas</small><b>{totCx.toLocaleString("pt-BR")}</b><span className="suave pequeno">{totUn.toLocaleString("pt-BR")} unidades</span></div>
            <div><small>Acabam antes da entrega</small><b className={calc.some((x) => x.urgente) ? "texto-erro" : ""}>{calc.filter((x) => x.urgente && x.comprar > 0).length}</b><span className="suave pequeno">em até {prazo} dias</span></div>
            {gestao && <div><small>Custo estimado</small><b>{dinheiro(totCusto, "BRL")}</b>{semCusto > 0 && <span className="suave pequeno">{semCusto} sem custo cadastrado</span>}</div>}
          </div>
          <p className="suave pequeno" style={{ margin: "4px 0 0" }}>
            Venda/mês: o maior ritmo entre os últimos 30 e 90 dias (pedidos não cancelados; kits contam pelos itens).
            Comprar = o que cobre {dias} dias + {prazo} de entrega (ou o estoque mínimo, se for maior), menos o que já tem, arredondado para caixa fechada.
          </p>
          {lista.length === 0 ? <div className="vazio">Nada para comprar desta {marca ? "marca" : "seleção"} no período escolhido.</div> : (
            <div className="tabela"><table>
              <thead><tr><th>Produto</th><th className="num">Estoque</th><th className="num">Vende/mês</th><th>Acaba em</th><th className="num">Mínimo</th><th className="num">Comprar</th>{gestao && <th className="num">Custo</th>}</tr></thead>
              <tbody>{lista.map((x) => (
                <tr key={x.produto_id} className={x.urgente && x.comprar > 0 ? "linha-urgente" : ""}>
                  <td><Link href={`/produtos/${x.produto_id}`}>{x.nome}</Link><div className="pequeno suave">{x.codigo}{x.cx ? ` · caixa com ${x.cx}` : ""}</div></td>
                  <td className="num"><span className={`estoque-num ${x.saldo <= 0 ? "zerado" : x.urgente ? "baixo" : ""}`}>{num(x.saldo)}</span></td>
                  <td className="num">{x.porDia > 0 ? num(Math.round(x.porDia * 30)) : <span className="suave">sem venda</span>}</td>
                  <td>{x.saldo <= 0 ? <b className="texto-erro">esgotado</b> : x.acabaEm == null ? <span className="suave">—</span>
                    : <>{x.acabaEm} dias <span className="suave pequeno">({dataAcaba(x.acabaEm)})</span></>}</td>
                  <td className="num">{x.estoque_minimo ?? "—"}</td>
                  <td className="num"><b>{x.comprar <= 0 ? "—" : x.caixas ? `${x.caixas} cx (${x.comprar} un)` : `${x.comprar} un`}</b></td>
                  {gestao && <td className="num">{x.custoTotal != null && x.comprar > 0 ? dinheiro(x.custoTotal, "BRL") : "—"}</td>}
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {aComprar.length > 0 && <CopiarLista texto={`Pedido ${titulo}\n${textoLista}`} />}
          {gestao && marca && <div className="linha" style={{ marginTop: 8 }}><Link className="botao" href={`/estoque/pedido-compra?marca=${encodeURIComponent(marca)}`}>Montar o pedido de compra desta marca</Link></div>}
        </section>
      )}
    </>
  );
}
