import Link from "next/link";
import type { PoolClient } from "pg";
import { dinheiro, type Moeda } from "@/lib/formato";

/** Etapa de trabalho do pedido (o que falta fazer). v = app.v_pedidos, p = app.pedidos. */
export function etapaSql(v: string, p: string) {
  return `case
    when ${v}.status_comercial = 'aguardando_cliente' then 'cliente'
    when ${v}.status_comercial = 'aguardando_aprovacao' then 'aprovar'
    when ${v}.status_comercial = 'em_separacao' and ${v}.origem <> 'bling' and ${p}.separacao_conferida_em is null then 'separar'
    when ${v}.status_comercial = 'em_separacao' and ${v}.origem <> 'bling' and ${p}.total_confirmado_em is null then 'total'
    when ${v}.status_comercial = 'em_separacao' and ${v}.saldo > 0 then 'cobrar'
    when ${v}.status_comercial = 'em_separacao' then 'enviar'
    when ${v}.status_comercial = 'enviado' then 'transporte'
    when ${v}.status_comercial = 'aguardando_retirada' then 'retirada'
  end`;
}

export const ETAPAS: { id: string; titulo: string; dica: string; cor: string }[] = [
  { id: "cliente", titulo: "Cliente confirmar", dica: "Link enviado, esperando o cliente", cor: "aviso" },
  { id: "aprovar", titulo: "Aprovar", dica: "Pedido feito pelo cliente no site", cor: "aviso" },
  { id: "separar", titulo: "Separar", dica: "Expedição confere as quantidades", cor: "info" },
  { id: "total", titulo: "Confirmar total", dica: "Mandar total e conta ao cliente", cor: "marca" },
  { id: "cobrar", titulo: "Cobrar", dica: "Total enviado, falta pagar", cor: "erro" },
  { id: "enviar", titulo: "Enviar", dica: "Pago: pronto para despachar", cor: "ok" },
  { id: "transporte", titulo: "Em transporte", dica: "A caminho do cliente", cor: "ok" },
  { id: "retirada", titulo: "Aguardando retirada", dica: "Chegou: cliente vai retirar", cor: "ok" },
];
export const ETAPA_POR_ID = Object.fromEntries(ETAPAS.map((e) => [e.id, e]));

type ItemFila = { id: string; etapa: string; cliente: string | null; valor: string; moeda: Moeda; dias: number };

export async function carregarFila(c: PoolClient, deposito?: string | null): Promise<ItemFila[]> {
  return (await c.query(
    `select v.id, ${etapaSql("v", "p")} etapa, v.cliente_nome cliente, v.valor_total valor, v.moeda,
            (current_date - v.data_pedido)::int dias
       from app.v_pedidos v join app.pedidos p on p.id = v.id
      where v.status_comercial::text in ('aguardando_cliente','aguardando_aprovacao','em_separacao','enviado','aguardando_retirada')
        and not exists (select 1 from app.canais k where k.codigo = v.canal and k.marketplace)
        and ($1::uuid is null or v.deposito_id = $1::uuid)
      order by v.data_pedido, v.criado_em limit 500`, [deposito ?? null])).rows as ItemFila[];
}

/** Quadro dos pedidos abertos por etapa: quantos, quem e quanto. Clica e abre a lista filtrada. */
export function FilaPedidos({ itens, titulo = "Pedidos em andamento" }: { itens: ItemFila[]; titulo?: string }) {
  return (
    <section className="painel">
      <div className="linha entre">
        <h2>{titulo}</h2>
        <Link href="/pedidos" className="pequeno">ver todos os pedidos →</Link>
      </div>
      <div className="fila">
        {ETAPAS.map((e) => {
          const l = itens.filter((i) => i.etapa === e.id);
          return (
            <div key={e.id} className={`fila-etapa ${e.cor} ${l.length ? "" : "vazia"}`}>
              <Link href={`/pedidos?etapa=${e.id}`} className="fila-topo">
                <span className="fila-n">{l.length}</span>
                <span><b>{e.titulo}</b><small>{e.dica}</small></span>
              </Link>
              {l.slice(0, 4).map((i) => (
                <Link key={i.id} href={`/pedidos/${i.id}`} className="fila-item">
                  <span>{i.cliente ?? "Sem cliente"}</span>
                  <span className="num pequeno">{dinheiro(i.valor, i.moeda)}{i.dias >= 3 ? ` · ${i.dias}d` : ""}</span>
                </Link>
              ))}
              {l.length > 4 && <Link href={`/pedidos?etapa=${e.id}`} className="fila-mais">+{l.length - 4} pedido(s)</Link>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
