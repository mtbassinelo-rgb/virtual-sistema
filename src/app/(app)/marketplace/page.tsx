import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dataHora, dinheiro } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import { marcarMarketplace } from "./acoes";

export const metadata = { title: "Marketplace" };

type Canal = { codigo: string; nome: string; pedidos_mes: number; valor_mes: string; pedidos_7d: number; valor_7d: string; ultimo: string | null; nunca: boolean };
type Anuncio = { id: string; codigo: string; nome: string; ativo: boolean; tipo: string; componentes: string | null; disponivel: string;
  vendidos30: string; por_canal: Record<string, number> | null };

const ORDENS: Record<string, string> = {
  vendidos: "Mais vendidos (30 dias)",
  disponivel: "Menor disponível no CD",
  nome: "Nome (A–Z)",
};

export default async function Marketplace({ searchParams }: {
  searchParams: Promise<{ aba?: string; ok?: string; erro?: string; q?: string; canal?: string; situacao?: string; ordem?: string }>;
}) {
  const u = await exigirUsuario();
  const gestao = ehGestao(u);
  const f = await searchParams;
  const aba = f.aba === "anuncios" ? "anuncios" : "geral";
  const ordem = ORDENS[f.ordem ?? ""] ? f.ordem! : "vendidos";

  const d = await comUsuario(u.id, async (c) => {
    const cd = (await c.query("select id from app.depositos where codigo = 'cd-foz'")).rows[0]?.id ?? null;
    const canais = (await c.query(`
      select k.codigo, k.nome,
             count(p.id) filter (where p.data_pedido >= date_trunc('month', current_date))::int as pedidos_mes,
             coalesce(sum(p.valor_total) filter (where p.data_pedido >= date_trunc('month', current_date)), 0) as valor_mes,
             count(p.id) filter (where p.data_pedido >= current_date - 6)::int as pedidos_7d,
             coalesce(sum(p.valor_total) filter (where p.data_pedido >= current_date - 6), 0) as valor_7d,
             (select max(i.criado_em) from app.marketplace_importacoes i where i.canal = k.codigo) as ultimo,
             not exists (select 1 from app.pedidos x where x.canal = k.codigo) as nunca
        from app.canais k left join app.pedidos p on p.canal = k.codigo and p.status_comercial <> 'cancelado' and p.data_pedido >= current_date - 40
       where k.marketplace group by k.codigo, k.nome
       order by nunca, valor_mes desc`)).rows as Canal[];
    const pendencias = Number((await c.query("select count(*) n from app.estoque_pendencias where resolvida_em is null")).rows[0].n);
    const semSku = Number((await c.query("select count(*) n from app.estoque_pendencias where resolvida_em is null and tipo = 'sku_desconhecido'")).rows[0].n);

    let anuncios: Anuncio[] = [];
    if (aba === "anuncios") {
      const cond = ["p.marketplace"]; const par: unknown[] = [cd];
      if (f.q?.trim()) { par.push(`%${f.q.trim()}%`); cond.push(`(p.nome ilike $${par.length} or p.codigo ilike $${par.length})`); }
      if (f.canal) { par.push(f.canal); cond.push(`exists (select 1 from app.pedido_itens i join app.pedidos pe on pe.id = i.pedido_id
          where i.produto_id = p.id and pe.canal = $${par.length} and pe.data_pedido >= current_date - 90)`); }
      if (f.situacao === "inativos") cond.push("not p.ativo"); else cond.push("p.ativo");
      anuncios = (await c.query(`
        select * from (
          select p.id, p.codigo, p.nome, p.ativo, p.tipo::text,
                 (select string_agg(trim(to_char(k.quantidade, 'FM999990.###')) || '× ' || cp.nome, ' + ' order by cp.nome)
                    from app.kit_componentes k join app.produtos cp on cp.id = k.componente_id where k.kit_id = p.id) as componentes,
                 case when $1::uuid is null then 0 else app.marketplace_disponivel(p.id, $1::uuid) end as disponivel,
                 coalesce((select sum(i.quantidade) from app.pedido_itens i join app.pedidos pe on pe.id = i.pedido_id
                            where i.produto_id = p.id and pe.status_comercial <> 'cancelado' and pe.data_pedido >= current_date - 30), 0) as vendidos30,
                 (select jsonb_object_agg(canal, q) from (select pe.canal, sum(i.quantidade)::int q from app.pedido_itens i join app.pedidos pe on pe.id = i.pedido_id
                            where i.produto_id = p.id and pe.status_comercial <> 'cancelado' and pe.data_pedido >= current_date - 30 group by pe.canal) z) as por_canal
            from app.produtos p where ${cond.join(" and ")}) a
         ${f.situacao === "sem" ? "where disponivel <= 0" : f.situacao === "com" ? "where disponivel > 0" : ""}
         order by ${ordem === "nome" ? "nome" : ordem === "disponivel" ? "disponivel, vendidos30 desc" : "vendidos30 desc, nome"}
         limit 400`, par)).rows as Anuncio[];
    }
    const produtos = gestao && aba === "anuncios"
      ? (await c.query("select codigo, nome from app.produtos where ativo and not marketplace and codigo is not null order by nome")).rows as { codigo: string; nome: string }[] : [];
    return { canais, pendencias, semSku, anuncios, produtos };
  });
  const nomeCanal = Object.fromEntries(d.canais.map((k) => [k.codigo, k.nome]));

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Marketplace</h1>
          <p>Shopee, Mercado Livre e TikTok Shop (Temu e Shein prontos para quando começarmos). Os kits e anúncios daqui não aparecem nas telas de preço
            e de produtos da distribuidora: o estoque sai dos produtos de verdade (componentes) no CD Foz.</p>
        </div>
      </section>
      <nav className="abas" aria-label="Marketplace">
        <Link href="/marketplace" aria-current={aba === "geral" ? "page" : undefined}>Visão geral</Link>
        <Link href="/marketplace?aba=anuncios" aria-current={aba === "anuncios" ? "page" : undefined}>Anúncios e kits</Link>
        <Link href="/estoque/marketplace">Lançar vendas do dia</Link>
        <Link href="/estoque#pendencias">Pendências{d.pendencias > 0 ? ` (${d.pendencias})` : ""}</Link>
      </nav>
      <Avisos ok={f.ok} erro={f.erro} />

      {aba === "geral" && (
        <>
          {d.pendencias > 0 && (
            <div className="aviso-caixa aviso linha entre">
              <span>{d.pendencias} venda(s) de marketplace ainda sem baixa no estoque{d.semSku > 0 ? ` (${d.semSku} com SKU sem cadastro)` : ""}.</span>
              <Link className="botao" href="/estoque#pendencias">Resolver</Link>
            </div>
          )}
          <div className="indicadores">
            {d.canais.map((k) => (
              <div key={k.codigo} className="indicador">
                <span className="rotulo">{k.nome} {k.nunca && <Selo>em breve</Selo>}</span>
                <span className="valor num">{dinheiro(k.valor_mes, "BRL")}</span>
                <span className="pequeno suave">{k.pedidos_mes} pedido(s) no mês · {k.pedidos_7d} em 7 dias ({dinheiro(k.valor_7d, "BRL")})</span>
                {!k.nunca && <span className="pequeno suave">último lançamento: {k.ultimo ? dataHora(k.ultimo) : "—"}</span>}
              </div>
            ))}
          </div>
          <section className="painel">
            <h2>Como funciona</h2>
            <ul className="pequeno" style={{ margin: 0 }}>
              <li>Os pedidos da Shopee e do Mercado Livre chegam ao Bling e são lançados aqui todo dia depois do corte das 14h (<Link href="/estoque/marketplace">Lançar vendas do dia</Link>).</li>
              <li>Cada anúncio (kit) aponta para os produtos reais; a venda baixa os componentes do estoque do CD Foz.</li>
              <li>Em <Link href="/marketplace?aba=anuncios">Anúncios e kits</Link> você vê quantos kits ainda dá para montar com o estoque e o que mais vende em cada canal.</li>
            </ul>
          </section>
        </>
      )}

      {aba === "anuncios" && (
        <>
          <form className="painel filtros" method="get">
            <input type="hidden" name="aba" value="anuncios" />
            <label>Buscar<input name="q" defaultValue={f.q ?? ""} placeholder="Código ou nome do anúncio" /></label>
            <label>Vendeu em (90 dias)<select name="canal" defaultValue={f.canal ?? ""}><option value="">Qualquer canal</option>
              {d.canais.map((k) => <option key={k.codigo} value={k.codigo}>{k.nome}</option>)}</select></label>
            <label>Situação<select name="situacao" defaultValue={f.situacao ?? ""}><option value="">Ativos</option>
              <option value="sem">Sem estoque para montar</option><option value="com">Com estoque</option><option value="inativos">Inativos</option></select></label>
            <label>Ordenar por<select name="ordem" defaultValue={ordem}>{Object.entries(ORDENS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
            <button className="principal">Filtrar</button>
          </form>

          <section className="painel">
            <h2>{d.anuncios.length} anúncio(s)</h2>
            {d.anuncios.length === 0 ? <div className="vazio">Nenhum anúncio com esses filtros.</div> : (
              <div className="tabela"><table>
                <thead><tr><th>Anúncio / kit</th><th>Composição</th><th className="num">Dá para montar (CD)</th><th className="num">Vendidos 30 dias</th>{gestao && <th></th>}</tr></thead>
                <tbody>{d.anuncios.map((a) => (
                  <tr key={a.id}>
                    <td><Link href={`/produtos/${a.id}`}><b>{a.nome}</b></Link><div className="pequeno suave">{a.codigo}</div></td>
                    <td className="pequeno">{a.componentes ?? (a.tipo === "kit" ? <Selo cor="aviso">kit sem componentes</Selo> : "produto avulso")}</td>
                    <td className="num">{Number(a.disponivel) <= 0 ? <Selo cor="erro">0</Selo> : Number(a.disponivel).toLocaleString("pt-BR")}</td>
                    <td className="num">{Number(a.vendidos30).toLocaleString("pt-BR")}
                      {a.por_canal && <div className="pequeno suave">{Object.entries(a.por_canal).map(([k, q]) => `${nomeCanal[k] ?? k}: ${q}`).join(" · ")}</div>}</td>
                    {gestao && <td>
                      <form action={marcarMarketplace}><input type="hidden" name="codigo" value={a.codigo} /><input type="hidden" name="valor" value="0" />
                        <button className="discreto pequeno" title="Volta para as telas de preço e de produtos da distribuidora">Não é de marketplace</button></form>
                    </td>}
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>

          {gestao && (
            <form action={marcarMarketplace} className="painel campos">
              <h2 className="largo" style={{ margin: 0 }}>Mover um produto para o Marketplace</h2>
              <p className="pequeno suave largo" style={{ margin: 0 }}>Para kits ou anúncios que ainda aparecem nas telas de preço da distribuidora. Não muda preço nem estoque.</p>
              <input type="hidden" name="valor" value="1" />
              <label className="largo">Produto<input name="codigo" list="lista-mover" required placeholder="Código ou nome" autoComplete="off" /></label>
              <datalist id="lista-mover">{d.produtos.map((p) => <option key={p.codigo} value={`${p.codigo} · ${p.nome}`} />)}</datalist>
              <button className="principal">Mover para o Marketplace</button>
            </form>
          )}
        </>
      )}
    </>
  );
}
