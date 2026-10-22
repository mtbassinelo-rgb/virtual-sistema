import Link from "next/link";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { Avisos } from "../../avisos";
import { preencherPrecosCde, salvarPrecosCde } from "./acoes";

export const metadata = { title: "Preços da loja CDE" };
const gs = (v: unknown) => v == null ? "—" : `Gs ${Math.round(Number(v)).toLocaleString("es-PY")}`;

export default async function PrecosCde({ searchParams }: { searchParams: Promise<{ marca?: string; q?: string; ver?: string; ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono define os preços de CDE.</div>;
  const f = await searchParams;
  const ver = f.ver === "sem" || f.ver === "com" ? f.ver : "todos";
  const d = await comUsuario(u.id, async (c) => {
    const cambio = Number((await c.query("select app.param('cambio_custo_gs') v")).rows[0]?.v) || 1300;
    const ultimo = (t: string) => `(select valor from app.precos z where z.produto_id = p.id and z.tabela = '${t}' and z.vigente_desde <= current_date order by vigente_desde desc limit 1)`;
    const linhas = (await c.query(`select p.id, p.codigo, p.nome, p.marca, app.custo_produto(p.id) custo,
        ${ultimo("py_normal")} py_normal, ${ultimo("py_vip")} py_vip, ${ultimo("cde_normal")} cde_normal, ${ultimo("cde_vip")} cde_vip,
        coalesce((select quantidade from app.estoque_saldos s join app.depositos dd on dd.id = s.deposito_id where dd.codigo = 'loja-cde' and s.produto_id = p.id), 0)::float estoque_cde
      from app.produtos p where p.ativo and p.codigo is not null
        and ($1::text is null or p.marca = $1) and ($2::text is null or p.nome ilike '%' || $2 || '%' or p.codigo ilike $2 || '%')
      order by p.marca nulls last, p.nome limit 600`, [f.marca || null, f.q || null])).rows;
    const marcas = (await c.query("select distinct marca from app.produtos where ativo and marca is not null order by marca")).rows.map((r) => r.marca as string);
    return { cambio, linhas, marcas };
  });
  const lista = d.linhas.filter((l) => ver === "sem" ? l.cde_normal == null : ver === "com" ? l.cde_normal != null : true);
  const params = new URLSearchParams({ ...(f.marca ? { marca: f.marca } : {}), ...(f.q ? { q: f.q } : {}), ver });
  const volta = `/produtos/precos-cde?${params}`;
  const margem = (preco: unknown, custo: unknown) => preco == null || custo == null || Number(preco) <= 0 ? null : 1 - (Number(custo) * d.cambio) / Number(preco);
  const semCde = d.linhas.filter((l) => l.cde_normal == null).length;

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/produtos">Produtos</Link> / Preços da loja CDE</div>
          <h1>Preços da loja CDE</h1>
          <p>Clientes de CDE pagam estes preços. Produto sem preço de CDE usa o preço do Paraguai (nunca fica sem preço). O custo é o mesmo das duas unidades.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <form className="painel linha" method="get" style={{ flexWrap: "wrap", alignItems: "end" }}>
        <input type="hidden" name="ver" value={ver} />
        <label>Marca<select name="marca" defaultValue={f.marca ?? ""}><option value="">Todas</option>{d.marcas.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Buscar<input name="q" defaultValue={f.q ?? ""} placeholder="nome ou código" /></label>
        <button>Filtrar</button>
        <nav className="filtros">
          {[["todos", "Todos"], ["sem", `Sem preço de CDE (${semCde})`], ["com", "Com preço de CDE"]].map(([k, t]) => (
            <Link key={k} href={`/produtos/precos-cde?${new URLSearchParams({ ...(f.marca ? { marca: f.marca } : {}), ...(f.q ? { q: f.q } : {}), ver: k })}`} className={ver === k ? "ativo" : ""}>{t}</Link>))}
        </nav>
      </form>

      <form action={preencherPrecosCde} className="painel linha" style={{ flexWrap: "wrap", alignItems: "end" }}>
        <input type="hidden" name="volta" value={volta} /><input type="hidden" name="ids" value={lista.map((l) => l.id).join(",")} />
        <b>Preencher em massa ({lista.length} produtos do filtro):</b>
        <label>CDE = Paraguai +<input name="pct" inputMode="decimal" defaultValue="10" style={{ width: 70 }} /> %</label>
        <label className="linha" style={{ gap: 6 }}><input type="checkbox" name="sobrescrever" value="1" style={{ width: "auto" }} /> trocar também os que já têm preço de CDE</label>
        <button className="principal">Preencher</button>
        <span className="pequeno suave">Arredonda como os preços em Gs. Vale para Normal e VIP.</span>
      </form>

      <form action={salvarPrecosCde} className="painel">
        <input type="hidden" name="volta" value={volta} />
        <div className="tabela"><table>
          <thead><tr><th>Produto</th><th className="num">Estoque CDE</th><th className="num">Paraguai Normal</th><th className="num">Paraguai VIP</th><th>CDE Normal</th><th>CDE VIP</th><th className="num">Margem CDE</th></tr></thead>
          <tbody>{lista.map((l) => {
            const mg = margem(l.cde_normal ?? l.py_normal, l.custo);
            return (
              <tr key={l.id}>
                <td>{l.nome}<div className="pequeno suave">{l.codigo}{l.marca ? ` · ${l.marca}` : ""}</div></td>
                <td className="num">{l.estoque_cde ? l.estoque_cde.toLocaleString("pt-BR") : "—"}</td>
                <td className="num">{gs(l.py_normal)}</td><td className="num">{gs(l.py_vip)}</td>
                <td><input type="hidden" name={`an:${l.codigo}`} value={l.cde_normal ?? ""} />
                  <input name={`n:${l.codigo}`} inputMode="numeric" defaultValue={l.cde_normal != null ? String(Math.round(Number(l.cde_normal))) : ""} placeholder={l.py_normal != null ? String(Math.round(Number(l.py_normal))) : ""} style={{ width: 100 }} aria-label={`CDE Normal de ${l.nome}`} /></td>
                <td><input type="hidden" name={`av:${l.codigo}`} value={l.cde_vip ?? ""} />
                  <input name={`v:${l.codigo}`} inputMode="numeric" defaultValue={l.cde_vip != null ? String(Math.round(Number(l.cde_vip))) : ""} placeholder={l.py_vip != null ? String(Math.round(Number(l.py_vip))) : ""} style={{ width: 100 }} aria-label={`CDE VIP de ${l.nome}`} /></td>
                <td className="num" style={mg != null && mg < 0.2 ? { color: "var(--erro)" } : undefined}>{mg == null ? "—" : `${Math.round(mg * 100)}%`}</td>
              </tr>);
          })}</tbody>
        </table></div>
        {d.linhas.length >= 600 && <p className="pequeno suave">Mostrando 600: use os filtros.</p>}
        <button className="principal" style={{ marginTop: 10 }}>Salvar preços de CDE</button>
      </form>
    </>
  );
}
