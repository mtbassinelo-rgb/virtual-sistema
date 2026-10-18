import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import { produtosEmLote, salvarCaixas } from "./acoes";
import { BarraLote, MarcarTodos } from "./lote";

export const metadata = { title: "Produtos" };

const POR_PAGINA = 60;

export default async function Produtos({ searchParams }: {
  searchParams: Promise<{ q?: string; filtro?: string; pagina?: string; ok?: string; erro?: string }>;
}) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const pagina = Math.max(1, Number(f.pagina) || 1);
  const par: unknown[] = [];
  const cond = ["true"];
  if (f.q) { par.push(`%${f.q}%`); cond.push(`(p.nome ilike $${par.length} or p.codigo ilike $${par.length} or p.marca ilike $${par.length} or p.gtin = $${par.length})`); }
  if (f.filtro === "sem-foto") cond.push("p.foto is null and p.ativo");
  if (f.filtro === "sem-preco-gs") cond.push("p.ativo and x.py_normal is null");
  if (f.filtro === "sem-caixa") cond.push("p.ativo and p.unidades_caixa is null");
  if (f.filtro === "inativos") cond.push("not p.ativo"); else if (f.filtro !== "todos") cond.push("p.ativo");

  const precos = ["py_normal", "py_vip", "br_normal", "br_vip"].map((t) =>
    `(select valor from app.precos z where z.produto_id = p.id and z.tabela = '${t}' and z.vigente_desde <= current_date order by vigente_desde desc limit 1) as ${t}`).join(", ");
  const d = await comUsuario(u.id, async (c) => {
    const base = `from app.produtos p cross join lateral (select ${precos}) x where ${cond.join(" and ")}`;
    const total = Number((await c.query(`select count(*) n ${base}`, par)).rows[0].n);
    const lista = (await c.query(`select p.id, p.codigo, p.nome, p.marca, p.foto, p.tipo, p.ativo, p.codigo_provisorio, p.unidades_caixa, x.* ${base}
      order by p.nome limit ${POR_PAGINA} offset ${(pagina - 1) * POR_PAGINA}`, par)).rows;
    const fotosPendentes = ehGestao(u) ? Number((await c.query("select count(*) n from app.fotos_catalogo where status = 'pendente'")).rows[0].n) : 0;
    return { total, lista, fotosPendentes };
  });
  const paginas = Math.max(1, Math.ceil(d.total / POR_PAGINA));
  const fotosPendentes = d.fotosPendentes;
  const gestao = ehGestao(u);
  const url = (mud: Record<string, string | number | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: f.q, filtro: f.filtro, ...mud })) if (v) s.set(k, String(v));
    return `/produtos?${s}`;
  };

  return (
    <>
      <section className="linha entre">
        <div><h1>Produtos</h1><div className="suave pequeno">{d.total.toLocaleString("pt-BR")} produto(s). Clique no nome para editar tudo do produto; marque vários para ativar, inativar ou excluir de uma vez.</div></div>
        {ehGestao(u) && (
          <div className="linha">
            <a className="botao" href="/produtos/fotos">Fotos do catálogo{fotosPendentes > 0 ? ` (${fotosPendentes} para conferir)` : ""}</a>
            <a className="botao" href="/produtos/precos-rapido">Editar preços rápido</a>
            <a className="botao principal" href="/produtos/novo">Novo produto</a>
          </div>
        )}
      </section>
      <Avisos ok={f.ok} erro={f.erro} />
      <form className="painel linha" method="get">
        <label style={{ flex: 2, minWidth: 200 }}>Buscar<input name="q" defaultValue={f.q} placeholder="Nome, código, marca ou código de barras" /></label>
        <label style={{ flex: 1, minWidth: 160 }}>Mostrar
          <select name="filtro" defaultValue={f.filtro ?? ""}>
            <option value="">Ativos</option>
            <option value="sem-foto">Sem foto</option>
            <option value="sem-preco-gs">Sem preço em Gs</option>
            <option value="sem-caixa">Sem peças por caixa</option>
            <option value="inativos">Inativos</option>
            <option value="todos">Todos</option>
          </select>
        </label>
        <button className="principal">Buscar</button>
      </form>

      {gestao && (
        <>
          <form id="caixas" action={salvarCaixas} hidden><input type="hidden" name="volta" value={url({ pagina: pagina > 1 ? pagina : undefined }).replace(/\?$/, "")} /></form>
          <form id="lote" action={produtosEmLote} hidden><input type="hidden" name="volta" value={url({ pagina: pagina > 1 ? pagina : undefined }).replace(/\?$/, "")} /></form>
          <BarraLote form="lote" />
        </>
      )}
      <div className="tabela"><table>
        <thead><tr>{gestao && <th style={{ width: 32 }}><MarcarTodos form="lote" /></th>}<th></th><th>Código</th><th>Produto</th><th title="Peças por caixa: o site mostra o preço da caixa fechada e o da unidade">Caixa</th><th>PY Normal</th><th>PY VIP</th><th>BR Normal</th><th>BR VIP</th></tr></thead>
        <tbody>{d.lista.map((p) => (
          <tr key={p.id}>
            {gestao && <td><input type="checkbox" name="ids" value={p.id} form="lote" aria-label={`Selecionar ${p.nome}`} /></td>}
            <td style={{ width: 52 }}>
              {p.foto ? <img src={p.foto} alt="" width={40} height={40} style={{ objectFit: "cover", borderRadius: 6, display: "block" }} />
                : <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--afundado)" }} />}
            </td>
            <td className="num">{p.codigo}{p.codigo_provisorio && <div><Selo cor="aviso">provisório</Selo></div>}</td>
            <td>
              <Link href={`/produtos/${p.id}`}>{p.nome}</Link>
              <div className="pequeno suave">{p.marca ?? ""} {p.tipo === "kit" && <Selo cor="info">kit</Selo>} {!p.ativo && <Selo>inativo</Selo>}</div>
            </td>
            <td className="num" style={{ width: 80 }}>
              {gestao
                ? <input name={`caixa:${p.id}`} form="caixas" defaultValue={p.unidades_caixa ?? ""} inputMode="numeric" placeholder="—" aria-label={`Peças por caixa de ${p.nome}`} style={{ width: 64 }} />
                : (p.unidades_caixa ?? "—")}
            </td>
            <td className="num">{p.py_normal ? dinheiro(p.py_normal, "GS") : "—"}</td>
            <td className="num">{p.py_vip ? dinheiro(p.py_vip, "GS") : "—"}</td>
            <td className="num">{p.br_normal ? dinheiro(p.br_normal, "BRL") : "—"}</td>
            <td className="num">{p.br_vip ? dinheiro(p.br_vip, "BRL") : "—"}</td>
          </tr>))}
        </tbody>
      </table></div>
      {gestao && d.lista.length > 0 && (
        <div className="linha">
          <button form="caixas" className="principal">Salvar peças por caixa desta página</button>
          <span className="pequeno suave">Digite quantas peças vêm na caixa (2, 12, 40…). Em branco = vende por unidade. O preço continua sendo o da unidade: o site calcula o da caixa.</span>
        </div>
      )}
      {paginas > 1 && (
        <div className="linha" style={{ justifyContent: "center" }}>
          {pagina > 1 && <a className="botao" href={url({ pagina: pagina - 1 })}>Anterior</a>}
          <span className="suave">Página {pagina} de {paginas}</span>
          {pagina < paginas && <a className="botao" href={url({ pagina: pagina + 1 })}>Próxima</a>}
        </div>
      )}
    </>
  );
}
