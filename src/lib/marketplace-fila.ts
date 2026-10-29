import "server-only";
import { EventEmitter } from "node:events";
import { Client, type PoolClient } from "pg";

/**
 * Fila ao vivo dos pedidos de marketplace (área do estoquista).
 * O banco avisa pelo canal 'marketplace_fila' (pg_notify em app.marketplace_receber / marcar_separado).
 * Este processo mantém UMA conexão LISTEN e repassa os avisos para todas as telas abertas (SSE).
 * Funciona com vários processos/servidores: cada um tem a sua conexão LISTEN e todos recebem o mesmo aviso.
 */
export type AvisoFila =
  | { tipo: "pedido"; id: number; evento: "novo" | "atualizado" | "cancelado" | "separado"; situacao: string }
  | { tipo: "reconectou" };

type Estado = { em: EventEmitter; cliente: Client | null; conectando: Promise<void> | null; espera: NodeJS.Timeout | null };
const g = globalThis as unknown as { __vcFilaMk?: Estado };
const estado: Estado = (g.__vcFilaMk ??= { em: new EventEmitter().setMaxListeners(0), cliente: null, conectando: null, espera: null });

function religarDepois(ms: number) {
  if (estado.espera || estado.em.listenerCount("aviso") === 0) return;
  estado.espera = setTimeout(() => {
    estado.espera = null;
    conectar().then(() => estado.em.emit("aviso", { tipo: "reconectou" } satisfies AvisoFila)).catch(() => religarDepois(Math.min(ms * 2, 30_000)));
  }, ms);
}

async function conectar(): Promise<void> {
  if (estado.cliente) return;
  if (estado.conectando) return estado.conectando;
  estado.conectando = (async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    const caiu = (e?: Error) => {
      if (e) console.error("Fila do marketplace (LISTEN):", e.message);
      if (estado.cliente === c) estado.cliente = null;
      c.end().catch(() => undefined);
      religarDepois(1_000);
    };
    c.on("error", caiu);
    c.on("end", () => caiu());
    c.on("notification", (n) => {
      if (n.channel !== "marketplace_fila" || !n.payload) return;
      try {
        const p = JSON.parse(n.payload) as { id: number; evento: string; situacao: string };
        estado.em.emit("aviso", { tipo: "pedido", id: Number(p.id), evento: p.evento, situacao: p.situacao } as AvisoFila);
      } catch { /* aviso malformado: ignora */ }
    });
    await c.connect();
    await c.query("listen marketplace_fila");
    estado.cliente = c;
  })().finally(() => { estado.conectando = null; });
  return estado.conectando;
}

/** Começa a ouvir a fila. Devolve a função que para de ouvir. */
export async function ouvirFila(fn: (a: AvisoFila) => void): Promise<() => void> {
  estado.em.on("aviso", fn);
  try {
    await conectar();
  } catch (e) {
    console.error("Fila do marketplace: sem conexão LISTEN:", (e as Error).message);
    religarDepois(2_000);
  }
  return () => {
    estado.em.off("aviso", fn);
    // ninguém mais ouvindo: fecha a conexão (abre de novo quando a próxima tela abrir)
    if (estado.em.listenerCount("aviso") === 0 && estado.cliente) {
      const c = estado.cliente; estado.cliente = null;
      c.removeAllListeners("end"); c.end().catch(() => undefined);
    }
  };
}

export type CartaoFila = {
  id: number; canal: string; canal_nome: string; numero_externo: string; deposito_id: string | null; deposito: string | null; status_externo: string | null;
  situacao: "aguardando" | "a_separar" | "separado" | "cancelado"; comprador: string | null;
  itens: { sku: string; descricao?: string | null; quantidade: number; valor?: number | null }[];
  total: string | null; enviar_ate: string | null; com_detalhes: boolean; recebido_em: string; cancelado_depois_de_separar: boolean; baixa_feita: boolean;
};

const SELECT = `select f.id, f.canal, c.nome canal_nome, f.numero_externo, f.deposito_id, d.nome deposito, f.status_externo, f.situacao, f.comprador, f.itens,
    f.total, f.enviar_ate, f.com_detalhes, f.recebido_em, f.cancelado_depois_de_separar,
    exists (select 1 from app.pedidos p where p.canal = f.canal and p.numero_externo = f.numero_externo) baixa_feita
  from app.marketplace_fila f join app.canais c on c.codigo = f.canal left join app.depositos d on d.id = f.deposito_id`;

/** Um pedido da fila, já com as regras do banco (RLS): devolve null se este usuário não pode ver. */
export async function cartaoFila(c: PoolClient, id: number): Promise<CartaoFila | null> {
  return ((await c.query(`${SELECT} where f.id = $1`, [id])).rows[0] as CartaoFila | undefined) ?? null;
}

/** Fila aberta: a separar, e cancelados depois de separados (precisam voltar à prateleira). */
export async function filaAberta(c: PoolClient, depositos: string[]): Promise<CartaoFila[]> {
  return (await c.query(`${SELECT}
     where f.deposito_id = any($1::uuid[]) and (f.situacao = 'a_separar' or f.cancelado_depois_de_separar)
     order by f.recebido_em limit 300`, [depositos])).rows as CartaoFila[];
}
