import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { LINHAS, SUBLINHAS, sublinhasEfetivas, type SubLinhaDb } from "@/lib/vitrine";
import { Avisos } from "../../avisos";

export const metadata = { title: "Subcategorias do site" };

async function salvar(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  let q: string;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono mexe nas subcategorias.");
    const g = (k: string) => String(fd.get(k) ?? "").trim();
    await comUsuario(u.id, (c) => c.query("select app.salvar_subcategoria($1, $2, $3, $4, $5, $6)",
      [g("linha"), g("chave") || null, g("nome"), g("nome_es") || null, g("palavras") || null, fd.get("ativo") !== "0"]));
    q = "ok=" + encodeURIComponent(fd.get("ativo") === "0" ? "Subcategoria escondida do site." : "Subcategoria salva. O site já mostra assim.");
  } catch (e) { q = "erro=" + encodeURIComponent(mensagemErro(e)); }
  revalidatePath("/produtos/subcategorias"); revalidatePath("/produtos/categorias"); revalidatePath("/loja");
  redirect(`/produtos/subcategorias?${q}#${String(fd.get("linha") ?? "")}`);
}

export default async function Subcategorias({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) redirect("/produtos");
  const f = await searchParams;
  const db = await comUsuario(u.id, async (c) => (await c.query("select * from app.subcategorias_publicas()")).rows as SubLinhaDb[]);
  const subs = sublinhasEfetivas(db);
  const escondidas = db.filter((d) => !d.ativo);
  const palavrasDe = (l: string, ch: string) => db.find((d) => d.linha === l && d.chave === ch)?.palavras ?? "";
  const doPrograma = (l: string, ch: string) => Boolean(SUBLINHAS[l]?.some((s) => s.chave === ch));

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/produtos">Produtos</Link> / <Link href="/produtos/categorias">Categorias do site</Link> / Subcategorias</div>
          <h1>Subcategorias do site</h1>
          <p>Os filtros que aparecem dentro de cada categoria na loja (ex.: Cabelo › Protetor térmico). Renomeie, esconda ou crie novas.
            Em <b>palavras</b>, escreva o que costuma estar no nome do produto (separado por vírgula) para ele entrar sozinho; ou coloque produtos à mão em
            <Link href="/produtos/categorias"> Categorias do site</Link> → “Mudar para a categoria”.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      {LINHAS.filter((l) => l.chave !== "outros").map((l) => (
        <section key={l.chave} className="painel" id={l.chave}>
          <h2 style={{ margin: 0 }}>{l.nome}</h2>
          {(subs[l.chave] ?? []).length > 0 && (
            <div className="tabela"><table style={{ minWidth: 0 }}>
              <thead><tr><th>Nome</th><th>Nome em espanhol</th><th>Palavras no nome do produto</th><th></th></tr></thead>
              <tbody>{(subs[l.chave] ?? []).map((s) => (
                <tr key={s.chave}>
                  <td colSpan={4}>
                    <form action={salvar} className="linha" style={{ gap: 6, flexWrap: "wrap" }}>
                      <input type="hidden" name="linha" value={l.chave} /><input type="hidden" name="chave" value={s.chave} />
                      <input name="nome" defaultValue={s.nome} required style={{ flex: "1 1 180px" }} aria-label="Nome" />
                      <input name="nome_es" defaultValue={s.es === s.nome ? "" : s.es} placeholder="(igual)" style={{ flex: "1 1 160px" }} aria-label="Nome em espanhol" />
                      <input name="palavras" defaultValue={palavrasDe(l.chave, s.chave)} placeholder={doPrograma(l.chave, s.chave) ? "(automático do sistema)" : "ex.: matizador, desamarelador"} style={{ flex: "2 1 220px" }} aria-label="Palavras" />
                      <button>Salvar</button>
                      <button name="ativo" value="0" className="discreto">Esconder</button>
                    </form>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <form action={salvar} className="linha" style={{ gap: 6, flexWrap: "wrap" }}>
            <input type="hidden" name="linha" value={l.chave} />
            <b className="pequeno">Nova:</b>
            <input name="nome" placeholder={`Nova subcategoria em ${l.nome}`} required style={{ flex: "1 1 200px" }} aria-label="Nome da nova subcategoria" />
            <input name="nome_es" placeholder="Em espanhol (opcional)" style={{ flex: "1 1 160px" }} aria-label="Nome em espanhol" />
            <input name="palavras" placeholder="Palavras no nome (opcional)" style={{ flex: "2 1 220px" }} aria-label="Palavras" />
            <button className="principal">Criar</button>
          </form>
          {escondidas.filter((d) => d.linha === l.chave).map((d) => (
            <form key={d.chave} action={salvar} className="linha pequeno" style={{ gap: 6 }}>
              <input type="hidden" name="linha" value={l.chave} /><input type="hidden" name="chave" value={d.chave} />
              <input type="hidden" name="nome" value={d.nome} /><input type="hidden" name="nome_es" value={d.nome_es ?? ""} /><input type="hidden" name="palavras" value={d.palavras ?? ""} />
              <span className="suave">Escondida: {d.nome}</span><button>Mostrar de novo</button>
            </form>
          ))}
        </section>
      ))}
    </>
  );
}
