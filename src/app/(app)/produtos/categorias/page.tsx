import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { LINHAS, SUBLINHAS, categoriasDe, subLinhaDe } from "@/lib/vitrine";
import { Avisos, Selo } from "../../avisos";
import { MarcarTodos } from "./marcar-todos";

export const metadata = { title: "Categorias do site" };

type Linha = { id: string; codigo: string; nome: string; marca: string | null; tipo: string; foto: string | null; grupo: string | null;
  site_categorias: string[] | null; site_subcategoria: string | null };

const nomeLinha = (c: string) => LINHAS.find((l) => l.chave === c)?.nome ?? c;
const nomeSub = (l: string, s: string | null) => (s ? SUBLINHAS[l]?.find((x) => x.chave === s)?.nome ?? (s === "outros" ? "Outros" : s) : null);

function voltar(fd: FormData, q: string) {
  revalidatePath("/produtos/categorias"); revalidatePath("/loja");
  const filtros = String(fd.get("volta") ?? "");
  redirect(`/produtos/categorias?${filtros ? filtros + "&" : ""}${q}`);
}

/** Aplica nos produtos marcados: definir categoria, somar outra categoria, voltar ao automático ou trocar a marca. */
async function aplicar(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  let q: string;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono organiza os produtos.");
    const ids = fd.getAll("id").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    if (!ids.length) throw new Error("Marque pelo menos um produto na lista.");
    const acao = String(fd.get("acao") ?? "");
    const n = await comUsuario(u.id, async (c) => {
      if (acao === "marca") {
        const m = String(fd.get("marca_nova") ?? "").trim().toUpperCase();
        if (!m) throw new Error("Escreva a marca.");
        return (await c.query("update app.produtos set marca = $2 where id = any($1::uuid[]) and marca is distinct from $2", [ids, m])).rowCount ?? 0;
      }
      if (acao === "auto") return Number((await c.query("select app.definir_categorias_site($1, 'auto', null, null) n", [ids])).rows[0].n);
      const [cat, sub] = String(fd.get("categoria") ?? "").split("|");
      if (!LINHAS.some((l) => l.chave === cat)) throw new Error("Escolha a categoria.");
      if (acao === "definir") return Number((await c.query("select app.definir_categorias_site($1, 'definir', $2, $3) n", [ids, [cat], sub || null])).rows[0].n);
      if (acao === "adicionar") {
        // o que o produto já mostra hoje (automático), para não perder a categoria principal ao somar
        const atuais: Record<string, string[]> = {};
        for (const r of (await c.query("select id, nome, marca, tipo, site_categorias from app.produtos where id = any($1::uuid[])", [ids])).rows) {
          const x = categoriasDe(r.nome, r.marca, r.tipo, r.site_categorias);
          atuais[r.id] = [x.linha, ...x.extras];
        }
        return Number((await c.query("select app.definir_categorias_site($1, 'adicionar', $2, null, $3::jsonb) n", [ids, [cat], JSON.stringify(atuais)])).rows[0].n);
      }
      throw new Error("Escolha o que fazer.");
    });
    const txt: Record<string, string> = { definir: "categoria definida", adicionar: "categoria somada", auto: "voltaram ao automático", marca: "marca trocada" };
    q = "ok=" + encodeURIComponent(`${n} produto(s): ${txt[acao] ?? "atualizado"}. O site já mostra assim.`);
  } catch (e) { q = "erro=" + encodeURIComponent(mensagemErro(e)); }
  voltar(fd, q);
}

export default async function CategoriasSite({ searchParams }: { searchParams: Promise<{ cat?: string; marca?: string; q?: string; origem?: string; ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) redirect("/produtos");
  const f = await searchParams;
  const todos = await comUsuario(u.id, async (c) => (await c.query(
    `select id, codigo, nome, marca, tipo::text as tipo, foto, grupo, site_categorias, site_subcategoria
       from app.produtos where ativo and mostrar_no_site order by nome`)).rows as Linha[]);
  const linhas = todos.map((p) => {
    const x = categoriasDe(p.nome, p.marca, p.tipo, p.site_categorias);
    const sub = p.site_subcategoria && SUBLINHAS[x.linha]?.some((s) => s.chave === p.site_subcategoria) ? p.site_subcategoria : subLinhaDe(x.linha, p.grupo ?? p.nome);
    return { ...p, cat: x.linha, extras: x.extras, sub, manual: Boolean(p.site_categorias?.length || p.site_subcategoria) };
  });
  const marcas = [...new Set(todos.map((p) => p.marca).filter(Boolean) as string[])].sort();
  const busca = (f.q ?? "").trim().toUpperCase();
  const vistos = linhas.filter((p) =>
    (!f.cat || p.cat === f.cat || p.extras.includes(f.cat))
    && (!f.marca || (f.marca === "-" ? !p.marca : p.marca === f.marca))
    && (!f.origem || (f.origem === "manual" ? p.manual : !p.manual))
    && (!busca || `${p.nome} ${p.codigo} ${p.marca ?? ""}`.toUpperCase().includes(busca)));
  const contagem = new Map<string, number>();
  for (const p of linhas) for (const c of [p.cat, ...p.extras]) contagem.set(c, (contagem.get(c) ?? 0) + 1);
  const volta = new URLSearchParams(Object.entries({ cat: f.cat, marca: f.marca, q: f.q, origem: f.origem }).filter((x): x is [string, string] => Boolean(x[1]))).toString();

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/produtos">Produtos</Link> / Categorias do site</div>
          <h1>Categorias do site</h1>
          <p>Em que categoria cada produto aparece na loja. O site escolhe sozinho pelo nome; aqui você corrige: coloca um kit também em <b>Matizadores</b>,
            muda a subcategoria, troca a marca de vários de uma vez. Marque os produtos, escolha o que fazer e clique em <b>Aplicar</b>.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <nav className="linha" style={{ flexWrap: "wrap", gap: 6 }}>
        <Link className={`botao ${!f.cat ? "principal" : ""}`} href={`/produtos/categorias${f.marca ? `?marca=${encodeURIComponent(f.marca)}` : ""}`}>Todas ({linhas.length})</Link>
        {LINHAS.filter((l) => contagem.get(l.chave)).map((l) => (
          <Link key={l.chave} className={`botao ${f.cat === l.chave ? "principal" : ""}`}
            href={`/produtos/categorias?cat=${l.chave}${f.marca ? `&marca=${encodeURIComponent(f.marca)}` : ""}`}>{l.nome} ({contagem.get(l.chave)})</Link>
        ))}
      </nav>

      <form className="painel campos" method="get">
        {f.cat && <input type="hidden" name="cat" value={f.cat} />}
        <label>Buscar<input name="q" defaultValue={f.q ?? ""} placeholder="Nome, código ou marca" /></label>
        <label>Marca
          <select name="marca" defaultValue={f.marca ?? ""}>
            <option value="">Todas</option><option value="-">Sem marca</option>
            {marcas.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>Origem
          <select name="origem" defaultValue={f.origem ?? ""}>
            <option value="">Todas</option><option value="manual">Escolhida à mão</option><option value="auto">Automática</option>
          </select>
        </label>
        <button>Filtrar</button>
      </form>

      <form action={aplicar}>
        <input type="hidden" name="volta" value={volta} />
        <section className="barra-selecao" aria-label="Aplicar nos marcados" style={{ position: "static" }}>
          <div className="bs-grupos">
            <div className="bs-grupo bs-massa">
              <span className="bs-rotulo">O que fazer com os marcados</span>
              <div className="bs-linha">
                <select name="acao" defaultValue="adicionar" aria-label="O que fazer">
                  <option value="adicionar">Mostrar também em…</option>
                  <option value="definir">Mudar para a categoria…</option>
                  <option value="auto">Voltar ao automático (pelo nome)</option>
                  <option value="marca">Trocar a marca para…</option>
                </select>
                <select name="categoria" defaultValue={f.cat ?? ""} aria-label="Categoria">
                  <option value="">Categoria…</option>
                  {LINHAS.map((l) => (
                    <optgroup key={l.chave} label={l.nome}>
                      <option value={l.chave}>{l.nome}</option>
                      {(SUBLINHAS[l.chave] ?? []).map((s) => <option key={s.chave} value={`${l.chave}|${s.chave}`}>{l.nome} › {s.nome}</option>)}
                    </optgroup>
                  ))}
                </select>
                <input name="marca_nova" list="marcas-cat" placeholder="Marca (se for trocar)" aria-label="Nova marca" />
                <datalist id="marcas-cat">{marcas.map((m) => <option key={m} value={m} />)}</datalist>
                <button className="principal">Aplicar</button>
              </div>
            </div>
          </div>
          <p className="bs-nota"><b>Mostrar também em</b> mantém onde já está e soma a nova categoria (ex.: kit matizador em Kits e em Matizadores).
            <b> Mudar para</b> deixa só a categoria escolhida (com a subcategoria, se escolher uma). <b>Voltar ao automático</b> desfaz.</p>
        </section>

        <section className="painel" style={{ padding: 0 }}>
          <div className="tabela"><table>
            <thead><tr>
              <th style={{ width: 32 }}><MarcarTodos /></th>
              <th>Produto</th><th>Marca</th><th>Categoria no site</th><th>Subcategoria</th>
            </tr></thead>
            <tbody>{vistos.slice(0, 600).map((p) => (
              <tr key={p.id}>
                <td><input type="checkbox" name="id" value={p.id} aria-label={`Marcar ${p.nome}`} /></td>
                <td>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {p.foto ? <img src={p.foto} alt="" loading="lazy" width={40} height={40} style={{ width: 40, height: 40, objectFit: "contain", borderRadius: 6, background: "#fff", border: "1px solid var(--linha)", flex: "none" }} />
                      : <div aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 6, background: "var(--afundado)", flex: "none" }} />}
                    <div><Link href={`/produtos/${p.id}`}>{p.nome}</Link><div className="pequeno suave">{p.codigo}{p.tipo === "kit" ? " · kit" : ""}</div></div>
                  </div>
                </td>
                <td>{p.marca ?? <span className="suave">—</span>}</td>
                <td>
                  <b>{nomeLinha(p.cat)}</b>{p.extras.length > 0 && <span className="pequeno"> + {p.extras.map(nomeLinha).join(", ")}</span>}
                  <div>{p.manual ? <Selo cor="marca">à mão</Selo> : <span className="pequeno suave">automática</span>}</div>
                </td>
                <td className="pequeno">{nomeSub(p.cat, p.sub) ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
          {vistos.length === 0 && <div className="vazio">Nenhum produto com esses filtros.</div>}
          {vistos.length > 600 && <p className="pequeno suave" style={{ padding: 10 }}>Mostrando 600 de {vistos.length}. Use os filtros para ver o resto.</p>}
        </section>
      </form>
    </>
  );
}
