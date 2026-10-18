import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { sugerirGrupos, type ProdutoGrupo } from "@/lib/grupos";
import { Avisos } from "../../avisos";

export const metadata = { title: "Fragrâncias agrupadas" };

const carregar = (uid: string) => comUsuario(uid, async (c) => ({
  livres: (await c.query("select id, nome, marca, tipo from app.produtos where ativo and grupo is null order by nome")).rows as ProdutoGrupo[],
  grupos: (await c.query(`select grupo, marca, json_agg(json_build_object('id', id, 'nome', nome, 'variante', variante) order by variante) itens
                            from app.produtos where ativo and grupo is not null group by grupo, marca order by marca, grupo`)).rows as
    { grupo: string; marca: string | null; itens: { id: string; nome: string; variante: string | null }[] }[],
}));

async function aplicar(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  let q: string;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono agrupa produtos.");
    const marcados = new Set(fd.getAll("g").map(String));
    const { livres } = await carregar(u.id);
    const linhas = sugerirGrupos(livres).filter((g) => marcados.has(g.chave)).flatMap((g) => {
      const nome = String(fd.get(`nome:${g.chave}`) ?? g.nome).trim() || g.nome;
      return g.itens.filter((i) => fd.get(`fora:${i.id}`) !== "1")
        .map((i) => ({ produto_id: i.id, grupo: nome, variante: String(fd.get(`var:${i.id}`) ?? i.variante).trim() || i.variante }));
    });
    const n = await comUsuario(u.id, async (c) => Number((await c.query("select app.definir_grupos($1::jsonb) as n", [JSON.stringify(linhas)])).rows[0].n));
    q = "ok=" + encodeURIComponent(`${marcados.size} grupo(s) criado(s), ${n} produto(s) agrupado(s). No site eles já aparecem como um cartão só.`);
  } catch (e) { q = "erro=" + encodeURIComponent(mensagemErro(e)); }
  revalidatePath("/produtos/grupos"); revalidatePath("/loja");
  redirect(`/produtos/grupos?${q}`);
}

async function desfazer(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  let q: string;
  try {
    const ids = fd.getAll("id").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    await comUsuario(u.id, (c) => c.query("select app.definir_grupos($1::jsonb)", [JSON.stringify(ids.map((id) => ({ produto_id: id, grupo: "" })))]));
    q = "ok=" + encodeURIComponent("Grupo desfeito: os produtos voltam a aparecer separados.");
  } catch (e) { q = "erro=" + encodeURIComponent(mensagemErro(e)); }
  revalidatePath("/produtos/grupos"); revalidatePath("/loja");
  redirect(`/produtos/grupos?${q}`);
}

async function renomear(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  let q: string;
  try {
    const linhas: { produto_id: string; grupo: string; variante: string }[] = [];
    const nome = String(fd.get("grupo") ?? "").trim();
    for (const [k, v] of fd.entries()) { const m = /^var:([0-9a-f-]{36})$/i.exec(k); if (m) linhas.push({ produto_id: m[1], grupo: nome, variante: String(v) }); }
    await comUsuario(u.id, (c) => c.query("select app.definir_grupos($1::jsonb)", [JSON.stringify(linhas)]));
    q = "ok=" + encodeURIComponent("Grupo salvo.");
  } catch (e) { q = "erro=" + encodeURIComponent(mensagemErro(e)); }
  revalidatePath("/produtos/grupos"); revalidatePath("/loja");
  redirect(`/produtos/grupos?${q}`);
}

export default async function Grupos({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) redirect("/produtos");
  const f = await searchParams;
  const d = await carregar(u.id);
  const sugestoes = sugerirGrupos(d.livres);
  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/produtos">Produtos</Link> / Fragrâncias agrupadas</div>
          <h1>Fragrâncias agrupadas</h1>
          <p>O mesmo produto em várias fragrâncias, tons ou sabores aparece no site como <b>um cartão só</b>: o cliente abre e escolhe quantas caixas de cada um quer. Cada fragrância continua com estoque, preço e código próprios.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <form action={aplicar} className="painel">
        <div className="linha entre">
          <h2 style={{ margin: 0 }}>Sugestões ({sugestoes.length})</h2>
          <button className="principal">Agrupar os marcados</button>
        </div>
        <p className="suave pequeno" style={{ margin: 0 }}>Desmarque o grupo que não faz sentido ou tire um produto dele. Dá para corrigir o nome do grupo e o nome de cada fragrância antes de agrupar.</p>
        {sugestoes.length === 0 && <div className="vazio">Nenhuma sugestão nova: tudo que parecia fragrância já está agrupado.</div>}
        <div className="grupos-lista">
          {sugestoes.map((g) => (
            <fieldset key={g.chave} className="grupo-sugerido">
              <legend className="linha" style={{ gap: 8 }}>
                <input type="checkbox" name="g" value={g.chave} defaultChecked aria-label={`Agrupar ${g.nome}`} />
                <input name={`nome:${g.chave}`} defaultValue={g.nome} aria-label="Nome do grupo" style={{ minWidth: 280, fontWeight: 700 }} />
                <span className="suave pequeno">{g.itens.length} fragrâncias</span>
              </legend>
              <ul>{g.itens.map((i) => (
                <li key={i.id}>
                  <input name={`var:${i.id}`} defaultValue={i.variante} aria-label={`Fragrância de ${i.nome}`} />
                  <span className="pequeno suave">{i.nome}</span>
                  <label className="pequeno" style={{ flexDirection: "row", gap: 4 }}><input type="checkbox" name={`fora:${i.id}`} value="1" /> tirar</label>
                </li>
              ))}</ul>
            </fieldset>
          ))}
        </div>
        {sugestoes.length > 0 && <button className="principal">Agrupar os marcados</button>}
      </form>

      <section className="painel">
        <h2 style={{ margin: 0 }}>Grupos no site ({d.grupos.length})</h2>
        {d.grupos.length === 0 ? <div className="vazio">Nenhum grupo ainda.</div> : (
          <div className="grupos-lista">{d.grupos.map((g) => (
            <fieldset key={`${g.marca}|${g.grupo}`} className="grupo-sugerido">
              <form action={renomear}>
                <legend className="linha" style={{ gap: 8 }}>
                  <input name="grupo" defaultValue={g.grupo} aria-label="Nome do grupo" style={{ minWidth: 280, fontWeight: 700 }} />
                  <span className="suave pequeno">{g.itens.length} fragrâncias</span>
                  <button>Salvar</button>
                </legend>
                <ul>{g.itens.map((i) => (
                  <li key={i.id}><input name={`var:${i.id}`} defaultValue={i.variante ?? ""} aria-label={`Fragrância de ${i.nome}`} /><span className="pequeno suave">{i.nome}</span></li>
                ))}</ul>
              </form>
              <form action={desfazer}>{g.itens.map((i) => <input key={i.id} type="hidden" name="id" value={i.id} />)}<button className="discreto">Desfazer grupo</button></form>
            </fieldset>
          ))}</div>
        )}
      </section>
    </>
  );
}
