import Link from "next/link";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, type Moeda } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";

export const metadata = { title: "Orçamentos" };
const STATUS: Record<string, { t: string; cor: string }> = { aberto: { t: "Aberto", cor: "aviso" }, convertido: { t: "Virou pedido", cor: "ok" }, cancelado: { t: "Cancelado", cor: "" } };

export default async function Orcamentos({ searchParams }: { searchParams: Promise<{ ver?: string; q?: string; ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const ver = ["aberto", "convertido", "cancelado", "todos"].includes(f.ver ?? "") ? f.ver! : "aberto";
  const lista = await comUsuario(u.id, async (c) => (await c.query(`
    select o.*, t.moeda, t.nome tabela_nome, cl.nome cliente_nome, v.nome vendedora,
           (select count(*) from app.orcamento_itens i where i.orcamento_id = o.id)::int itens,
           o.validade < current_date vencido
      from app.orcamentos o join app.tabelas_preco t on t.codigo = o.tabela
      left join app.clientes cl on cl.id = o.cliente_id left join app.vendedoras v on v.id = o.vendedora_id
     where ($1 = 'todos' or o.status = $1)
       and ($2::text is null or coalesce(cl.nome, o.contato_nome) ilike '%' || $2 || '%' or o.contato_whatsapp ilike '%' || $2 || '%' or o.numero::text = $2)
     order by o.criado_em desc limit 300`, [ver, f.q || null])).rows);
  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Orçamentos</h1>
          <p>Monte o orçamento para quem pediu (cliente ou não), mande pelo WhatsApp e, quando fechar, vincule ao cliente e transforme em pedido.</p>
        </div>
        <Link className="botao principal" href="/orcamentos/novo">Novo orçamento</Link>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />
      <div className="linha" style={{ flexWrap: "wrap" }}>
        <nav className="filtros">{[["aberto", "Abertos"], ["convertido", "Viraram pedido"], ["cancelado", "Cancelados"], ["todos", "Todos"]].map(([k, t]) =>
          <Link key={k} href={`/orcamentos?ver=${k}${f.q ? `&q=${encodeURIComponent(f.q)}` : ""}`} className={ver === k ? "ativo" : ""}>{t}</Link>)}</nav>
        <form className="linha" method="get"><input type="hidden" name="ver" value={ver} /><input name="q" defaultValue={f.q ?? ""} placeholder="Nome, WhatsApp ou nº" aria-label="Buscar" /><button>Buscar</button></form>
      </div>
      <section className="painel">
        {lista.length === 0 ? <div className="vazio">Nenhum orçamento aqui.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Nº</th><th>Data</th><th>Para</th><th>Tabela</th><th className="num">Itens</th><th className="num">Total</th><th>Situação</th>{ehGestao(u) && <th>Vendedora</th>}</tr></thead>
            <tbody>{lista.map((o) => {
              const s = STATUS[o.status] ?? { t: o.status, cor: "" };
              return (
                <tr key={o.id}>
                  <td className="num"><Link href={`/orcamentos/${o.id}`}>#{o.numero}</Link></td>
                  <td>{new Date(o.criado_em).toLocaleDateString("pt-BR")}</td>
                  <td><Link href={`/orcamentos/${o.id}`}>{o.cliente_nome ?? o.contato_nome}</Link>{!o.cliente_id && <> <Selo>sem cadastro</Selo></>}
                    {o.contato_whatsapp && <div className="pequeno suave">{o.contato_whatsapp}</div>}</td>
                  <td>{o.tabela_nome}</td>
                  <td className="num">{o.itens}</td>
                  <td className="num">{dinheiro(o.total, o.moeda as Moeda)}</td>
                  <td><Selo cor={s.cor}>{s.t}</Selo>{o.status === "aberto" && o.vencido && <div className="pequeno" style={{ color: "var(--erro)" }}>validade vencida</div>}</td>
                  {ehGestao(u) && <td>{o.vendedora}</td>}
                </tr>);
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
