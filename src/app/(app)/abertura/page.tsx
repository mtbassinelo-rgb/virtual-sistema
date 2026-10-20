import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { dinheiro } from "@/lib/formato";
import { Avisos } from "../avisos";
import { MarcarTodos } from "../produtos/lote";

export const metadata = { title: "Abertura da loja" };

type Sugestao = { produto_id: string; codigo: string; nome: string; marca: string | null; categoria: string | null;
  py_normal: string | null; py_vip: string | null; br_normal: string | null; br_vip: string | null };
type Provisorio = { produto_id: string; codigo: string; nome: string; saldo: string };

const ids = (fd: FormData) => fd.getAll("ids").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));

async function aplicarPrecos(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  let q: string;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono altera preços.");
    const lista = ids(fd);
    if (!lista.length) throw new Error("Marque pelo menos um produto.");
    const n = await comUsuario(u.id, async (c) => Number((await c.query("select app.aplicar_sugestoes_preco($1::uuid[]) as n", [lista])).rows[0].n));
    q = "ok=" + encodeURIComponent(`${n} preço(s) gravado(s). Os produtos já aparecem com preço na loja.`);
  } catch (e) { q = "erro=" + encodeURIComponent(mensagemErro(e)); }
  revalidatePath("/loja");
  redirect(`/abertura?${q}`);
}

async function zerarProvisorio(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  let q: string;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono ajusta estoque.");
    const lista = ids(fd);
    if (!lista.length) throw new Error("Marque pelo menos um produto.");
    const n = await comUsuario(u.id, async (c) => Number((await c.query("select app.zerar_estoque_provisorio($1::uuid[]) as n", [lista])).rows[0].n));
    q = "ok=" + encodeURIComponent(`${n} produto(s) com estoque zerado. Na loja eles aparecem como "Pedir por encomenda".`);
  } catch (e) { q = "erro=" + encodeURIComponent(mensagemErro(e)); }
  revalidatePath("/loja");
  redirect(`/abertura?${q}#estoque`);
}

export default async function Abertura({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono vê a abertura da loja.</div>;
  const f = await searchParams;
  const d = await comUsuario(u.id, async (c) => ({
    sug: (await c.query("select * from app.sugestoes_preco()")).rows as Sugestao[],
    prov: (await c.query("select * from app.estoque_provisorio()")).rows as Provisorio[],
    semFoto: Number((await c.query("select count(*) n from app.produtos where ativo and mostrar_no_site and foto is null")).rows[0].n),
  }));
  const comCat = d.sug.filter((s) => s.categoria);
  const semCat = d.sug.filter((s) => !s.categoria);
  const gs = (v: string | null) => (v ? dinheiro(v, "GS") : "—");
  const rs = (v: string | null) => (v ? dinheiro(v, "BRL") : "—");

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Abertura da loja</h1>
          <p>O que falta arrumar para os clientes comprarem pelo site. Confira cada lista e aplique com um clique. Nada muda sem você clicar.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <section className="atalhos">
        <a className="atalho" href="#precos"><b>{comCat.length}</b><span>com preço sugerido pela planilha</span></a>
        <Link className="atalho" href="/produtos/precos-rapido?mostrar=sem-preco"><b>{semCat.length}</b><span>sem categoria: preencher à mão</span></Link>
        <a className="atalho" href="#estoque"><b>{d.prov.length}</b><span>com estoque provisório de 240</span></a>
        <Link className="atalho" href="/produtos/fotos-faltando"><b>{d.semFoto}</b><span>sem foto</span></Link>
      </section>

      <section className="painel" id="precos">
        <div className="linha entre">
          <div>
            <h2>1. Preços sugeridos pela planilha</h2>
            <p className="suave pequeno" style={{ margin: 0 }}>Cada produto sem preço foi encaixado numa linha da planilha “Distribuidora - Controle Mensal” (aba Preços). Desmarque o que estiver errado e aplique o resto.</p>
          </div>
        </div>
        {comCat.length === 0 ? <div className="vazio">Nenhum preço para sugerir. Tudo certo.</div> : (
          <div className="coluna" style={{ gap: 10 }}>
            <div className="tabela"><table>
              <thead><tr><th style={{ width: 32 }}><MarcarTodos form="f-precos" /></th><th>Produto</th><th>Linha da planilha</th><th>PY normal</th><th>PY VIP</th><th>BR Gold</th><th>BR Platinum</th></tr></thead>
              <tbody>{comCat.map((s) => (
                <tr key={s.produto_id}>
                  <td><input type="checkbox" name="ids" value={s.produto_id} defaultChecked form="f-precos" aria-label={`Aplicar preço em ${s.nome}`} /></td>
                  <td><Link href={`/produtos/${s.produto_id}`}>{s.nome}</Link><div className="pequeno suave">{s.codigo}{s.marca ? ` · ${s.marca}` : ""}</div></td>
                  <td className="num">{s.categoria}</td>
                  <td className="num">{gs(s.py_normal)}</td><td className="num">{gs(s.py_vip)}</td>
                  <td className="num">{rs(s.br_normal)}</td><td className="num">{rs(s.br_vip)}</td>
                </tr>))}
              </tbody>
            </table></div>
            <div className="salvar-fixo"><button className="principal" form="f-precos">Aplicar os preços marcados</button>
              <span className="pequeno suave">Preço em Gs é arredondado para múltiplos de 500. Vale a partir de hoje; dá para mudar depois em Editar preços rápido.</span></div>
          </div>
        )}
        <form id="f-precos" action={aplicarPrecos} hidden />
      </section>

      <section className="painel" id="estoque">
        <h2>2. Estoque provisório de 240 peças</h2>
        <p className="suave pequeno" style={{ margin: 0 }}>Estes produtos ainda estão com as 240 peças que colocamos para testar: não vieram na planilha do Bling nem tiveram contagem. Com 240 o cliente pode pedir algo que não existe. Zerando, eles aparecem na loja como “Pedir por encomenda” e a vendedora confirma o prazo. Quando contar, ajuste em Estoque.</p>
        {d.prov.length === 0 ? <div className="vazio">Nenhum produto com estoque provisório.</div> : (
          <>
            <div className="tabela"><table>
              <thead><tr><th style={{ width: 32 }}><MarcarTodos form="f-estoque" /></th><th>Produto</th><th>Saldo</th></tr></thead>
              <tbody>{d.prov.map((p) => (
                <tr key={p.produto_id}>
                  <td><input type="checkbox" name="ids" value={p.produto_id} defaultChecked form="f-estoque" aria-label={`Zerar ${p.nome}`} /></td>
                  <td><Link href={`/produtos/${p.produto_id}`}>{p.nome}</Link><div className="pequeno suave">{p.codigo}</div></td>
                  <td className="num">{Number(p.saldo)}</td>
                </tr>))}
              </tbody>
            </table></div>
            <div className="salvar-fixo"><button className="principal" form="f-estoque">Zerar o estoque dos marcados</button>
              <span className="pequeno suave">Fica registrado no histórico do estoque, com o motivo.</span></div>
          </>
        )}
        <form id="f-estoque" action={zerarProvisorio} hidden />
      </section>
    </>
  );
}
