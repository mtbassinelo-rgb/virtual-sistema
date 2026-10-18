import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { pool } from "./db";
import { sha256, tokenCliente } from "./portal";

/** Unidade de venda: CD Foz (site principal) ou Loja CDE (site próprio). Os produtos são os mesmos; muda o estoque. */
export type Unidade = {
  id: string; codigo: string; nome: string; loja_nome: string; loja_idioma: "pt" | "es"; vende_unidade: boolean; pais: "BR" | "PY";
};
export const COOKIE_UNIDADE = "vc_unidade";
export const UNIDADE_PRINCIPAL = "cd-foz";

export const unidades = cache(async (): Promise<Unidade[]> =>
  (await pool.query("select * from app.unidades_loja()")).rows as Unidade[]);

/**
 * Unidade do site para quem está navegando: o cliente logado fica sempre na unidade dele (o site de CDE não se
 * mistura com o principal); o visitante fica na unidade pela qual entrou (endereço /cde guarda no cookie).
 */
export const unidadeLoja = cache(async (): Promise<Unidade> => {
  const lista = await unidades();
  const principal = lista.find((u) => u.codigo === UNIDADE_PRINCIPAL) ?? lista[0];
  const token = await tokenCliente();
  if (token) {
    const id = (await pool.query("select app.portal_unidade($1) as id", [sha256(token)])).rows[0]?.id as string | null;
    const u = lista.find((x) => x.id === id);
    if (u) return u;
  }
  const c = (await cookies()).get(COOKIE_UNIDADE)?.value;
  return lista.find((u) => u.codigo === c) ?? principal;
});

export const ehPrincipal = (u: Unidade) => u.codigo === UNIDADE_PRINCIPAL;
