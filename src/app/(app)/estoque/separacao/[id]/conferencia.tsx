"use client";

import { useState } from "react";
import { confirmarSeparacao } from "../acoes";

export type ItemSep = { id: string; codigo: string | null; descricao: string; quantidade: number; caixa: number | null; dica: string; origem: string | null };

/**
 * Conferência da separação: o estoquista digita quanto separou de cada item (sem poder passar do pedido)
 * ou marca "Não tem", e informa o total de caixas. Só confirma quando tudo estiver preenchido.
 */
export function Conferencia({ pedidoId, itens, acrescimo = false }: { pedidoId: string; itens: ItemSep[]; acrescimo?: boolean }) {
  const [qtd, setQtd] = useState<Record<string, string>>({});
  const [falta, setFalta] = useState<Record<string, boolean>>({});
  const [caixas, setCaixas] = useState("");
  const val = (i: ItemSep) => (falta[i.id] ? 0 : qtd[i.id] === undefined || qtd[i.id].trim() === "" ? null : Number(qtd[i.id].replace(",", ".")));
  const problemas = itens.filter((i) => { const v = val(i); return v === null || !Number.isFinite(v) || v < 0 || v > i.quantidade; });
  const pecas = itens.reduce((s, i) => s + (val(i) ?? 0), 0);
  const faltando = itens.filter((i) => { const v = val(i); return v !== null && v < i.quantidade; });
  const precisaCaixas = pecas > 0;
  const pronto = problemas.length === 0 && (!precisaCaixas || Number(caixas) > 0);

  return (
    <form action={confirmarSeparacao} className="painel">
      <input type="hidden" name="pedido_id" value={pedidoId} />
      <div className="tabela cartoes"><table>
        <thead><tr><th>Produto</th><th className="num">{acrescimo ? "Separar agora" : "Pedido"}</th><th style={{ width: 130 }}>Separei</th><th>Não tem</th></tr></thead>
        <tbody>{itens.map((i) => {
          const v = val(i);
          const erro = v !== null && (!Number.isFinite(v) || v < 0 || v > i.quantidade);
          return (
            <tr key={i.id} style={falta[i.id] ? { background: "var(--erro-suave)" } : v !== null && v === i.quantidade ? { background: "var(--ok-suave)" } : undefined}>
              <td className="titulo"><b>{i.descricao}</b>
                <div className="pequeno suave">{i.codigo}{i.origem ? ` · sai de ${i.origem}` : ""}{i.caixa ? ` · caixa com ${i.caixa}` : ""}</div>
                {i.dica && <span className="selo info">{i.dica}</span>}</td>
              <td className="num" data-rot="Pedido"><b>{i.quantidade}</b> un</td>
              <td data-rot="Separei">
                <input name={`sep_${i.id}`} inputMode="numeric" value={falta[i.id] ? "0" : qtd[i.id] ?? ""} disabled={falta[i.id]}
                  onChange={(e) => setQtd({ ...qtd, [i.id]: e.target.value })} placeholder="quantas?" aria-label={`Separado de ${i.descricao}`}
                  style={erro ? { borderColor: "var(--erro)" } : undefined} />
                {falta[i.id] && <input type="hidden" name={`sep_${i.id}`} value="0" />}
                {erro && <div className="pequeno texto-erro">Máximo {i.quantidade}</div>}
                {!falta[i.id] && v !== null && v < i.quantidade && v >= 0 && <div className="pequeno texto-erro">faltam {i.quantidade - v}</div>}
              </td>
              <td data-rot="Faltou?"><label className={`chip ${falta[i.id] ? "ativo-erro" : ""}`}>
                <input type="checkbox" name={`falta_${i.id}`} checked={!!falta[i.id]} onChange={(e) => setFalta({ ...falta, [i.id]: e.target.checked })} /> Não tem</label></td>
            </tr>);
        })}</tbody>
      </table></div>

      <div className="linha" style={{ gap: 16, alignItems: "flex-end", marginTop: 12 }}>
        <label>{acrescimo ? "Caixas a mais (só deste acréscimo)" : "Total de caixas separadas"}
          <input name="caixas" type="number" min={0} max={10000} value={caixas} onChange={(e) => setCaixas(e.target.value)} required={precisaCaixas} style={{ width: 140 }} />
        </label>
        <div className="pequeno">
          <div><b>{pecas.toLocaleString("pt-BR")}</b> peças separadas de {itens.reduce((s, i) => s + i.quantidade, 0).toLocaleString("pt-BR")}</div>
          {faltando.length > 0 && <div className="texto-erro">{faltando.length} item(ns) com falta: a vendedora é avisada para falar com o cliente</div>}
          {problemas.length > 0 && <div className="suave">Falta conferir {problemas.length} item(ns)</div>}
        </div>
      </div>
      <div className="linha" style={{ marginTop: 12 }}>
        <button className="principal" disabled={!pronto}>{acrescimo ? "✓ Confirmar acréscimo" : "✓ Confirmar separação"}</button>
        <span className="pequeno suave">Você não altera o pedido: só confirma o que separou. Para trocar produto, a vendedora resolve com o cliente.</span>
      </div>
    </form>
  );
}
