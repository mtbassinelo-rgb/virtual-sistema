import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { Contagem, type ItemInventario } from "./contagem";

export const metadata = { title: "Inventário" };

export default async function Inventario({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const { atual, lista } = await unidadeSistema(u);
  const d = await comUsuario(u.id, async (c) => {
    const podem = (await c.query("select id, nome from app.depositos where ativo and app.pode_operar_deposito(id) order by tipo, nome")).rows as { id: string; nome: string }[];
    const dep = podem.find((x) => x.id === f.u) ?? podem.find((x) => x.id === atual?.id) ?? podem[0];
    if (!dep) return { podem, dep: null, itens: [] as ItemInventario[], listaAberta: null };
    const itens = (await c.query(`select p.id, p.codigo, p.nome, p.marca, p.gtin, p.foto,
        (select string_agg(kp.nome, ' · ' order by kp.nome) from app.kit_componentes k join app.produtos kp on kp.id = k.kit_id
          where k.componente_id = p.id and kp.ativo) as kits, p.unidades_caixa::float as caixa,
        coalesce((select array_agg(pc.codigo) from app.produto_codigos pc where pc.produto_id = p.id), '{}') as codigos,
        coalesce((select quantidade from app.estoque_saldos s where s.deposito_id = $1 and s.produto_id = p.id), 0)::float as saldo
      from app.produtos p where p.tipo <> 'kit' and (p.ativo
        or exists (select 1 from app.estoque_saldos s where s.deposito_id = $1 and s.produto_id = p.id and s.quantidade <> 0)
        -- shampoo, condicionador e máscara que só saem em kit: contam por unidade e o kit se forma sozinho
        or exists (select 1 from app.kit_componentes k join app.produtos kp on kp.id = k.kit_id where k.componente_id = p.id and kp.ativo))
      order by p.marca nulls last, p.nome`, [dep.id])).rows as ItemInventario[];
    const pend = (await c.query(`select lista, count(*)::int n from app.inventario_lista
        where deposito_id = $1 and status = 'aberto' and app.pode_gerir() group by lista order by lista limit 1`, [dep.id])).rows[0] as { lista: string; n: number } | undefined;
    return { podem, dep, itens, listaAberta: pend ?? null };
  });
  void lista;
  if (!d.dep) return <div className="painel">Só gerente, dono ou o responsável pela unidade faz o inventário.</div>;
  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/estoque">Estoque</Link> / Inventário</div>
          <h1>Inventário · {d.dep.nome}</h1>
          <p>Escolha se conta em <b>unidades</b> ou em <b>caixas</b>, e se o que contar vai <b>somar ao estoque</b> (para carregar a loja aos poucos) ou <b>substituir</b> o estoque (para conferir a prateleira). Bipe cada item com o leitor ou digite a quantidade. A contagem fica guardada neste aparelho até salvar.</p>
        </div>
        {d.podem.length > 1 && (
          <nav className="troca-unidade" aria-label="Unidade">
            {d.podem.map((x) => <Link key={x.id} href={`/estoque/inventario?u=${x.id}`} className={x.id === d.dep!.id ? "atual" : ""}>{x.nome}</Link>)}
          </nav>
        )}
      </section>
      {d.listaAberta && (
        <div className="painel linha entre" style={{ flexWrap: "wrap" }}>
          <span><b>Lista {d.listaAberta.lista}</b>: {d.listaAberta.n} item(ns) passados por foto esperando conferência para lançar.</span>
          <Link href={`/estoque/inventario/lista?l=${encodeURIComponent(d.listaAberta.lista)}`} className="botao principal">Conferir e lançar →</Link>
        </div>
      )}
      <Contagem deposito={d.dep.id} itens={d.itens} />
    </>
  );
}
