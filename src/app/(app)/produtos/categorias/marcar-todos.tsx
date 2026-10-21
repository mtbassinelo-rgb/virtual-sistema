"use client";

/** Marca ou desmarca todos os produtos da lista. */
export function MarcarTodos() {
  return (
    <input type="checkbox" aria-label="Marcar todos da lista"
      onChange={(e) => {
        const tabela = e.currentTarget.closest("table");
        tabela?.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"][name="id"]').forEach((c) => { c.checked = e.currentTarget.checked; });
      }} />
  );
}
