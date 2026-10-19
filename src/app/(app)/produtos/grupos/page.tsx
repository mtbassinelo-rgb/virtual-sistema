import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { sugerirGrupos, varianteNoGrupo, type ProdutoGrupo } from "@/lib/grupos";
import { Avisos } from "../../avisos";

export const metadata = { title: "Fragrâncias agrupadas" };

type Ativo = ProdutoGrupo & { codigo: string; grupo: string | null };
type Grupo = { grupo: string; marca: string | null; itens: { id: string; nome: string; codigo: string; variante: string | null }[] };

const carregar = (uid: string) => comUsuario(uid, async (c) => {
  const ativos = (await c.query("select id, codigo, nome, marca, tipo, grupo from app.produtos where ativo order by nome")).rows as Ativo[];
  const grupos = (await c.query(`select grupo, min(marca) marca, json_agg(json_build_object('id', id, 'nome', nome, 'codigo', codigo, 'variante', variante) order by variante) itens
                                   from app.produtos where ativo and grupo is not null group by grupo order by min(marca), grupo`)).rows as Grupo[];
  return { ativos, livres: ativos.filter((p) => !p.grupo), grupos };
});

const UUID = /^[0-9a-f-]{36}$/i;
/** Campo "adicionar produto": aceita o texto da lista ("CÓDIGO · nome") ou só o código. */
function acharProdutos(fd: FormData, campo: string, ativos: Ativo[]): Ativo[] {
  const porCodigo = new Map(ativos.map((p) => [p.codigo.toUpperCase(), p]));
  return fd.getAll(campo).map(String).flatMap((v) => v.split(/[\n;]/)).map((v) => v.split(" · ")[0].trim().toUpperCase())
    .filter(Boolean).map((cod) => porCodigo.get(cod)).filter((p): p is Ativo => !!p);
}

async function gravar(uid: string, linhas: { produto_id: string; grupo: string; variante?: string }[]) {
  return comUsuario(uid, async (c) => Number((await c.query("select app.definir_grupos($1::jsonb) as n", [JSON.stringify(linhas)])).rows[0].n));
}

function voltar(q: string) {
  revalidatePath("/produtos/grupos"); revalidatePath("/loja");
  redirect(`/produtos/grupos?${q}`);
}

async function aplicar(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  let q: string;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono agrupa produtos.");
    const marcados = new Set(fd.getAll("g").map(String));
    const { livres, ativos } = await carregar(u.id);
    const sugestoes = sugerirGrupos(livres);
    const nomeDe = (chave: string) => {
      const g = sugestoes.find((x) => x.chave === chave);
      return g ? String(fd.get(`nome:${chave}`) ?? g.nome).trim() || g.nome : "";
    };
    // "juntar com": a sugestão vai para dentro de outra (segue a corrente: A→B→C fica tudo em C)
    const destino = (chave: string) => {
      let atual = chave;
      for (let i = 0; i < 10; i++) { const prox = String(fd.get(`junto:${atual}`) ?? ""); if (!prox || prox === chave || !sugestoes.some((x) => x.chave === prox)) break; atual = prox; }
      return atual;
    };
    const linhas = new Map<string, { produto_id: string; grupo: string; variante: string }>();
    let grupos = 0;
    for (const g of sugestoes.filter((x) => marcados.has(x.chave))) {
      const alvo = destino(g.chave);
      const nome = nomeDe(alvo);
      if (alvo === g.chave) grupos++;
      for (const i of g.itens.filter((i) => fd.get(`fora:${i.id}`) !== "1"))
        linhas.set(i.id, { produto_id: i.id, grupo: nome, variante: String(fd.get(`var:${i.id}`) ?? i.variante).trim() || i.variante });
      for (const p of acharProdutos(fd, `add:${g.chave}`, ativos))
        if (!linhas.has(p.id)) linhas.set(p.id, { produto_id: p.id, grupo: nome, variante: varianteNoGrupo(g.itens.map((x) => x.nome), p) });
    }
    const n = await gravar(u.id, [...linhas.values()]);
    q = "ok=" + encodeURIComponent(`${grupos} grupo(s) criado(s), ${n} produto(s) agrupado(s). No site eles já aparecem como um cartão só.`);
  } catch (e) { q = "erro=" + encodeURIComponent(mensagemErro(e)); }
  voltar(q);
}

/** Salva um grupo do site: nome, fragrâncias, tirar produtos, adicionar produtos e juntar outro grupo nele. */
async function salvarGrupo(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  let q: string;
  try {
    const { ativos, grupos } = await carregar(u.id);
    const original = String(fd.get("original") ?? "");
    const g = grupos.find((x) => x.grupo === original);
    if (!g) throw new Error("Esse grupo não existe mais. Atualize a página.");
    const nome = String(fd.get("grupo") ?? "").trim() || g.grupo;
    const linhas: { produto_id: string; grupo: string; variante?: string }[] = [];
    const ficam: string[] = [];
    for (const i of g.itens) {
      if (fd.get(`fora:${i.id}`) === "1") linhas.push({ produto_id: i.id, grupo: "" });
      else { linhas.push({ produto_id: i.id, grupo: nome, variante: String(fd.get(`var:${i.id}`) ?? i.variante ?? "").trim() || i.nome }); ficam.push(i.nome); }
    }
    let juntou = 0;
    const outro = grupos.find((x) => x.grupo === String(fd.get("juntar") ?? "") && x.grupo !== g.grupo);
    if (outro) for (const i of outro.itens) { linhas.push({ produto_id: i.id, grupo: nome, variante: i.variante ?? i.nome }); ficam.push(i.nome); juntou++; }
    const ja = new Set(linhas.map((l) => l.produto_id));
    let novos = 0;
    for (const p of acharProdutos(fd, "add", ativos)) {
      if (ja.has(p.id) || !UUID.test(p.id)) continue;
      linhas.push({ produto_id: p.id, grupo: nome, variante: varianteNoGrupo(ficam, p) });
      ja.add(p.id); ficam.push(p.nome); novos++;
    }
    await gravar(u.id, linhas);
    const tirados = linhas.filter((l) => l.grupo === "").length;
    q = "ok=" + encodeURIComponent(["Grupo salvo", novos && `${novos} produto(s) adicionado(s)`, tirados && `${tirados} tirado(s)`,
      juntou && `grupo "${outro?.grupo}" juntado`].filter(Boolean).join(", ") + ".");
  } catch (e) { q = "erro=" + encodeURIComponent(mensagemErro(e)); }
  voltar(q);
}

async function desfazer(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  let q: string;
  try {
    const ids = fd.getAll("id").map(String).filter((x) => UUID.test(x));
    await gravar(u.id, ids.map((id) => ({ produto_id: id, grupo: "" })));
    q = "ok=" + encodeURIComponent("Grupo desfeito: os produtos voltam a aparecer separados.");
  } catch (e) { q = "erro=" + encodeURIComponent(mensagemErro(e)); }
  voltar(q);
}

async function criarGrupo(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  let q: string;
  try {
    const nome = String(fd.get("grupo") ?? "").trim();
    if (!nome) throw new Error("Dê um nome ao grupo.");
    const { ativos } = await carregar(u.id);
    const ps = [...new Map(acharProdutos(fd, "add", ativos).map((p) => [p.id, p])).values()];
    if (ps.length < 2) throw new Error("Escolha pelo menos 2 produtos para o grupo.");
    const nomes = ps.map((p) => p.nome);
    await gravar(u.id, ps.map((p, i) => ({ produto_id: p.id, grupo: nome, variante: varianteNoGrupo(nomes.filter((_, k) => k !== i), p) })));
    q = "ok=" + encodeURIComponent(`Grupo "${nome}" criado com ${ps.length} produtos.`);
  } catch (e) { q = "erro=" + encodeURIComponent(mensagemErro(e)); }
  voltar(q);
}

const CampoAdicionar = ({ name, placeholder }: { name: string; placeholder?: string }) => (
  <input name={name} list="produtos-ativos" placeholder={placeholder ?? "+ adicionar produto (código ou nome)"} aria-label="Adicionar produto ao grupo"
    style={{ width: "100%", padding: "4px 8px" }} />
);

export default async function Grupos({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; q?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) redirect("/produtos");
  const f = await searchParams;
  const d = await carregar(u.id);
  const sugestoes = sugerirGrupos(d.livres);
  const busca = (f.q ?? "").trim().toUpperCase();
  const gruposVistos = busca ? d.grupos.filter((g) => `${g.grupo} ${g.marca ?? ""} ${g.itens.map((i) => i.nome).join(" ")}`.toUpperCase().includes(busca)) : d.grupos;
  const marcaDaSugestao = (chave: string) => chave.split("|")[0];
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

      <datalist id="produtos-ativos">
        {d.ativos.map((p) => <option key={p.id} value={`${p.codigo} · ${p.nome}`}>{p.grupo ? `já no grupo ${p.grupo}` : p.marca ?? ""}</option>)}
      </datalist>

      <form action={aplicar} className="painel">
        <div className="linha entre">
          <h2 style={{ margin: 0 }}>Sugestões ({sugestoes.length})</h2>
          <button className="principal">Agrupar os marcados</button>
        </div>
        <p className="suave pequeno" style={{ margin: 0 }}>Desmarque o grupo que não faz sentido, tire um produto ou adicione outro. Se duas sugestões são o mesmo produto, use <b>juntar com</b> numa delas. Dá para corrigir o nome do grupo e de cada fragrância antes de agrupar.</p>
        {sugestoes.length === 0 && <div className="vazio">Nenhuma sugestão nova: tudo que parecia fragrância já está agrupado.</div>}
        <div className="grupos-lista">
          {sugestoes.map((g) => {
            const mesmaMarca = sugestoes.filter((x) => x.chave !== g.chave && marcaDaSugestao(x.chave) === marcaDaSugestao(g.chave));
            return (
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
                <div className="grupo-acoes">
                  <CampoAdicionar name={`add:${g.chave}`} />
                  {mesmaMarca.length > 0 && (
                    <select name={`junto:${g.chave}`} defaultValue="" aria-label="Juntar com outra sugestão">
                      <option value="">Juntar com… (não)</option>
                      {mesmaMarca.map((x) => <option key={x.chave} value={x.chave}>{x.nome} ({x.itens.length})</option>)}
                    </select>
                  )}
                </div>
              </fieldset>
            );
          })}
        </div>
        {sugestoes.length > 0 && <button className="principal">Agrupar os marcados</button>}
      </form>

      <form action={criarGrupo} className="painel">
        <h2 style={{ margin: 0 }}>Criar grupo do zero</h2>
        <p className="suave pequeno" style={{ margin: 0 }}>Para o que não apareceu nas sugestões. Escolha os produtos na lista (digite parte do nome ou o código).</p>
        <div className="grupo-acoes" style={{ flexWrap: "wrap" }}>
          <input name="grupo" placeholder="Nome do grupo (ex.: BODY SPLASH MARY LIFE)" style={{ minWidth: 280, fontWeight: 700 }} aria-label="Nome do novo grupo" />
          {Array.from({ length: 6 }, (_, i) => <CampoAdicionar key={i} name="add" placeholder={`Produto ${i + 1}`} />)}
          <button className="principal">Criar grupo</button>
        </div>
      </form>

      <section className="painel">
        <div className="linha entre">
          <h2 style={{ margin: 0 }}>Grupos no site ({d.grupos.length})</h2>
          <form className="linha" style={{ gap: 6 }}>
            <input name="q" defaultValue={f.q ?? ""} placeholder="Buscar grupo ou produto" aria-label="Buscar grupo" />
            <button>Buscar</button>
          </form>
        </div>
        <p className="suave pequeno" style={{ margin: 0 }}>Em cada grupo: mude nomes, marque <b>tirar</b>, adicione produtos ou <b>junte outro grupo</b> dentro dele, e clique em Salvar.</p>
        {gruposVistos.length === 0 ? <div className="vazio">{busca ? "Nenhum grupo com esse nome." : "Nenhum grupo ainda."}</div> : (
          <div className="grupos-lista">{gruposVistos.map((g) => {
            const outros = d.grupos.filter((x) => x.grupo !== g.grupo && x.marca === g.marca);
            return (
              <fieldset key={g.grupo} className="grupo-sugerido">
                <form action={salvarGrupo}>
                  <input type="hidden" name="original" value={g.grupo} />
                  <legend className="linha" style={{ gap: 8 }}>
                    <input name="grupo" defaultValue={g.grupo} aria-label="Nome do grupo" style={{ minWidth: 260, fontWeight: 700 }} />
                    <span className="suave pequeno">{g.itens.length} fragrâncias</span>
                    <button className="principal">Salvar</button>
                  </legend>
                  <ul>{g.itens.map((i) => (
                    <li key={i.id}>
                      <input name={`var:${i.id}`} defaultValue={i.variante ?? ""} aria-label={`Fragrância de ${i.nome}`} />
                      <span className="pequeno suave">{i.nome}</span>
                      <label className="pequeno" style={{ flexDirection: "row", gap: 4 }}><input type="checkbox" name={`fora:${i.id}`} value="1" /> tirar</label>
                    </li>
                  ))}</ul>
                  <div className="grupo-acoes">
                    <CampoAdicionar name="add" />
                    {outros.length > 0 && (
                      <select name="juntar" defaultValue="" aria-label="Juntar outro grupo neste">
                        <option value="">Juntar outro grupo aqui… (não)</option>
                        {outros.map((x) => <option key={x.grupo} value={x.grupo}>{x.grupo} ({x.itens.length})</option>)}
                      </select>
                    )}
                  </div>
                </form>
                <form action={desfazer} style={{ marginTop: 6 }}>{g.itens.map((i) => <input key={i.id} type="hidden" name="id" value={i.id} />)}<button className="discreto">Desfazer grupo</button></form>
              </fieldset>
            );
          })}</div>
        )}
      </section>
    </>
  );
}
