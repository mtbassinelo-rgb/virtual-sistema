import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { Avisos } from "../../../avisos";
import { solicitarTransferencia } from "../acoes";

export const metadata = { title: "Pedir mercadoria" };

type Linha = { id: string; codigo: string; nome: string; marca: string | null; caixa: number | null; origem: number; destino: number; vendas30: number; sugerido: number | null };

export default async function NovaSolicitacao({ searchParams }: {
  searchParams: Promise<{ origem?: string; destino?: string; ver?: string; marca?: string; q?: string; pedido?: string; ordem?: string; erro?: string }>;
}) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const { atual } = await unidadeSistema(u);
  const d = await comUsuario(u.id, async (c) => {
    const deps = (await c.query("select id, nome, codigo, abastecido_por, app.trabalha_na_unidade(id) trabalha from app.depositos where ativo order by tipo, nome")).rows as
      { id: string; nome: string; codigo: string; abastecido_por: string | null; trabalha: boolean }[];
    // destino: o escolhido, senão a unidade do topo (se trabalha nela), senão a primeira em que trabalha que é abastecida por outra
    const destino = deps.find((x) => x.id === f.destino && x.trabalha) ?? deps.find((x) => x.id === atual?.id && x.trabalha && x.abastecido_por)
      ?? deps.find((x) => x.trabalha && x.abastecido_por) ?? deps.find((x) => x.trabalha) ?? null;
    if (!destino) return { deps, destino: null, origem: null, linhas: [] as Linha[], marcas: [] as string[], pedido: null };
    const origem = deps.find((x) => x.id === f.origem && x.id !== destino.id) ?? deps.find((x) => x.id === destino.abastecido_por) ?? deps.find((x) => x.id !== destino.id) ?? null;
    if (!origem) return { deps, destino, origem: null, linhas: [] as Linha[], marcas: [] as string[], pedido: null };
    // pedido cancelado (ou qualquer pedido) a repor: itens com quantidade sugerida (kits viram componentes)
    const pedido = f.pedido && /^[0-9a-f-]{36}$/i.test(f.pedido) ? (await c.query(`select p.id, p.bling_numero, p.status_comercial, cl.nome cliente from app.pedidos p
        left join app.clientes cl on cl.id = p.cliente_id where p.id = $1`, [f.pedido])).rows[0] ?? null : null;
    const sug = new Map<string, number>();
    if (pedido) {
      const its = (await c.query(`select coalesce(k.componente_id, i.produto_id) produto_id, sum(i.quantidade * coalesce(k.quantidade, 1)) q
          from app.pedido_itens i left join app.kit_componentes k on k.kit_id = i.produto_id
         where i.pedido_id = $1 and i.produto_id is not null group by 1`, [pedido.id])).rows;
      for (const r of its) sug.set(r.produto_id, Number(r.q));
    }
    const linhas = (await c.query(`
      select p.id, p.codigo, p.nome, p.marca, p.unidades_caixa_fornecedor caixa,
             coalesce(so.quantidade, 0)::float origem, coalesce(sd.quantidade, 0)::float destino,
             coalesce((select sum(i.quantidade) from app.pedido_itens i join app.pedidos pe on pe.id = i.pedido_id
                        where i.produto_id = p.id and pe.deposito_id = $2 and app.conta_como_venda(pe.status_comercial)
                          and pe.data_pedido >= current_date - 30), 0)::float vendas30
        from app.produtos p
        left join app.estoque_saldos so on so.produto_id = p.id and so.deposito_id = $1
        left join app.estoque_saldos sd on sd.produto_id = p.id and sd.deposito_id = $2
       where p.ativo and p.tipo is distinct from 'kit'
         and (coalesce(so.quantidade, 0) > 0 or p.id = any($3::uuid[]))`, [origem.id, destino.id, [...sug.keys()]])).rows
      .map((r) => ({ ...r, sugerido: sug.get(r.id) ?? null })) as Linha[];
    const marcas = [...new Set(linhas.map((l) => l.marca).filter((m): m is string => Boolean(m)))].sort();
    return { deps, destino, origem, linhas, marcas, pedido };
  });

  if (!d.destino) return <div className="painel">Você não está ligada a nenhuma unidade. Peça ao gerente para marcar em Equipe.</div>;
  if (!d.origem) return <div className="painel">Não há outra unidade para pedir mercadoria.</div>;
  const ver = f.ver ?? (d.pedido ? "pedido" : "falta");
  const termo = (f.q ?? "").toLowerCase();
  let linhas = d.linhas.filter((l) => (!f.marca || l.marca === f.marca) && (!termo || `${l.nome} ${l.codigo}`.toLowerCase().includes(termo)));
  if (ver === "falta") linhas = linhas.filter((l) => l.destino <= 0);
  else if (ver === "pouco") linhas = linhas.filter((l) => l.destino <= 0 || (l.vendas30 > 0 && l.destino < l.vendas30 / 2) || (l.caixa != null && l.destino < l.caixa));
  else if (ver === "pedido") linhas = linhas.filter((l) => l.sugerido != null);
  const ordem = f.ordem ?? "vendas";
  linhas.sort((a, b) => ordem === "nome" ? a.nome.localeCompare(b.nome, "pt-BR") : ordem === "origem" ? b.origem - a.origem
    : b.vendas30 - a.vendas30 || a.nome.localeCompare(b.nome, "pt-BR"));
  const faltaTotal = d.linhas.filter((l) => l.destino <= 0).length;
  const base = { origem: d.origem.id, destino: d.destino.id, ...(f.pedido ? { pedido: f.pedido } : {}), ...(f.marca ? { marca: f.marca } : {}), ...(f.q ? { q: f.q } : {}) };
  const href = (o: Record<string, string>) => "/estoque/transferencias/nova?" + new URLSearchParams({ ...base, ver, ordem, ...o });
  const volta = href({});

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/estoque/transferencias">Pedidos entre unidades</Link> / Pedir mercadoria</div>
          <h1>Pedir mercadoria para {d.destino.nome}</h1>
          <p>Escolha o que precisa do estoque de <b>{d.origem.nome}</b>. O estoquista de lá separa, o gerente aprova e a mercadoria chega em poucos dias.</p>
        </div>
      </section>
      <Avisos erro={f.erro} />
      {d.pedido && <div className="aviso-caixa">Repondo os itens do pedido {d.pedido.bling_numero ? `nº ${d.pedido.bling_numero}` : ""} de {d.pedido.cliente ?? "cliente"} ({d.pedido.status_comercial}). Ajuste as quantidades e acrescente o que mais precisar.</div>}

      <form className="painel linha" method="get" style={{ flexWrap: "wrap", alignItems: "end" }}>
        {d.pedido && <input type="hidden" name="pedido" value={d.pedido.id} />}
        <input type="hidden" name="ver" value={ver} /><input type="hidden" name="ordem" value={ordem} />
        <label>Pedir de<select name="origem" defaultValue={d.origem.id}>{d.deps.filter((x) => x.id !== d.destino!.id).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
        <label>Para<select name="destino" defaultValue={d.destino.id}>{d.deps.filter((x) => x.trabalha).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
        <label>Marca<select name="marca" defaultValue={f.marca ?? ""}><option value="">Todas</option>{d.marcas.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Buscar<input name="q" defaultValue={f.q ?? ""} placeholder="nome ou código" /></label>
        <button>Filtrar</button>
      </form>

      <nav className="filtros">
        <Link href={href({ ver: "falta" })} className={ver === "falta" ? "ativo" : ""}>Tem em {d.origem.nome} e não tem em {d.destino.nome} ({faltaTotal})</Link>
        <Link href={href({ ver: "pouco" })} className={ver === "pouco" ? "ativo" : ""}>Acabando em {d.destino.nome}</Link>
        <Link href={href({ ver: "todos" })} className={ver === "todos" ? "ativo" : ""}>Tudo que tem em {d.origem.nome}</Link>
        {d.pedido && <Link href={href({ ver: "pedido" })} className={ver === "pedido" ? "ativo" : ""}>Itens do pedido</Link>}
        <span className="suave pequeno" style={{ alignSelf: "center" }}>Ordenar:</span>
        {[["vendas", "Mais vendidos"], ["origem", "Mais estoque lá"], ["nome", "Nome"]].map(([k, t]) => <Link key={k} href={href({ ordem: k })} className={ordem === k ? "ativo" : ""}>{t}</Link>)}
      </nav>

      <form action={solicitarTransferencia} className="painel">
        <input type="hidden" name="origem" value={d.origem.id} /><input type="hidden" name="destino" value={d.destino.id} />
        <input type="hidden" name="volta" value={volta} />
        {d.pedido && <input type="hidden" name="pedido" value={d.pedido.id} />}
        {linhas.length === 0 ? <div className="vazio">Nenhum produto com esses filtros.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Produto</th><th>Marca</th><th className="num">Em {d.origem.nome}</th><th className="num">Em {d.destino.nome}</th><th className="num">Vendido 30 dias ({d.destino.nome})</th><th>Pedir</th></tr></thead>
            <tbody>{linhas.slice(0, 400).map((l) => (
              <tr key={l.id}>
                <td>{l.nome}<div className="pequeno suave">{l.codigo}{l.caixa ? ` · caixa com ${l.caixa}` : ""}</div></td>
                <td>{l.marca}</td>
                <td className="num">{l.origem.toLocaleString("pt-BR")}</td>
                <td className="num" style={l.destino <= 0 ? { color: "var(--erro)", fontWeight: 700 } : undefined}>{l.destino.toLocaleString("pt-BR")}</td>
                <td className="num">{l.vendas30 ? l.vendas30.toLocaleString("pt-BR") : "—"}</td>
                <td><input name={`q:${l.id}`} inputMode="decimal" style={{ width: 90 }} defaultValue={l.sugerido != null ? String(Math.min(l.sugerido, Math.max(l.origem, 0)) || l.sugerido) : ""}
                  placeholder={l.caixa ? String(l.caixa) : ""} aria-label={`Quantidade de ${l.nome}`} /></td>
              </tr>))}</tbody>
          </table></div>
        )}
        {linhas.length > 400 && <p className="pequeno suave">Mostrando 400 de {linhas.length}: use os filtros.</p>}
        <label style={{ marginTop: 10 }}>Observação (cliente, urgência…)<input name="obs" maxLength={500} placeholder={d.pedido ? `Repor pedido de ${d.pedido.cliente ?? ""}` : "Ex.: para cliente Ana, precisa até sexta"} /></label>
        <div className="linha" style={{ marginTop: 10 }}><button className="principal">Enviar pedido para {d.origem.nome}</button>
          <span className="pequeno suave">Só vão os produtos com quantidade preenchida. Kits: peça os componentes.</span></div>
      </form>
    </>
  );
}
