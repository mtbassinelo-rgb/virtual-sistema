import "server-only";
import { cookies } from "next/headers";
import { comUsuario } from "./db";
import type { Usuario } from "./auth";

/** Unidade escolhida no topo do sistema (CD Foz, CDE ou todas). Filtra estoque da lista, pedidos e o depósito do pedido novo. */
export const COOKIE_UNIDADE_SISTEMA = "vc_unidade_sistema";
export type UnidadeSistema = { id: string; nome: string; codigo: string };

/** Unidades que a pessoa pode ver: gerente e dono todas; vendedora as que vende; quem opera um depósito, o dele. */
export async function unidadesDoUsuario(u: Usuario): Promise<UnidadeSistema[]> {
  return comUsuario(u.id, async (c) => (await c.query(`
    select d.id, d.nome, d.codigo from app.depositos d
     where d.ativo and (app.perfil_atual() in ('gerente','dono')
        or exists (select 1 from app.vendedora_depositos vd where vd.deposito_id = d.id and vd.vendedora_id = $1)
        or app.pode_operar_deposito(d.id))
     order by d.tipo, d.nome`, [u.vendedora_id])).rows as UnidadeSistema[]);
}

/** A unidade escolhida (ou null = todas). Só vale se a pessoa tiver acesso a ela. */
export async function unidadeSistema(u: Usuario): Promise<{ atual: UnidadeSistema | null; lista: UnidadeSistema[] }> {
  const lista = await unidadesDoUsuario(u);
  const c = (await cookies()).get(COOKIE_UNIDADE_SISTEMA)?.value;
  return { atual: lista.find((x) => x.id === c) ?? null, lista };
}
