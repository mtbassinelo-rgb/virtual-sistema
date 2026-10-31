import Link from "next/link";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { montarMenu, SEM_CONTADORES } from "@/lib/menu";
import { permissaoDoLink, pode } from "@/lib/permissoes";
import { comUsuario } from "@/lib/db";
import { dinheiro, data, STATUS_COMERCIAL, type Moeda } from "@/lib/formato";
import { Selo } from "../avisos";

export const metadata = { title: "Busca" };

export default async function Busca({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const u = await exigirUsuario();
  const q = ((await searchParams).q ?? "").trim();
  const d = q.length < 2 ? null : await comUsuario(u.id, async (c) => {
    const like = `%${q}%`;
    const produtos = (await c.query(`select id, codigo, nome, marca, foto, ativo from app.produtos
      where nome ilike $1 or codigo ilike $1 or gtin = $2 order by ativo desc, nome limit 12`, [like, q])).rows;
    const clientes = (await c.query(`select c.id, c.nome, c.cidade, v.nome as vendedora from app.clientes c join app.vendedoras v on v.id = c.vendedora_id
      where c.mesclado_em is null and (c.nome ilike $1 or c.whatsapp ilike $1 or c.documento ilike $1) order by c.nome limit 12`, [like])).rows;
    const pedidos = (await c.query(`select id, data_pedido, bling_numero, cliente_nome, moeda, valor_total, status_comercial from app.v_pedidos
      where cliente_nome ilike $1 or bling_numero::text = $2 order by data_pedido desc limit 12`, [like, q])).rows;
    return { produtos, clientes, pedidos };
  });
  // Telas do sistema cujo nome ou explicação contém o que foi digitado (sem acento e sem maiúsculas)
  const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const termos = norm(q).split(/\s+/).filter((t) => t.length >= 2);
  const vistas = new Set<string>();
  const telas = termos.length === 0 ? [] : montarMenu(ehGestao(u), { ...SEM_CONTADORES, confirma_py: true })
    .flatMap((g) => g.itens.map((i) => ({ ...i, grupo: g.titulo })))
    .filter((i) => { const k = permissaoDoLink(i.href); return !k || pode(u, k); })
    .filter((i) => { const t = norm(`${i.texto} ${i.dica ?? ""} ${i.grupo}`); return termos.every((x) => t.includes(x)); })
    .filter((i) => (vistas.has(i.href) ? false : (vistas.add(i.href), true)))
    .slice(0, 12);
  const nada = d && !telas.length && !d.produtos.length && !d.clientes.length && !d.pedidos.length;

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Busca</h1>
          <p>Procure telas do sistema, produtos, clientes e pedidos ao mesmo tempo: pelo nome da tela (ex.: despesas, comissão), nome, código, código de barras, WhatsApp ou número do pedido.</p>
        </div>
      </section>
      <form className="painel linha" method="get">
        <label style={{ flex: 1, minWidth: 220 }}>O que você procura?<input name="q" defaultValue={q} autoFocus placeholder="Ex.: despesas, matizador, Maria Salão, 1520" /></label>
        <button className="principal">Buscar</button>
      </form>
      {!d && <div className="painel vazio">Digite pelo menos 2 letras.</div>}
      {nada && <div className="painel vazio">Nada encontrado para “{q}”. Tente só uma parte do nome.</div>}
      {telas.length > 0 && (
        <section className="painel">
          <h2>Telas do sistema</h2>
          <ul className="crm-lista">{telas.map((t) => (
            <li key={t.href}><Link href={t.href} className="crm-quem">{t.texto}<small>{t.grupo}{t.dica ? ` · ${t.dica}` : ""}</small></Link>
              <Link className="botao mini" href={t.href}>Abrir →</Link></li>))}</ul>
        </section>
      )}
            {d && d.produtos.length > 0 && (
        <section className="painel">
          <div className="linha entre"><h2>Produtos</h2><Link href={`/produtos?q=${encodeURIComponent(q)}&filtro=todos`}>Ver todos</Link></div>
          <div className="tabela"><table><tbody>{d.produtos.map((p) => (
            <tr key={p.id}>
              <td style={{ width: 48 }}>{p.foto ? <img src={p.foto} alt="" width={36} height={36} style={{ objectFit: "cover", borderRadius: 6 }} /> : null}</td>
              <td><Link href={`/produtos/${p.id}`}>{p.nome}</Link><div className="pequeno suave">{p.codigo}{p.marca ? ` · ${p.marca}` : ""}</div></td>
              <td>{!p.ativo && <Selo>inativo</Selo>}</td>
            </tr>))}</tbody></table></div>
        </section>
      )}
      {d && d.clientes.length > 0 && (
        <section className="painel">
          <div className="linha entre"><h2>Clientes</h2><Link href={`/clientes?q=${encodeURIComponent(q)}`}>Ver todos</Link></div>
          <div className="tabela"><table><tbody>{d.clientes.map((c) => (
            <tr key={c.id}><td><Link href={`/clientes/${c.id}`}>{c.nome}</Link></td><td className="suave">{c.cidade ?? ""}</td><td className="suave">{c.vendedora}</td></tr>
          ))}</tbody></table></div>
        </section>
      )}
      {d && d.pedidos.length > 0 && (
        <section className="painel">
          <div className="linha entre"><h2>Pedidos</h2><Link href={`/pedidos?q=${encodeURIComponent(q)}`}>Ver todos</Link></div>
          <div className="tabela"><table><tbody>{d.pedidos.map((p) => (
            <tr key={p.id}>
              <td><Link href={`/pedidos/${p.id}`}>{p.bling_numero ? `Nº ${p.bling_numero}` : "Pedido"}</Link></td>
              <td>{p.cliente_nome}</td><td className="num">{data(p.data_pedido)}</td>
              <td className="num">{dinheiro(p.valor_total, p.moeda as Moeda)}</td>
              <td><Selo>{STATUS_COMERCIAL[p.status_comercial] ?? p.status_comercial}</Selo></td>
            </tr>))}</tbody></table></div>
        </section>
      )}
    </>
  );
}
