import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { Avisos } from "../../../avisos";
import { solicitarTransferencia } from "../acoes";
import { EscolherUnidades, ListaPedido } from "./lista";

export const metadata = { title: "Pedir mercadoria" };

type Linha = { id: string; codigo: string; nome: string; marca: string | null; caixa: number | null; origem: number; destino: number; vendas30: number; sugerido: number | null };

export default async function NovaSolicitacao({ searchParams }: {
  searchParams: Promise<{ origem?: string; destino?: string; ver?: string; marca?: string; q?: string; pedido?: string; ordem?: string; erro?: string }>;
}) {
  const u = await exigirUsuario();
  const gestao = u.perfil === "dono" || u.perfil === "gerente";
  const f = await searchParams;
  const { atual } = await unidadeSistema(u);
  const d = await comUsuario(u.id, async (c) => {
    const deps = (await c.query("select id, nome, codigo, abastecido_por, app.trabalha_na_unidade(id) trabalha from app.depositos where ativo order by tipo, nome")).rows as
      { id: string; nome: string; codigo: string; abastecido_por: string | null; trabalha: boolean }[];
    // destino: o escolhido, senão a unidade do topo (se trabalha nela), senão a primeira em que trabalha que é abastecida por outra
    const algumaUnidade = deps.some((x) => x.trabalha);
    const destino = deps.find((x) => x.id === f.destino && (x.trabalha || algumaUnidade)) ?? deps.find((x) => x.id === atual?.id && x.trabalha && x.abastecido_por)
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
  let linhas = [...d.linhas];
  if (ver === "falta") linhas = linhas.filter((l) => l.destino <= 0);
  else if (ver === "pouco") linhas = linhas.filter((l) => l.destino <= 0 || (l.vendas30 > 0 && l.destino < l.vendas30 / 2) || (l.caixa != null && l.destino < l.caixa));
  else if (ver === "pedido") linhas = linhas.filter((l) => l.sugerido != null);
  const ordem = f.ordem ?? (gestao ? "vendas" : "nome");
  linhas.sort((a, b) => ordem === "nome" ? a.nome.localeCompare(b.nome, "pt-BR") : ordem === "origem" ? b.origem - a.origem
    : b.vendas30 - a.vendas30 || a.nome.localeCompare(b.nome, "pt-BR"));
  const faltaTotal = d.linhas.filter((l) => l.destino <= 0).length;
  const base = { origem: d.origem.id, destino: d.destino.id, ...(f.pedido ? { pedido: f.pedido } : {}) };
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

      <section className="painel">
        <EscolherUnidades deps={d.deps.map((x) => ({ id: x.id, nome: x.nome }))} origem={d.origem.id} destino={d.destino.id}
          extra={{ ver, ordem, ...(d.pedido ? { pedido: d.pedido.id } : {}) }} />
        <nav className="filtros">
          <Link href={href({ ver: "falta" })} className={ver === "falta" ? "ativo" : ""}>Falta em {d.destino.nome} ({faltaTotal})</Link>
          <Link href={href({ ver: "pouco" })} className={ver === "pouco" ? "ativo" : ""}>Acabando em {d.destino.nome}</Link>
          <Link href={href({ ver: "todos" })} className={ver === "todos" ? "ativo" : ""}>Tudo que tem em {d.origem.nome}</Link>
          {d.pedido && <Link href={href({ ver: "pedido" })} className={ver === "pedido" ? "ativo" : ""}>Itens do pedido</Link>}
          <span className="suave pequeno" style={{ alignSelf: "center", marginLeft: 8 }}>Ordenar:</span>
          {(gestao ? [["vendas", "Mais vendidos"], ["origem", "Mais estoque lá"], ["nome", "Nome"]] : [["origem", "Mais estoque lá"], ["nome", "Nome"]]).map(([k, t]) => <Link key={k} href={href({ ordem: k })} className={ordem === k ? "ativo" : ""}>{t}</Link>)}
        </nav>
      </section>

      <form action={solicitarTransferencia} className="painel">
        <input type="hidden" name="origem" value={d.origem.id} /><input type="hidden" name="destino" value={d.destino.id} />
        <input type="hidden" name="volta" value={volta} />
        {d.pedido && <input type="hidden" name="pedido" value={d.pedido.id} />}
        <ListaPedido key={`${d.origem.id}-${d.destino.id}-${ver}-${ordem}`} linhas={gestao ? linhas : linhas.map((l) => ({ ...l, vendas30: 0 }))} marcas={d.marcas} origemNome={d.origem.nome} destinoNome={d.destino.nome} />
        <label>Observação (cliente, urgência…)<input name="obs" maxLength={500} placeholder={d.pedido ? `Repor pedido de ${d.pedido.cliente ?? ""}` : "Ex.: para cliente Ana, precisa até sexta"} /></label>
        <span className="pequeno suave">Os botões somam uma caixa por vez; dá para digitar a quantidade em unidades. Kits: peça os componentes.</span>
      </form>
    </>
  );
}
