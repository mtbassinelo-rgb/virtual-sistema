"use client";

import { useState } from "react";

export type LinhaPreco = {
  id: string; codigo: string; nome: string; marca: string | null; foto: string | null; caixa: number | null;
  py_normal: string | null; py_vip: string | null; br_normal: string | null; br_vip: string | null;
};
const TABELAS = [
  { k: "py_normal", t: "PY normal (Gs)" }, { k: "py_vip", t: "PY VIP (Gs)" },
  { k: "br_normal", t: "BR Gold (R$)" }, { k: "br_vip", t: "BR Platinum (R$)" },
] as const;

const mostrar = (v: string | null, gs: boolean) => v == null ? "" : gs ? String(Math.round(Number(v))) : Number(v).toFixed(2).replace(".", ",");

/** Grade editável: só os campos alterados vão para o servidor (os outros ficam desabilitados no envio). */
export function GradePrecos({ linhas, acao, volta }: { linhas: LinhaPreco[]; acao: (fd: FormData) => void; volta: string }) {
  const [mudados, setMudados] = useState<Record<string, boolean>>({});
  const total = Object.values(mudados).filter(Boolean).length;
  const marcar = (nome: string, original: string, valor: string) =>
    setMudados((m) => ({ ...m, [nome]: valor.trim() !== original }));

  return (
    <form action={acao} onSubmit={(e) => {
      // não envia o que não mudou
      for (const el of Array.from(e.currentTarget.elements) as HTMLInputElement[])
        if (el.dataset.original !== undefined && !mudados[el.name]) el.disabled = true;
    }}>
      <input type="hidden" name="volta" value={volta} />
      <div className="tabela precos-grade"><table>
        <thead><tr><th></th><th>Produto</th><th title="Peças por caixa fechada">Caixa</th>{TABELAS.map((t) => <th key={t.k}>{t.t}</th>)}</tr></thead>
        <tbody>{linhas.map((l) => (
          <tr key={l.id}>
            <td style={{ width: 48 }}>{l.foto
              ? <img src={l.foto} alt="" width={36} height={36} style={{ objectFit: "cover", borderRadius: 6, display: "block" }} />
              : <div style={{ width: 36, height: 36, borderRadius: 6, background: "var(--afundado)" }} />}</td>
            <td style={{ minWidth: 220 }}>
              <a href={`/produtos/${l.id}`}>{l.nome}</a>
              <div className="pequeno suave">{l.codigo}{l.marca ? ` · ${l.marca}` : ""}</div>
            </td>
            <td style={{ width: 80 }}>
              {(() => { const n = `caixa:${l.id}`, o = l.caixa ? String(l.caixa) : ""; return (
                <input name={n} data-original={o} defaultValue={o} inputMode="numeric" placeholder="—" aria-label={`Peças por caixa de ${l.nome}`}
                       className={mudados[n] ? "mudou" : ""} onChange={(e) => marcar(n, o, e.target.value)} style={{ width: 64 }} />); })()}
            </td>
            {TABELAS.map((t) => {
              const n = `p:${l.id}:${t.k}`, o = mostrar(l[t.k], t.k.startsWith("py"));
              return (
                <td key={t.k} style={{ width: 120 }}>
                  <input name={n} data-original={o} defaultValue={o} inputMode="decimal" placeholder="—" aria-label={`${t.t} de ${l.nome}`}
                         className={mudados[n] ? "mudou" : ""} onChange={(e) => marcar(n, o, e.target.value)} />
                </td>
              );
            })}
          </tr>))}
        </tbody>
      </table></div>
      <div className="salvar-fixo">
        <button className="principal" disabled={total === 0}>{total ? `Salvar ${total} alteração(ões)` : "Nenhuma alteração"}</button>
        <span className="pequeno suave">Os campos alterados ficam destacados. Preço em Gs é arredondado para múltiplos de 500. O preço novo vale a partir de hoje e o antigo fica no histórico.</span>
      </div>
    </form>
  );
}
