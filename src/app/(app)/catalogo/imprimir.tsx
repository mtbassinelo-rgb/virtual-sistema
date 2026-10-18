"use client";

export function BotaoImprimir() {
  return <button type="button" className="principal" onClick={() => window.print()}>Imprimir / salvar em PDF</button>;
}
