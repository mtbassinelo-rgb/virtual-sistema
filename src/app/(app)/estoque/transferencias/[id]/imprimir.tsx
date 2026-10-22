"use client";

/** Imprime a lista (para o estoquista separar com o papel na mão). */
export function Imprimir() {
  return <button type="button" className="botao nao-imprimir" onClick={() => window.print()}>Imprimir lista</button>;
}
