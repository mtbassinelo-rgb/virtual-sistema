import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { Avisos } from "../../avisos";
import { GradePrecos, type LinhaPreco } from "./grade";

export const metadata = { title: "Editar preços rápido" };
const POR_PAGINA = 50;
const TABS = ["py_normal", "py_vip", "br_normal", "br_vip"];

/** "20.000" → 20000 · "39,90" → 39.9 */
function numero(s: string): number | null {
  let t = s.replace(/\s|R\$|Gs/gi, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Valor inválido: "${s}". Use só números, como 15000 ou 9,90.`);
  return n;
}

async function salvar(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  const volta = String(fd.get("volta") ?? "/produtos/precos-rapido");
  let msg: string;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono altera preços.");
    const precos: { id: string; tabela: string; valor: number }[] = [];
    const caixas: { id: string; unidades: string }[] = [];
    for (const [k, v] of fd.entries()) {
      const m = k.match(/^p:([0-9a-f-]{36}):(py_normal|py_vip|br_normal|br_vip)$/);
      if (m) { const n = numero(String(v)); if (n != null) precos.push({ id: m[1], tabela: m[2], valor: n }); continue; }
      const c = k.match(/^caixa:([0-9a-f-]{36})$/);
      if (c) caixas.push({ id: c[1], unidades: String(v).replace(/\D/g, "") });
    }
    if (!precos.length && !caixas.length) throw new Error("Nenhuma alteração para salvar.");
    const r = await comUsuario(u.id, async (c) => {
      const ids = [...new Set([...precos.map((p) => p.id), ...caixas.map((x) => x.id)])];
      const cod = new Map((await c.query("select id::text, codigo from app.produtos where id = any($1::uuid[])", [ids])).rows.map((x) => [x.id, x.codigo]));
      let nc = 0, np = 0;
      if (caixas.length) nc = Number((await c.query("select app.definir_caixas($1::jsonb) as n",
        [JSON.stringify(caixas.filter((x) => cod.has(x.id)).map((x) => ({ codigo: cod.get(x.id), unidades: x.unidades })))])).rows[0].n);
      if (precos.length) np = Number((await c.query("select app.importar_precos($1::jsonb) as r",
        [JSON.stringify(precos.filter((p) => cod.has(p.id)).map((p) => ({ codigo: cod.get(p.id), tabela: p.tabela, valor: p.valor })))])).rows[0].r.alterados);
      return { nc, np };
    });
    msg = "ok=" + encodeURIComponent(`Salvo: ${r.np} preço(s)${r.nc ? ` e ${r.nc} caixa(s)` : ""}.`);
  } catch (e) {
    msg = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  revalidatePath("/produtos");
  redirect(`${volta}${volta.includes("?") ? "&" : "?"}${msg}`);
}

export default async function PrecosRapido({ searchParams }: {
  searchParams: Promise<{ q?: string; marca?: string; mostrar?: string; pagina?: string; ok?: string; erro?: string }>;
}) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono altera preços.</div>;
  const f = await searchParams;
  const mostrar = f.mostrar ?? "sem-preco";
  const pagina = Math.max(1, Number(f.pagina) || 1);
  const par: unknown[] = [];
  const cond = ["p.ativo", "not p.marketplace"];
  if (f.q) { par.push(`%${f.q}%`); cond.push(`(p.nome ilike $${par.length} or p.codigo ilike $${par.length})`); }
  if (f.marca) { par.push(f.marca); cond.push(`p.marca = $${par.length}`); }
  if (mostrar === "sem-preco") cond.push("x.py_normal is null and x.br_normal is null");
  if (mostrar === "incompleto") cond.push("(x.py_normal is null or x.py_vip is null or x.br_normal is null or x.br_vip is null)");
  if (mostrar === "sem-caixa") cond.push("p.unidades_caixa is null");
  const lat = TABS.map((t) => `(select valor from app.precos z where z.produto_id = p.id and z.tabela = '${t}' and z.vigente_desde <= current_date order by vigente_desde desc limit 1) as ${t}`).join(", ");

  const d = await comUsuario(u.id, async (c) => {
    const base = `from app.produtos p cross join lateral (select ${lat}) x where ${cond.join(" and ")}`;
    const total = Number((await c.query(`select count(*) n ${base}`, par)).rows[0].n);
    const linhas = (await c.query(`select p.id, p.codigo, p.nome, p.marca, p.foto, p.unidades_caixa as caixa, x.* ${base}
      order by p.marca nulls last, p.nome limit ${POR_PAGINA} offset ${(pagina - 1) * POR_PAGINA}`, par)).rows as LinhaPreco[];
    const marcas = (await c.query("select marca, count(*)::int n from app.produtos where ativo and not marketplace and marca is not null group by marca order by marca")).rows as { marca: string; n: number }[];
    return { total, linhas, marcas };
  });
  const paginas = Math.max(1, Math.ceil(d.total / POR_PAGINA));
  const url = (m: Record<string, string | number | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: f.q, marca: f.marca, mostrar, ...m })) if (v) s.set(k, String(v));
    return `/produtos/precos-rapido?${s}`;
  };

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><a href="/produtos">Produtos</a> / Editar preços rápido</div>
          <h1>Editar preços rápido</h1>
          <p>Digite os preços direto na tabela e salve tudo de uma vez. Comece pelos produtos sem preço: eles aparecem na loja sem valor para o cliente.</p>
        </div>
        <a className="botao" href="/estoque/precos">Prefiro usar planilha</a>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />
      <nav className="abas" aria-label="O que mostrar">
        {[["sem-preco", "Sem preço"], ["incompleto", "Falta alguma tabela"], ["sem-caixa", "Sem peças por caixa"], ["todos", "Todos ativos"]].map(([k, t]) => (
          <a key={k} href={url({ mostrar: k, pagina: undefined })} aria-current={mostrar === k ? "page" : undefined}>{t}</a>
        ))}
      </nav>
      <form className="painel linha" method="get">
        <input type="hidden" name="mostrar" value={mostrar} />
        <label style={{ flex: 2, minWidth: 200 }}>Buscar<input name="q" defaultValue={f.q} placeholder="Nome ou código" /></label>
        <label style={{ flex: 1, minWidth: 180 }}>Marca
          <select name="marca" defaultValue={f.marca ?? ""}>
            <option value="">Todas as marcas</option>
            {d.marcas.map((m) => <option key={m.marca} value={m.marca}>{m.marca} ({m.n})</option>)}
          </select>
        </label>
        <button className="principal">Filtrar</button>
        <span className="pequeno suave">{d.total.toLocaleString("pt-BR")} produto(s)</span>
      </form>
      {d.linhas.length === 0
        ? <div className="painel vazio">{mostrar === "sem-preco" ? "Nenhum produto sem preço com esse filtro. Tudo certo por aqui." : "Nenhum produto com esse filtro."}</div>
        : <GradePrecos linhas={d.linhas} acao={salvar} volta={url({ pagina: pagina > 1 ? pagina : undefined })} />}
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
