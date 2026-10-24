"use client";

import { useState } from "react";
import { conferirSeparacao, trocarItem, pedirRemocao } from "../acoes";

export type Sugestao = { codigo: string; nome: string; estoque: number };
export type ItemPedido = {
  id: string; codigo: string | null; descricao: string; quantidade: number; pedida: number;
  preco: string; total: string; origem: string | null; caixas: string; sugestoes: Sugestao[]; remocaoPendente: boolean;
};

/**
 * Itens do pedido numa lista só: a expedição confere a separação na própria linha
 * e a vendedora troca o item (ou a fragrância) com um botão, depois de falar com o cliente.
 */
export function ItensPedido({ pedidoId, itens, total, separar, trocar, produtos }: {
  pedidoId: string; itens: ItemPedido[]; total: string; separar: boolean; trocar: boolean; produtos: string[];
}) {
  const [aberto, setAberto] = useState<string | null>(null);
  const [falta, setFalta] = useState<Record<string, boolean>>({});

  return (
    <div className="itens-ped">
      {separar && (
        <div className="aviso-caixa info pequeno">
          <b>Conferir separação:</b> confira a quantidade de cada item. Faltou? Marque <b>Não tem</b> (sai do pedido e o cliente vê)
          ou peça à vendedora para <b>trocar</b> por outra fragrância.
        </div>
      )}
      {trocar && produtos.length > 0 && (
        <datalist id="lista-substitutos">{produtos.map((x) => <option key={x} value={x} />)}</datalist>
      )}
      <div className="item-ped cabeca" aria-hidden="true">
        <span>Produto</span><span className="num">Qtd</span><span className="num">Preço</span><span className="num">Total</span><span />
      </div>
      {itens.map((i) => (
        <div key={i.id} className={`item-bloco ${falta[i.id] ? "faltou" : ""} ${aberto === i.id ? "aberto" : ""}`}>
          <div className="item-ped">
            <span className="item-nome">
              <b>{i.descricao}</b>
              <span className="pequeno suave">{i.codigo}{i.origem ? ` · sai de ${i.origem}` : ""}</span>
              {i.caixas && <span className="selo info">{i.caixas}</span>}
              {i.remocaoPendente && <span className="selo aviso">tirar do pedido: aguardando autorização</span>}
            </span>
            <span className="num" data-rot="Qtd">{i.quantidade} un
              {i.pedida !== i.quantidade && <small className="suave"> (pedido {i.pedida})</small>}</span>
            <span className="num" data-rot="Preço">{i.preco}</span>
            <span className="num" data-rot="Total"><b>{i.total}</b></span>
            <span className="item-acoes">
              {separar && (
                <>
                  <input name={`sep_${i.id}`} form="form-separar" inputMode="decimal" defaultValue={i.quantidade}
                    aria-label={`Separado de ${i.descricao}`} className="item-qtd" disabled={falta[i.id]} />
                  {falta[i.id] && <input type="hidden" name={`sep_${i.id}`} form="form-separar" value="0" />}
                  <label className={`chip ${falta[i.id] ? "ativo-erro" : ""}`}>
                    <input type="checkbox" name={`falta_${i.id}`} form="form-separar" checked={!!falta[i.id]}
                      onChange={(e) => setFalta({ ...falta, [i.id]: e.target.checked })} /> Não tem
                  </label>
                </>
              )}
              {trocar && (
                <button type="button" className={aberto === i.id ? "principal" : ""} onClick={() => setAberto(aberto === i.id ? null : i.id)}>
                  ⇄ Trocar
                </button>
              )}
            </span>
          </div>
          {trocar && aberto === i.id && <PainelTroca pedidoId={pedidoId} item={i} fechar={() => setAberto(null)} />}
        </div>
      ))}
      <div className="item-ped rodape">
        <span><b>Total do pedido</b></span><span /><span /><span className="num"><b>{total}</b></span><span />
      </div>
      {separar && (
        <form id="form-separar" action={conferirSeparacao} className="linha entre">
          <input type="hidden" name="pedido_id" value={pedidoId} />
          <span className="pequeno suave">Ao conferir, o total é recalculado e a vendedora confirma com o cliente.</span>
          <button className="principal">✓ Separação conferida</button>
        </form>
      )}
    </div>
  );
}

function PainelTroca({ pedidoId, item, fechar }: { pedidoId: string; item: ItemPedido; fechar: () => void }) {
  const [produto, setProduto] = useState("");
  const [tirar, setTirar] = useState(false);
  return (
    <div className="troca-painel">
      <form action={trocarItem} className="troca-form">
        <input type="hidden" name="pedido_id" value={pedidoId} />
        <input type="hidden" name="item_id" value={item.id} />
        {item.sugestoes.length > 0 && (
          <div className="troca-sugestoes">
            <span className="pequeno suave">Outras fragrâncias / variações:</span>
            <div className="linha" style={{ gap: 6 }}>
              {item.sugestoes.map((s) => {
                const v = `${s.codigo} · ${s.nome}`;
                return (
                  <button key={s.codigo} type="button" className={`chip ${produto === v ? "ativo" : ""} ${s.estoque > 0 ? "" : "sem"}`}
                    onClick={() => setProduto(v)} title={s.nome}>
                    {s.nome}<small>{s.estoque > 0 ? `${s.estoque} em estoque` : "sem estoque"}</small>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="troca-campos">
          <label className="troca-produto">Trocar por
            <input name="produto" list="lista-substitutos" required value={produto} onChange={(e) => setProduto(e.target.value)}
              placeholder="Escolha acima ou digite código / nome" autoComplete="off" />
          </label>
          <label>Quantidade<input name="quantidade" inputMode="decimal" defaultValue={item.quantidade} required /></label>
          <label>Observação<input name="observacao" placeholder="opcional" /></label>
          <label>Print da conversa<input type="file" name="print" accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
        </div>
        <div className="linha entre">
          <span className="pequeno suave">O preço é o da tabela do cliente e o total é recalculado.</span>
          <span className="linha" style={{ gap: 8 }}>
            <button type="button" onClick={fechar}>Cancelar</button>
            <button className="principal" disabled={!produto}>Confirmar troca</button>
          </span>
        </div>
      </form>
      {!item.remocaoPendente && (
        tirar ? (
          <form action={pedirRemocao} className="linha troca-tirar">
            <input type="hidden" name="pedido_id" value={pedidoId} />
            <input type="hidden" name="item_id" value={item.id} />
            <input name="motivo" required placeholder="Por que tirar? (ex.: cliente não quis outra fragrância)" style={{ flex: 1, minWidth: 220 }} />
            <button className="perigo">Pedir para tirar do pedido</button>
          </form>
        ) : (
          <button type="button" className="link-botao pequeno" onClick={() => setTirar(true)}>
            O cliente não quer nenhuma troca? Pedir para tirar este item do pedido
          </button>
        )
      )}
    </div>
  );
}
