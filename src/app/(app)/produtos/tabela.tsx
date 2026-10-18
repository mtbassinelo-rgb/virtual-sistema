"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MarcarTodos } from "./lote";
import { alternarAtivo } from "./acoes";

/** A = ativo no site (clique para desativar) · D = desativado (clique para ativar). */
function BotaoAtivo({ id, ativo, nome }: { id: string; ativo: boolean; nome: string }) {
  const router = useRouter();
  const [estado, setEstado] = useState(ativo);
  const [ocupado, iniciar] = useTransition();
  return (
    <button type="button" className={`botao-ad ${estado ? "ativo" : "inativo"}`} disabled={ocupado}
      title={estado ? `Ativo no site. Clique para desativar ${nome}` : `Desativado. Clique para ativar ${nome} no site`}
      aria-label={estado ? `Desativar ${nome}` : `Ativar ${nome}`}
      onClick={() => iniciar(async () => {
        const r = await alternarAtivo(id, !estado);
        if (r.erro) { alert(r.erro); return; }
        setEstado(!estado); router.refresh();
      })}>
      {ocupado ? "…" : estado ? "A" : "D"}
    </button>
  );
}

export type LinhaProduto = {
  id: string; codigo: string; nome: string; marca: string | null; foto: string | null; tipo: string; ativo: boolean;
  codigo_provisorio: boolean; unidades_caixa: number | null; estoque_minimo: number | null; saldo: string | number;
  py_normal: string | null; py_vip: string | null; br_normal: string | null; br_vip: string | null;
};

const TABELAS = [
  { k: "py_normal", t: "PY Normal", gs: true }, { k: "py_vip", t: "PY VIP", gs: true },
  { k: "br_normal", t: "BR Gold", gs: false }, { k: "br_vip", t: "BR Platinum", gs: false },
] as const;

const editavel = (v: string | null, gs: boolean) => v == null ? "" : gs ? String(Math.round(Number(v))) : Number(v).toFixed(2).replace(".", ",");
const exibir = (v: string | null, gs: boolean) => v == null ? "—" : gs ? `Gs ${Math.round(Number(v)).toLocaleString("es-PY")}` : `R$ ${Number(v).toFixed(2).replace(".", ",")}`;

/** Lista de produtos. Gerente e dono editam direto na tabela (preços, caixa, mínimo) e salvam tudo de uma vez. */
export function TabelaProdutos({ linhas, gestao, acao, volta }: {
  linhas: LinhaProduto[]; gestao: boolean; acao: (fd: FormData) => void; volta: string;
}) {
  const [mudados, setMudados] = useState<Record<string, boolean>>({});
  const total = Object.values(mudados).filter(Boolean).length;
  const marcar = (nome: string, original: string, valor: string) => setMudados((m) => ({ ...m, [nome]: valor.trim() !== original }));

  const campo = (nome: string, original: string, rotulo: string, largura: number, modo: "numeric" | "decimal") => (
    <input name={nome} form="edicao" data-original={original} defaultValue={original} inputMode={modo} placeholder="—" aria-label={rotulo}
           className={`celula ${mudados[nome] ? "mudou" : ""}`} style={{ width: largura }} onChange={(e) => marcar(nome, original, e.target.value)} />
  );

  return (
    <>
      {gestao && (
        <form id="edicao" action={acao} hidden onSubmit={(e) => {
          for (const el of Array.from(e.currentTarget.elements) as HTMLInputElement[])
            if (el.dataset.original !== undefined && !mudados[el.name]) el.disabled = true;
        }}><input type="hidden" name="volta" value={volta} /></form>
      )}
      <div className="tabela tabela-produtos"><table>
        <thead><tr>
          {gestao && <th style={{ width: 32 }}><MarcarTodos form="lote" /></th>}
          {gestao && <th title="A = ativo no site · D = desativado. Clique para trocar.">Site</th>}
          <th></th><th>Produto</th>
          <th className="num" title="Saldo somando os depósitos ativos">Estoque</th>
          <th className="num" title="Abaixo disso o produto entra no relatório de estoque baixo para comprar">Mínimo</th>
          <th className="num" title="Peças por caixa: o site mostra o preço da caixa fechada e o da unidade">Caixa</th>
          {TABELAS.map((t) => <th key={t.k} className="num">{t.t}</th>)}
        </tr></thead>
        <tbody>{linhas.map((p) => {
          const kit = p.tipo === "kit";
          const saldo = Number(p.saldo);
          const situacao = kit ? "" : saldo <= 0 ? "zerado" : p.estoque_minimo != null && saldo <= p.estoque_minimo ? "baixo" : "";
          return (
            <tr key={p.id} className={p.ativo ? "" : "inativo"}>
              {gestao && <td><input type="checkbox" name="ids" value={p.id} form="lote" aria-label={`Selecionar ${p.nome}`} /></td>}
              {gestao && <td style={{ width: 44 }}><BotaoAtivo id={p.id} ativo={p.ativo} nome={p.nome} /></td>}
              <td style={{ width: 52 }}>
                {p.foto ? <img src={p.foto} alt="" width={40} height={40} style={{ objectFit: "cover", borderRadius: 6, display: "block" }} />
                  : <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--afundado)" }} />}
              </td>
              <td style={{ minWidth: 240 }}>
                <Link href={`/produtos/${p.id}`}>{p.nome}</Link>
                <div className="pequeno suave">
                  {p.codigo}{p.marca ? ` · ${p.marca}` : ""}
                  {kit && <> · <span className="selo info">kit</span></>}
                  {!p.ativo && <> · <span className="selo">inativo</span></>}
                  {p.codigo_provisorio && <> · <span className="selo aviso">código provisório</span></>}
                </div>
              </td>
              <td className="num">
                {kit ? <span className="suave pequeno" title="Kit usa o estoque dos itens que o compõem">pelos itens</span>
                  : <span className={`estoque-num ${situacao}`}>{saldo.toLocaleString("pt-BR")}</span>}
              </td>
              <td className="num">
                {kit ? "—" : gestao ? campo(`min:${p.id}`, p.estoque_minimo != null ? String(p.estoque_minimo) : "", `Estoque mínimo de ${p.nome}`, 70, "numeric")
                  : (p.estoque_minimo ?? "—")}
              </td>
              <td className="num">
                {gestao ? campo(`caixa:${p.id}`, p.unidades_caixa ? String(p.unidades_caixa) : "", `Peças por caixa de ${p.nome}`, 60, "numeric")
                  : (p.unidades_caixa ?? "—")}
              </td>
              {TABELAS.map((t) => (
                <td key={t.k} className="num">
                  {gestao ? campo(`p:${p.id}:${t.k}`, editavel(p[t.k], t.gs), `${t.t} de ${p.nome}`, t.gs ? 100 : 84, "decimal")
                    : exibir(p[t.k], t.gs)}
                </td>
              ))}
            </tr>
          );
        })}</tbody>
      </table></div>
      {gestao && linhas.length > 0 && (
        <div className="salvar-fixo">
          <button form="edicao" className="principal" disabled={total === 0}>{total ? `Salvar ${total} alteração(ões)` : "Nenhuma alteração"}</button>
          <span className="pequeno suave">Clique num número da tabela para mudar. Os campos alterados ficam destacados. Preço em Gs arredonda para múltiplos de 500; o preço novo vale a partir de hoje e o antigo fica no histórico. Mínimo em branco = sem alerta.</span>
        </div>
      )}
    </>
  );
}
