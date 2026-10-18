import Link from "next/link";
import { notFound } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { CampoFoto } from "./campo-foto";
import { Avisos, Selo } from "../../avisos";
import { removerFoto, salvarProduto } from "../acoes";

export const metadata = { title: "Produto" };

const TABELAS = [
  { chave: "py_normal", nome: "Paraguai · Normal (Gs)", gs: true },
  { chave: "py_vip", nome: "Paraguai · VIP (Gs)", gs: true },
  { chave: "br_normal", nome: "Brasil · Normal (R$)", gs: false },
  { chave: "br_vip", nome: "Brasil · VIP (R$)", gs: false },
];

export default async function Produto({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string; foto?: string }>;
}) {
  const u = await exigirUsuario();
  const { id } = await params;
  const f = await searchParams;
  const novo = id === "novo";
  if (!novo && !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const pode = ehGestao(u);

  const d = novo ? null : await comUsuario(u.id, async (c) => {
    const p = (await c.query("select * from app.produtos where id = $1", [id])).rows[0];
    if (!p) return null;
    const precos = (await c.query(
      `select distinct on (tabela) tabela, valor, vigente_desde from app.precos
        where produto_id = $1 and vigente_desde <= current_date order by tabela, vigente_desde desc`, [id])).rows;
    const historico = (await c.query(
      `select pr.tabela, pr.valor, pr.vigente_desde, u.nome as quem from app.precos pr left join app.usuarios u on u.id = pr.definido_por
        where pr.produto_id = $1 order by pr.vigente_desde desc, pr.tabela limit 20`, [id])).rows;
    const estoque = (await c.query(
      `select d.nome, app.saldo_disponivel(d.id, $1) as saldo from app.depositos d where d.ativo order by d.tipo, d.nome`, [id])).rows;
    const componentes = (await c.query(
      `select c.codigo, c.nome, k.quantidade from app.kit_componentes k join app.produtos c on c.id = k.componente_id where k.kit_id = $1`, [id])).rows;
    return { p, precos, historico, estoque, componentes };
  });
  if (!novo && !d) notFound();
  // Novo produto a partir de uma foto do catálogo (Produtos → Fotos do catálogo)
  const fotoCat = novo && f.foto && /^p[0-9]{2}-[0-9]{2}$/.test(f.foto)
    ? await comUsuario(u.id, async (c) => (await c.query("select id, nome from app.fotos_catalogo where id = $1 and status = 'pendente'", [f.foto])).rows[0] as { id: string; nome: string } | undefined)
    : undefined;
  const opcoes = pode ? await comUsuario(u.id, async (c) => (await c.query(
    "select codigo, nome from app.produtos where ativo and tipo <> 'kit' order by nome")).rows as { codigo: string; nome: string }[]) : [];
  const comps: { codigo: string; nome: string; quantidade: number }[] = (d?.componentes ?? []).map((c) => ({ codigo: c.codigo, nome: c.nome, quantidade: Number(c.quantidade) }));
  const linhasKit = [...comps, ...Array(Math.max(0, 6 - comps.length)).fill(null)].slice(0, 6) as ({ codigo: string; nome: string; quantidade: number } | null)[];
  const p = d?.p;
  const preco = (t: string) => d?.precos.find((x) => x.tabela === t)?.valor;
  const fmt = (v: unknown, gs: boolean) => (v == null ? "" : gs ? String(Math.round(Number(v))) : Number(v).toFixed(2).replace(".", ","));

  return (
    <>
      <section>
        <div className="pequeno"><Link href="/produtos">Produtos</Link></div>
        <h1>{novo ? "Novo produto" : p.nome}</h1>
        {!novo && (
          <div className="linha pequeno suave" style={{ gap: 8 }}>
            <span>{p.codigo}</span>
            {p.tipo === "kit" && <Selo cor="info">kit</Selo>}
            {!p.ativo && <Selo>inativo</Selo>}
            {p.codigo_provisorio && <Selo cor="aviso">código provisório: corrija no Bling ou aqui</Selo>}
            {p.bling_produto_id && <span>ID Bling {String(p.bling_produto_id)}</span>}
          </div>
        )}
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <form action={salvarProduto} className="duas-colunas">
        <input type="hidden" name="id" value={novo ? "" : id} />
        {fotoCat && <input type="hidden" name="foto_catalogo" value={fotoCat.id} />}
        <section className="painel">
          <h2>Dados</h2>
          <div className="campos" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            <label>Código (SKU)<input name="codigo" defaultValue={p?.codigo ?? ""} required disabled={!pode} placeholder="Ex.: RHE-020" /></label>
            <label style={{ gridColumn: "span 2" }}>Nome<input name="nome" defaultValue={p?.nome ?? fotoCat?.nome ?? ""} required disabled={!pode} /></label>
            <label>Marca<input name="marca" defaultValue={p?.marca ?? ""} disabled={!pode} placeholder="Ex.: Maycrene" /></label>
            <label>Unidade<input name="unidade" defaultValue={p?.unidade ?? "UN"} disabled={!pode} /></label>
            <label>Código de barras<input name="gtin" defaultValue={p?.gtin ?? ""} disabled={!pode} inputMode="numeric" /></label>
            <label>Peças por caixa<input name="unidades_caixa" defaultValue={p?.unidades_caixa ?? ""} disabled={!pode} inputMode="numeric" placeholder="Ex.: 12" /></label>
            <label>Custo (R$)<input name="custo" defaultValue={p?.custo != null ? Number(p.custo).toFixed(2).replace(".", ",") : ""} disabled={!pode} inputMode="decimal" /></label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="ativo" defaultChecked={p ? p.ativo : true} disabled={!pode} style={{ width: "auto" }} /> Ativo (vende no sistema)
            </label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="mostrar_no_site" defaultChecked={p ? p.mostrar_no_site !== false : true} disabled={!pode} style={{ width: "auto" }} /> Mostrar no site
              <span className="pequeno suave">(desligue nos produtos vendidos só em kit)</span>
            </label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="destaque" defaultChecked={p ? p.destaque : false} disabled={!pode} style={{ width: "auto" }} /> Destaque no site
            </label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="novidade" defaultChecked={p ? p.novidade : false} disabled={!pode} style={{ width: "auto" }} /> Novidade no site
            </label>
          </div>
          <h2 style={{ marginTop: 8 }}>Kit</h2>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="kit" defaultChecked={comps.length > 0 || /^kit\b/i.test(fotoCat?.nome ?? "")} disabled={!pode} style={{ width: "auto" }} />
            Este produto é um kit (vende junto, mas o estoque sai de cada produto)
          </label>
          <p className="pequeno suave">Ex.: Kit Selagem = 1 shampoo + 1 condicionador + 1 máscara. O kit não tem estoque próprio: fica disponível enquanto houver os produtos dele, e ao vender sai 1 de cada.</p>
          <div className="kit-linhas">
            {linhasKit.map((c, k) => (
              <div key={k} className="linha">
                <input name={`comp_${k}`} list="lista-componentes" defaultValue={c ? `${c.codigo} — ${c.nome}` : ""} disabled={!pode}
                       placeholder={k === 0 ? "Produto do kit: digite nome ou código" : ""} aria-label={`Produto ${k + 1} do kit`} style={{ flex: 1, minWidth: 0 }} autoComplete="off" />
                <input name={`qtd_${k}`} defaultValue={c ? c.quantidade : 1} inputMode="numeric" disabled={!pode} aria-label={`Quantidade ${k + 1}`} style={{ width: 70 }} />
              </div>
            ))}
          </div>
          {pode && <datalist id="lista-componentes">{opcoes.map((o) => <option key={o.codigo} value={`${o.codigo} — ${o.nome}`} />)}</datalist>}
          <h2 style={{ marginTop: 8 }}>Preços</h2>
          <p className="pequeno suave">O preço novo vale a partir de hoje; o anterior fica no histórico. Gs é arredondado para múltiplos de 500. Deixar em branco não altera.</p>
          <div className="campos" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            {TABELAS.map((t) => (
              <label key={t.chave}>{t.nome}
                <input name={t.chave} defaultValue={fmt(preco(t.chave), t.gs)} inputMode="decimal" disabled={!pode} placeholder={t.gs ? "Ex.: 15000" : "Ex.: 12,50"} />
              </label>
            ))}
          </div>
        </section>

        <div className="coluna">
          <section className="painel">
            <h2>Foto</h2>
            {fotoCat ? <><img src={`/fotos-catalogo/${fotoCat.id}.webp`} alt={fotoCat.nome} style={{ width: "100%", maxWidth: 320, aspectRatio: "1", objectFit: "contain", borderRadius: 12, background: "#fff" }} />
              <p className="pequeno suave" style={{ margin: 0 }}>Foto do catálogo: entra neste produto ao criar.</p></>
            : pode ? <CampoFoto produtoId={novo ? null : id} fotoAtual={p?.foto ?? null} nome={p?.nome ?? "Foto do produto"} />
            : p?.foto ? <img src={p.foto} alt={p.nome} style={{ width: "100%", maxWidth: 320, aspectRatio: "1", objectFit: "cover", borderRadius: 12, background: "#fff" }} />
              : <div className="vazio" style={{ background: "var(--afundado)", borderRadius: 12 }}>Sem foto: no site aparece o rótulo colorido.</div>}
            <p className="pequeno suave">JPG, PNG ou WEBP até 5 MB. {novo ? "A foto entra quando você criar o produto." : "Ao arrastar, colar ou usar o link, a foto já é salva."} Foto quadrada, com fundo branco e o produto centralizado fica melhor no site.</p>
          </section>
          {!novo && (
            <section className="painel">
              <h2>Estoque</h2>
              <ul className="lista-simples">{d!.estoque.map((e) => <li key={e.nome}>{e.nome}: <b>{Number(e.saldo)}</b></li>)}</ul>
              {d!.componentes.length > 0 && <p className="pequeno">Kit: {d!.componentes.map((c) => `${Number(c.quantidade)}× ${c.nome}`).join(" + ")}</p>}
              <a className="pequeno" href="/estoque#kits">Montar kit, entrada e ajuste em Estoque</a>
            </section>
          )}
          {pode && <button className="principal">{novo ? "Criar produto" : "Salvar alterações"}</button>}
        </div>
      </form>

      {!novo && pode && p.foto && (
        <form action={removerFoto}><input type="hidden" name="id" value={id} /><button className="perigo">Remover foto</button></form>
      )}

      {!novo && d!.historico.length > 0 && (
        <section className="painel">
          <h2>Histórico de preços</h2>
          <div className="tabela"><table>
            <thead><tr><th>Desde</th><th>Tabela</th><th>Valor</th><th>Quem</th></tr></thead>
            <tbody>{d!.historico.map((h, i) => (
              <tr key={i}><td className="num">{String(h.vigente_desde)}</td><td>{TABELAS.find((t) => t.chave === h.tabela)?.nome ?? h.tabela}</td>
                <td className="num">{fmt(h.valor, h.tabela.startsWith("py"))}</td><td>{h.quem ?? "—"}</td></tr>))}
            </tbody>
          </table></div>
        </section>
      )}
    </>
  );
}
