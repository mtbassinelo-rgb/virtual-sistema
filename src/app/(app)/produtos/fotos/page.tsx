import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { Avisos, Selo } from "../../avisos";
import { aplicarFoto, descartarFoto, reabrirFoto } from "./acoes";

export const metadata = { title: "Fotos do catálogo" };

const POR_PAGINA = 30;
const ABAS = [
  { chave: "pendente", texto: "Para conferir" },
  { chave: "aplicada", texto: "Já no site" },
  { chave: "descartada", texto: "Descartadas" },
] as const;

type Linha = {
  id: string; pagina: number; nome: string; confianca: string | null; status: string; decidido_em: string | null;
  s1_id: string | null; s1_codigo: string | null; s1_nome: string | null; s1_foto: string | null;
  s2_id: string | null; s2_codigo: string | null; s2_nome: string | null; s2_foto: string | null;
  p_id: string | null; p_nome: string | null; quem: string | null;
};

export default async function FotosCatalogo({ searchParams }: {
  searchParams: Promise<{ status?: string; pagina?: string; ok?: string; erro?: string }>;
}) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono confere as fotos do catálogo.</div>;
  const f = await searchParams;
  const status = ABAS.some((a) => a.chave === f.status) ? f.status! : "pendente";
  const pagina = Math.max(1, Number(f.pagina) || 1);

  const d = await comUsuario(u.id, async (c) => {
    const contagem = Object.fromEntries((await c.query("select status, count(*)::int n from app.fotos_catalogo group by status")).rows.map((r) => [r.status, r.n]));
    const lista = (await c.query(`
      select f.id, f.pagina, f.nome, f.confianca, f.status, f.decidido_em,
             s1.id s1_id, s1.codigo s1_codigo, s1.nome s1_nome, s1.foto s1_foto,
             s2.id s2_id, s2.codigo s2_codigo, s2.nome s2_nome, s2.foto s2_foto,
             p.id p_id, p.nome p_nome, us.nome quem
        from app.fotos_catalogo f
        left join app.produtos s1 on s1.id = f.sugestao
        left join app.produtos s2 on s2.id = f.sugestao2
        left join app.produtos p on p.id = f.produto_id
        left join app.usuarios us on us.id = f.decidido_por
       where f.status = $1
       order by f.pagina, f.id limit ${POR_PAGINA} offset ${(pagina - 1) * POR_PAGINA}`, [status])).rows as Linha[];
    const produtos = status === "pendente"
      ? (await c.query("select codigo, nome from app.produtos where ativo order by nome")).rows as { codigo: string; nome: string }[]
      : [];
    return { contagem, lista, produtos };
  });
  const total = Number(d.contagem[status] ?? 0);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const volta = `/produtos/fotos?status=${status}${pagina > 1 ? `&pagina=${pagina}` : ""}`;

  return (
    <>
      <section className="linha entre">
        <div>
          <h1>Fotos do catálogo</h1>
          <p className="suave pequeno" style={{ margin: 0, maxWidth: 720 }}>
            Fotos tiradas do catálogo em PDF. Confira se a foto é do produto sugerido e toque em <b>Usar</b>. Se não for, busque o produto certo no campo abaixo da foto,
            ou descarte. A foto entra no site na hora e pode ser trocada depois na ficha do produto.
          </p>
        </div>
        <Link className="botao" href="/produtos?filtro=sem-foto">Produtos sem foto</Link>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <nav className="linha" aria-label="Situação">
        {ABAS.map((a) => (
          <Link key={a.chave} href={`/produtos/fotos?status=${a.chave}`} className={`botao ${status === a.chave ? "principal" : ""}`}
                aria-current={status === a.chave ? "page" : undefined}>
            {a.texto} <span className="pequeno">({Number(d.contagem[a.chave] ?? 0)})</span>
          </Link>
        ))}
      </nav>

      {d.lista.length === 0 ? (
        <div className="painel suave">{status === "pendente" ? "Nenhuma foto para conferir. Tudo certo!" : "Nada por aqui."}</div>
      ) : (
        <div className="fotos-cat">
          {d.lista.map((x) => (
            <article key={x.id} id={`f-${x.id}`} className="painel foto-cat">
              <img src={`/fotos-catalogo/${x.id}.webp`} alt={x.nome} width={300} height={300} loading="lazy" />
              <div>
                <div className="pequeno suave">Catálogo, página {x.pagina}</div>
                <b>{x.nome || "(sem nome no catálogo)"}</b>
              </div>

              {x.status === "pendente" && (
                <>
                  {[{ id: x.s1_id, codigo: x.s1_codigo, nome: x.s1_nome, foto: x.s1_foto, rotulo: "Sugestão" },
                    { id: x.s2_id, codigo: x.s2_codigo, nome: x.s2_nome, foto: x.s2_foto, rotulo: "Outra opção" }]
                    .filter((s) => s.id).map((s) => (
                      <form key={s.rotulo} action={aplicarFoto} className="sugestao-foto">
                        <input type="hidden" name="id" value={x.id} />
                        <input type="hidden" name="volta" value={volta} />
                        <input type="hidden" name="produto_id" value={s.id!} />
                        <div style={{ minWidth: 0 }}>
                          <div className="pequeno suave">{s.rotulo} {s.foto && <Selo cor="aviso">já tem foto</Selo>}</div>
                          <div className="pequeno">{s.nome}</div>
                        </div>
                        <button className={s.rotulo === "Sugestão" ? "principal" : ""}>Usar</button>
                      </form>
                    ))}
                  <form action={aplicarFoto} className="linha">
                    <input type="hidden" name="id" value={x.id} />
                    <input type="hidden" name="volta" value={volta} />
                    <input name="produto" list="lista-produtos" placeholder="Outro produto: digite nome ou código" aria-label="Outro produto" style={{ flex: 1, minWidth: 0 }} />
                    <button>Usar</button>
                  </form>
                  <Link className="botao" href={`/produtos/novo?foto=${x.id}`}>➕ Criar produto novo com esta foto</Link>
                  <form action={descartarFoto}>
                    <input type="hidden" name="id" value={x.id} />
                    <input type="hidden" name="volta" value={volta} />
                    <button className="discreto">Descartar esta foto</button>
                  </form>
                </>
              )}

              {x.status === "aplicada" && (
                <div className="pequeno">
                  No produto: {x.p_id ? <Link href={`/produtos/${x.p_id}`}>{x.p_nome}</Link> : "—"}
                  <div className="suave">{x.quem ?? ""}{x.decidido_em ? ` · ${new Date(x.decidido_em).toLocaleDateString("pt-BR")}` : ""}</div>
                </div>
              )}

              {x.status !== "pendente" && (
                <form action={reabrirFoto}>
                  <input type="hidden" name="id" value={x.id} />
                  <input type="hidden" name="volta" value={volta} />
                  <button className="discreto">Voltar para conferir</button>
                </form>
              )}
            </article>
          ))}
        </div>
      )}

      {d.produtos.length > 0 && (
        <datalist id="lista-produtos">
          {d.produtos.map((p) => <option key={p.codigo} value={`${p.codigo} — ${p.nome}`} />)}
        </datalist>
      )}

      {paginas > 1 && (
        <div className="linha" style={{ justifyContent: "center" }}>
          {pagina > 1 && <a className="botao" href={`/produtos/fotos?status=${status}&pagina=${pagina - 1}`}>Anterior</a>}
          <span className="suave">Página {pagina} de {paginas}</span>
          {pagina < paginas && <a className="botao" href={`/produtos/fotos?status=${status}&pagina=${pagina + 1}`}>Próxima</a>}
        </div>
      )}
    </>
  );
}
