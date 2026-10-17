"use client";

import { useEffect, useState } from "react";

/** Barra de ações em lote: conta os marcados, marca/desmarca todos da página e confirma a exclusão. */
export function BarraLote({ form }: { form: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const f = document.getElementById(form) as HTMLFormElement | null;
    const contar = () => setN(document.querySelectorAll<HTMLInputElement>(`input[name="ids"][form="${form}"]:checked`).length);
    document.addEventListener("change", contar);
    const confirmar = (e: SubmitEvent) => {
      const acao = (f?.elements.namedItem("acao") as HTMLSelectElement | null)?.value;
      if (acao === "excluir" && !window.confirm("Excluir os produtos marcados? Os que já têm pedido ou estoque ficam inativos em vez de apagados.")) e.preventDefault();
    };
    f?.addEventListener("submit", confirmar);
    return () => { document.removeEventListener("change", contar); f?.removeEventListener("submit", confirmar); };
  }, [form]);
  return (
    <div className="painel linha lote-barra">
      <b>{n} selecionado(s)</b>
      <select name="acao" form={form} defaultValue="" aria-label="Ação">
        <option value="" disabled>O que fazer…</option>
        <option value="ativar">Ativar</option>
        <option value="inativar">Inativar</option>
        <option value="excluir">Excluir</option>
      </select>
      <button form={form} className="principal" disabled={n === 0}>Aplicar</button>
      <span className="pequeno suave">Inativo não aparece no site nem nos pedidos novos. Excluir só apaga quem nunca teve pedido ou estoque.</span>
    </div>
  );
}

export function MarcarTodos({ form }: { form: string }) {
  return (
    <input type="checkbox" aria-label="Marcar todos desta página"
      onChange={(e) => {
        document.querySelectorAll<HTMLInputElement>(`input[name="ids"][form="${form}"]`).forEach((c) => { c.checked = e.currentTarget.checked; });
        document.dispatchEvent(new Event("change"));
      }} />
  );
}
