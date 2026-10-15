import { Pool, types, type PoolClient } from "pg";

// Datas puras (date) chegam como texto "AAAA-MM-DD", sem fuso horário.
types.setTypeParser(1082, (v: string) => v);

// A aplicação conecta com o papel vc_app: todas as regras do banco (RLS) valem.
const global_ = globalThis as unknown as { __vcPool?: Pool };

export const pool: Pool =
  global_.__vcPool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000 });
if (process.env.NODE_ENV !== "production") global_.__vcPool = pool;

/**
 * Executa as consultas em uma transação identificada pelo usuário logado.
 * O banco usa esse id para aplicar permissões e registrar a auditoria.
 */
export async function comUsuario<T>(usuarioId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.usuario_id', $1, true)", [usuarioId]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Mensagem legível de um erro do banco (as regras já falam português). */
export function mensagemErro(e: unknown): string {
  const err = e as { message?: string; code?: string; constraint?: string };
  const msg = err?.message ?? "Erro inesperado.";
  if (msg.includes("row-level security")) return "Você não tem permissão para esta operação.";
  if (err?.code === "23505") return "Já existe um registro com esses dados.";
  if (err?.constraint === "uma_meta_por_periodo") return "Este cliente já tem uma meta nesse período.";
  if (err?.constraint === "premio_menor_que_meta") return "O prêmio precisa ser menor que a meta.";
  if (err?.constraint === "credito_tem_vencimento") return "Crédito concedido precisa de vencimento.";
  if (err?.code === "23514") return "Algum valor não respeita as regras do sistema.";
  return msg;
}
