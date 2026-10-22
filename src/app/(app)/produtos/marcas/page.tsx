import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { Avisos, Selo } from "../../avisos";

export const metadata = { title: "Marcas" };

async function juntar(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  let q: string;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono junta marcas.");
    const origens = fd.getAll("origem").map(String).filter(Boolean);
    const destino = String(fd.get("destino") ?? "").trim();
    if (!origens.length) throw new Error("Marque as marcas que são a mesma.");
    if (!destino) throw new Error("Escreva como a marca deve ficar.");
    const n = await comUsuario(u.id, async (c) => Number((await c.query("select app.juntar_marcas($1, $2) n", [origens, destino])).rows[0].n));
    q = "ok=" + encodeURIComponent(`Pronto: ${n} produto(s) agora são da marca ${destino.toUpperCase()}. A importação do Bling também passa a usar esse nome.`);
  } catch (e) { q = "erro=" + encodeURIComponent(mensagemErro(e)); }
  revalidatePath("/produtos/marcas"); revalidatePath("/produtos"); revalidatePath("/loja");
  redirect(`/produtos/marcas?${q}`);
}

// marcas "parecidas": mesmas letras sem espaço/pontuação, ou diferença de até 2 letras
const chave = (m: string) => m.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function distancia(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export default async function Marcas({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) redirect("/produtos");
  const f = await searchParams;
  const marcas = await comUsuario(u.id, async (c) => (await c.query(
    `select marca, count(*) filter (where ativo)::int ativos, count(*)::int total from app.produtos where marca is not null group by marca order by marca`)).rows as
    { marca: string; ativos: number; total: number }[]);
  const parecida = new Map<string, string[]>();
  for (const a of marcas) for (const b of marcas) {
    if (a.marca >= b.marca) continue;
    const ka = chave(a.marca), kb = chave(b.marca);
    if (ka === kb || (ka.length >= 4 && distancia(ka, kb) <= (ka.length >= 8 ? 2 : 1)) || (ka.length >= 4 && (kb.startsWith(ka) || ka.startsWith(kb)))) {
      parecida.set(a.marca, [...(parecida.get(a.marca) ?? []), b.marca]);
      parecida.set(b.marca, [...(parecida.get(b.marca) ?? []), a.marca]);
    }
  }
  const comParecida = marcas.filter((m) => parecida.has(m.marca)).length;

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/produtos">Produtos</Link> / Marcas</div>
          <h1>Marcas</h1>
          <p>Junte marcas escritas de jeitos diferentes (ex.: “RHENUNKS” e “RHENUKS”). Marque as que são a mesma, escreva como deve ficar e clique em <b>Juntar</b>.
            Também serve para renomear: marque uma só e escreva o nome novo. A importação do Bling passa a usar o nome certo.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />
      {comParecida > 0 && <div className="aviso-caixa aviso">{comParecida} marca(s) com nome parecido com outra: estão marcadas como <b>parecida</b> na lista.</div>}

      <form action={juntar}>
        <section className="barra-selecao" style={{ position: "static" }}>
          <div className="bs-grupos">
            <div className="bs-grupo bs-massa">
              <span className="bs-rotulo">Juntar as marcadas em</span>
              <div className="bs-linha">
                <input name="destino" list="marcas-lista" placeholder="Como a marca deve ficar (ex.: RHENUKS)" required aria-label="Nome final da marca" />
                <datalist id="marcas-lista">{marcas.map((m) => <option key={m.marca} value={m.marca} />)}</datalist>
                <button className="principal">Juntar</button>
              </div>
            </div>
          </div>
        </section>
        <section className="painel" style={{ padding: 0 }}>
          <div className="tabela"><table>
            <thead><tr><th style={{ width: 32 }}></th><th>Marca</th><th>Produtos ativos</th><th>Total</th><th>Parecida com</th></tr></thead>
            <tbody>{[...marcas].sort((a, b) => Number(parecida.has(b.marca)) - Number(parecida.has(a.marca)) || a.marca.localeCompare(b.marca, "pt-BR")).map((m) => (
              <tr key={m.marca}>
                <td><input type="checkbox" name="origem" value={m.marca} aria-label={`Marcar ${m.marca}`} /></td>
                <td><b>{m.marca}</b></td>
                <td className="num"><Link href={`/produtos?marca=${encodeURIComponent(m.marca)}`}>{m.ativos}</Link></td>
                <td className="num">{m.total}</td>
                <td>{parecida.has(m.marca) ? <><Selo cor="aviso">parecida</Selo> <span className="pequeno">{parecida.get(m.marca)!.join(", ")}</span></> : <span className="suave">—</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      </form>
    </>
  );
}
