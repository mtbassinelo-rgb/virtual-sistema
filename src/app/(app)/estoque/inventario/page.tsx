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
    if (!dep) return { podem, dep: null, itens: [] as ItemInventario[] };
    const itens = (await c.query(`select p.id, p.codigo, p.nome, p.marca, p.gtin,
        coalesce((select quantidade from app.estoque_saldos s where s.deposito_id = $1 and s.produto_id = p.id), 0)::float as saldo
      from app.produtos p where p.tipo <> 'kit' and (p.ativo or exists (select 1 from app.estoque_saldos s where s.deposito_id = $1 and s.produto_id = p.id and s.quantidade <> 0))
      order by p.marca nulls last, p.nome`, [dep.id])).rows as ItemInventario[];
    return { podem, dep, itens };
  });
  void lista;
  if (!d.dep) return <div className="painel">Só gerente, dono ou o responsável pela unidade faz o inventário.</div>;
  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/estoque">Estoque</Link> / Inventário</div>
          <h1>Inventário · {d.dep.nome}</h1>
          <p>Conte as peças da prateleira: bipe cada uma com o leitor ou digite a quantidade. A contagem fica guardada neste celular ou computador até você salvar. Ao salvar, o estoque da unidade fica igual ao contado.</p>
        </div>
        {d.podem.length > 1 && (
          <nav className="troca-unidade" aria-label="Unidade">
            {d.podem.map((x) => <Link key={x.id} href={`/estoque/inventario?u=${x.id}`} className={x.id === d.dep!.id ? "atual" : ""}>{x.nome}</Link>)}
          </nav>
        )}
      </section>
      <Contagem deposito={d.dep.id} itens={d.itens} />
    </>
  );
}
