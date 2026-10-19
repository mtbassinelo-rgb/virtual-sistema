import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { hojeISO } from "@/lib/formato";

export const metadata = { title: "Histórico do estoque" };

const TIPOS: Record<string, { nome: string; sinal: 1 | -1 }> = {
  entrada_compra: { nome: "Entrada de compra", sinal: 1 },
  saida_venda: { nome: "Saída por venda", sinal: -1 },
  transferencia_saida: { nome: "Transferência (saiu)", sinal: -1 },
  transferencia_entrada: { nome: "Transferência (chegou)", sinal: 1 },
  ajuste_entrada: { nome: "Ajuste (+)", sinal: 1 },
  ajuste_saida: { nome: "Ajuste (−)", sinal: -1 },
  devolucao_cliente: { nome: "Devolução de cliente", sinal: 1 },
  perda: { nome: "Perda", sinal: -1 },
};
const ORIGENS: Record<string, string> = {
  pedido: "Pedido", inventario: "Inventário / contagem", transferencia: "Transferência", compra: "Compra",
  importacao: "Importação (Bling/planilha)", caixa: "Caixa", ajuste: "Ajuste manual",
};
const quando = (d: string) => new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

type F = { de?: string; ate?: string; usuario?: string; marca?: string; deposito?: string; tipo?: string; origem?: string; q?: string; lote?: string; ver?: string };

/**
 * Histórico do estoque: toda mudança de saldo passa por um lançamento (entrada, saída, ajuste, inventário, transferência),
 * com data, hora e quem fez. Aqui dá para ver "quem atualizou o quê e quando", por marca, unidade, pessoa e tipo.
 */
export default async function HistoricoEstoque({ searchParams }: { searchParams: Promise<F> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const de = /^\d{4}-\d{2}-\d{2}$/.test(f.de ?? "") ? f.de! : hojeISO(-30);
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(f.ate ?? "") ? f.ate! : hojeISO();
  const ver = f.ver === "itens" || f.lote ? "itens" : "lotes";
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  const usuario = f.usuario === "sistema" ? "sistema" : uuid(f.usuario);
  const deposito = uuid(f.deposito);
  const tipo = f.tipo && TIPOS[f.tipo] ? f.tipo : null;
  const origem = f.origem && /^[a-z_]{2,30}$/.test(f.origem) ? f.origem : null;
  const marca = (f.marca ?? "").trim() || null;
  const q = (f.q ?? "").trim() || null;
  // lote = uma atualização: mesma pessoa, mesma origem/referência, no mesmo minuto
  const lote = f.lote && /^[^|]{0,80}\|[^|]{0,80}\|[^|]{0,40}\|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(f.lote) ? f.lote.split("|") : null;

  const par: unknown[] = [de, ate];
  const cond: string[] = ["m.em >= $1::date", "m.em < $2::date + 1"];
  const add = (sql: string, v: unknown) => { par.push(v); cond.push(sql.replace("?", `$${par.length}`)); };
  if (usuario === "sistema") cond.push("(m.usuario_id is null or us.email = 'sistema@importacao.local')");
  else if (usuario) add("m.usuario_id = ?::uuid", usuario);
  if (deposito) add("m.deposito_id = ?::uuid", deposito);
  if (tipo) add("m.tipo::text = ?", tipo);
  if (origem) add("coalesce(m.referencia_tipo, 'ajuste') = ?", origem);
  if (marca) add("p.marca = ?", marca);
  if (q) { par.push(q); cond.push(`(app.nome_normal(p.nome) like '%' || app.nome_normal($${par.length}) || '%' or p.codigo ilike $${par.length} || '%')`); }
  if (lote) {
    add("coalesce(m.usuario_id::text, '') = ?", lote[0]);
    add("coalesce(m.referencia_tipo, '') = ?", lote[1]);
    add("coalesce(m.referencia_id, '') = ?", lote[2]);
    add("to_char(date_trunc('minute', m.em at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD\"T\"HH24:MI') = ?", lote[3]);
  }
  const where = cond.join(" and ");
  const base = `from app.estoque_movimentos m join app.produtos p on p.id = m.produto_id join app.depositos d on d.id = m.deposito_id
                left join app.usuarios us on us.id = m.usuario_id where ${where}`;

  const dados = await comUsuario(u.id, async (c) => ({
    filtros: {
      marcas: (await c.query("select distinct marca from app.produtos where marca is not null order by 1")).rows.map((r) => String(r.marca)),
      depositos: (await c.query("select id, nome from app.depositos where ativo order by tipo, nome")).rows as { id: string; nome: string }[],
      pessoas: (await c.query(`select distinct m.usuario_id as id, app.nome_usuario(m.usuario_id) as nome from app.estoque_movimentos m
                                 where m.usuario_id is not null order by 2`)).rows as { id: string; nome: string }[],
    },
    lotes: ver === "lotes" ? (await c.query(`
      select coalesce(m.usuario_id::text, '') as uid, app.nome_usuario(m.usuario_id) as pessoa,
             coalesce(m.referencia_tipo, '') as ref_tipo, coalesce(m.referencia_id, '') as ref_id,
             to_char(date_trunc('minute', m.em at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD"T"HH24:MI') as minuto,
             min(m.em) as em, string_agg(distinct d.nome, ', ') as unidades,
             count(distinct m.produto_id)::int as produtos, count(*)::int as lancamentos,
             string_agg(distinct p.marca, ', ') as marcas,
             sum(case when m.tipo in ('entrada_compra','transferencia_entrada','ajuste_entrada','devolucao_cliente') then m.quantidade else 0 end) as entrou,
             sum(case when m.tipo in ('entrada_compra','transferencia_entrada','ajuste_entrada','devolucao_cliente') then 0 else m.quantidade end) as saiu,
             max(m.observacao) as obs
        ${base}
       group by 1, 2, 3, 4, 5 order by min(m.em) desc limit 300`, par)).rows : [],
    itens: ver === "itens" ? (await c.query(`
      select m.id, m.em, m.tipo::text as tipo, m.quantidade, m.referencia_tipo, m.referencia_id, m.observacao,
             p.id as produto_id, p.codigo, p.nome as produto, p.marca, d.nome as deposito, app.nome_usuario(m.usuario_id) as pessoa,
             (select es.quantidade from app.estoque_saldos es where es.deposito_id = m.deposito_id and es.produto_id = m.produto_id) as saldo_hoje
        ${base}
       order by m.em desc, p.nome limit 1000`, par)).rows : [],
    ultima: (await c.query(`select max(m.em) as em, count(distinct m.produto_id)::int as produtos ${base}`, par)).rows[0] as { em: string | null; produtos: number },
  }));

  const url = (mud: Record<string, string | null>) => {
    const s = new URLSearchParams();
    const v: Record<string, string | null> = { de, ate, usuario: f.usuario ?? null, marca, deposito, tipo, origem, q, ver, lote: null, ...mud };
    for (const [k, x] of Object.entries(v)) if (x) s.set(k, x);
    return `/estoque/historico?${s}`;
  };

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/estoque">Estoque</Link> / Histórico</div>
          <h1>Histórico do estoque</h1>
          <p>Toda mudança de estoque fica registrada: quando, quem fez, em qual unidade e quais produtos. Escolha o período, a pessoa, a marca ou o tipo.</p>
        </div>
      </section>

      <form className="painel campos" method="get">
        <input type="hidden" name="ver" value={ver} />
        <label>De<input type="date" name="de" defaultValue={de} /></label>
        <label>Até<input type="date" name="ate" defaultValue={ate} /></label>
        <label>Quem fez
          <select name="usuario" defaultValue={f.usuario ?? ""}>
            <option value="">Todos</option>
            {dados.filtros.pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            <option value="sistema">Sistema / importações</option>
          </select>
        </label>
        <label>Marca
          <select name="marca" defaultValue={marca ?? ""}>
            <option value="">Todas</option>
            {dados.filtros.marcas.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>Unidade
          <select name="deposito" defaultValue={deposito ?? ""}>
            <option value="">Todas</option>
            {dados.filtros.depositos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </label>
        <label>Tipo
          <select name="tipo" defaultValue={tipo ?? ""}>
            <option value="">Todos</option>
            {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v.nome}</option>)}
          </select>
        </label>
        <label>Origem
          <select name="origem" defaultValue={origem ?? ""}>
            <option value="">Todas</option>
            {Object.entries(ORIGENS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Produto<input name="q" defaultValue={q ?? ""} placeholder="nome ou código" /></label>
        <div className="largo linha"><button className="principal">Filtrar</button><Link href="/estoque/historico" className="botao">Limpar</Link></div>
      </form>

      <section className="painel">
        <div className="linha entre">
          <div className="vistas" role="group" aria-label="Como ver">
            <Link href={url({ ver: "lotes" })} className={ver === "lotes" ? "ativa botao principal" : "botao"}>Por atualização</Link>
            <Link href={url({ ver: "itens" })} className={ver === "itens" ? "ativa botao principal" : "botao"}>Produto por produto</Link>
          </div>
          <span className="suave pequeno">
            {dados.ultima.em ? <>Última mudança no filtro: <b>{quando(dados.ultima.em)}</b> · {dados.ultima.produtos} produto(s) mexido(s)</> : "Nenhuma mudança no período."}
          </span>
        </div>
        {lote && <p className="pequeno" style={{ margin: 0 }}>Mostrando os produtos de uma atualização. <Link href={url({ ver: "lotes" })}>Voltar para todas</Link></p>}

        {ver === "lotes" ? (dados.lotes.length === 0 ? <div className="vazio">Nada encontrado com esses filtros.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Unidade</th><th>Marcas</th><th className="num">Produtos</th><th className="num">Entrou</th><th className="num">Saiu</th><th></th></tr></thead>
            <tbody>{dados.lotes.map((l) => (
              <tr key={`${l.uid}|${l.ref_tipo}|${l.ref_id}|${l.minuto}`}>
                <td>{quando(l.em)}</td>
                <td>{l.pessoa}</td>
                <td>{ORIGENS[l.ref_tipo] ?? (l.ref_tipo || "Ajuste manual")}{l.ref_tipo === "pedido" && l.ref_id ? <> · <Link href={`/pedidos/${l.ref_id}`}>ver pedido</Link></> : null}
                  {l.obs && <div className="pequeno suave">{String(l.obs).slice(0, 120)}</div>}</td>
                <td>{l.unidades}</td>
                <td className="pequeno">{l.marcas ? String(l.marcas).slice(0, 80) : "—"}</td>
                <td className="num">{l.produtos}</td>
                <td className="num">{Number(l.entrou) ? `+${n(Number(l.entrou))}` : "—"}</td>
                <td className="num">{Number(l.saiu) ? `−${n(Number(l.saiu))}` : "—"}</td>
                <td><Link href={url({ ver: "itens", lote: `${l.uid}|${l.ref_tipo}|${l.ref_id}|${l.minuto}` })}>ver produtos</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        )) : (dados.itens.length === 0 ? <div className="vazio">Nada encontrado com esses filtros.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Quando</th><th>Produto</th><th>Marca</th><th>Unidade</th><th>Tipo</th><th className="num">Quantidade</th><th className="num">Saldo hoje</th><th>Quem</th></tr></thead>
            <tbody>{dados.itens.map((x) => {
              const t = TIPOS[x.tipo];
              return (
                <tr key={x.id}>
                  <td>{quando(x.em)}</td>
                  <td><Link href={`/produtos/${x.produto_id}`}>{x.produto}</Link><div className="pequeno suave">{x.codigo}{x.observacao ? ` · ${String(x.observacao).slice(0, 80)}` : ""}</div></td>
                  <td>{x.marca ?? "—"}</td>
                  <td>{x.deposito}</td>
                  <td>{t?.nome ?? x.tipo}<div className="pequeno suave">{ORIGENS[x.referencia_tipo] ?? x.referencia_tipo ?? ""}</div></td>
                  <td className="num"><b style={{ color: t?.sinal === 1 ? "#067647" : "#b42318" }}>{t?.sinal === 1 ? "+" : "−"}{n(Number(x.quantidade))}</b></td>
                  <td className="num">{x.saldo_hoje != null ? n(Number(x.saldo_hoje)) : "—"}</td>
                  <td>{x.pessoa}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ))}
      </section>
    </>
  );
}
