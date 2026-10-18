"use client";

import { useActionState } from "react";
import { registrarProcura, type RespostaProcura } from "./acoes";

export type TextosQuero = { botao: string; titulo: string; nome: string; whats: string; qtd: string; enviar: string };

/** Produto esgotado: o cliente (ou visitante) avisa que quer o produto. O gerente recebe para as próximas compras. */
export function QueroProduto({ produtoId, cliente, t }: { produtoId: string; cliente: boolean; t: TextosQuero }) {
  const [r, enviar, enviando] = useActionState<RespostaProcura, FormData>(registrarProcura, {});
  if (r.ok) return <div className="quero-ok" role="status">{r.ok}</div>;
  return (
    <details className="quero-produto">
      <summary>{t.botao}</summary>
      <form action={enviar}>
        <input type="hidden" name="produto_id" value={produtoId} />
        <p className="pequeno">{t.titulo}</p>
        {!cliente && (
          <>
            <label>{t.nome}<input name="nome" required maxLength={120} autoComplete="name" /></label>
            <label>{t.whats}<input name="whatsapp" required inputMode="tel" maxLength={30} autoComplete="tel" /></label>
          </>
        )}
        <label>{t.qtd}<input name="quantidade" type="number" min={1} step={1} /></label>
        {r.erro && <div className="aviso-erro" role="alert">{r.erro}</div>}
        <button className="adicionar" disabled={enviando}>{t.enviar}</button>
      </form>
    </details>
  );
}
