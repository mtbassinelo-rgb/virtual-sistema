"use client";

import { useState } from "react";
import { BuscaLista } from "../../busca-lista";

type Opcao = { v: string; t: string; d?: string };

/** Linhas de produtos do pedido: começa com 10 e o botão acrescenta mais (sem limite prático). */
export function LinhasItens({ opcoes, inicial = 10 }: { opcoes: Opcao[]; inicial?: number }) {
  const [n, setN] = useState(inicial);
  return (
    <>
      <table style={{ minWidth: 420 }} data-sem-filtro>
        <thead><tr><th style={{ width: 36 }}>#</th><th>Produto</th><th style={{ width: 110 }}>Caixas</th><th style={{ width: 110 }}>ou peças</th></tr></thead>
        <tbody>
          {Array.from({ length: n }, (_, i) => (
            <tr key={i}>
              <td className="num suave">{i + 1}</td>
              <td>
                <BuscaLista name={`produto_${i}`} opcoes={opcoes} ariaLabel={`Produto ${i + 1}`} placeholder="Digite nome ou código (ex.: sha%uva)" />
              </td>
              <td><input name={`cx_${i}`} inputMode="numeric" aria-label={`Caixas ${i + 1}`} /></td>
              <td><input name={`qtd_${i}`} inputMode="decimal" aria-label={`Peças ${i + 1}`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="linha" style={{ marginTop: 8, gap: 8 }}>
        <button type="button" onClick={() => setN((x) => Math.min(x + 1, 300))}>+ Adicionar produto</button>
        <button type="button" className="discreto" onClick={() => setN((x) => Math.min(x + 10, 300))}>+ 10 linhas</button>
        <span className="pequeno suave">{n} linhas · linhas vazias são ignoradas</span>
      </div>
    </>
  );
}
