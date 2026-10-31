import "server-only";
import type { PoolClient } from "pg";

export type LinhaCompra = {
  produto_id: string; codigo: string; nome: string; tipo: string;
  caixa: number | null; custo: number | null; saldo: number; quantidade: number;
};

/** Produtos ativos da marca (unidades e kits), com custo sem frete, estoque somado e a quantidade do pedido. */
export async function linhasCompra(c: PoolClient, marca: string): Promise<LinhaCompra[]> {
  const r = await c.query(`
    select p.id as produto_id, p.codigo, p.nome, p.tipo, p.unidades_caixa_fornecedor as caixa,
           app.custo_produto(p.id) as custo,
           coalesce((select sum(es.quantidade) from app.estoque_saldos es join app.depositos d on d.id = es.deposito_id and d.ativo
                      where es.produto_id = p.id), 0) as saldo,
           coalesce(l.quantidade, 0) as quantidade
      from app.produtos p left join app.compra_lista l on l.produto_id = p.id
     where p.ativo and p.marca = $1
     order by p.nome limit 1000`, [marca]);
  return r.rows.map((x) => ({
    produto_id: x.produto_id, codigo: x.codigo, nome: x.nome, tipo: x.tipo,
    caixa: x.caixa != null ? Number(x.caixa) : null,
    custo: x.custo != null && Number(x.custo) > 0 ? Number(x.custo) : null,
    saldo: Number(x.saldo), quantidade: Number(x.quantidade),
  }));
}
