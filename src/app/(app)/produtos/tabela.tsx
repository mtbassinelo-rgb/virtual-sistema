"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MarcarTodos } from "./lote";
import { alternarAtivo, excluirProduto } from "./acoes";

export type LinhaProduto = {
  id: string; codigo: string; nome: string; marca: string | null; foto: string | null; tipo: string; ativo: boolean;
  codigo_provisorio: boolean; unidades_caixa: number | null; estoque_minimo: number | null; saldo: string | number;
  py_normal: string | null; py_vip: string | null; br_normal: string | null; br_vip: string | null;
  promo_py: string | null; promo_br: string | null; promo_fim: string | null;
};

const TABELAS = [
  { k: "py_normal", t: "PY Normal", gs: true }, { k: "py_vip", t: "PY VIP", gs: true },
  { k: "br_normal", t: "BR Gold", gs: false }, { k: "br_vip", t: "BR Platinum", gs: false },
] as const;
const PROMOS = [{ k: "promo_py", pais: "PY", t: "Promo Gs", gs: true }, { k: "promo_br", pais: "BR", t: "Promo R$", gs: false }] as const;

const editavel = (v: string | null, gs: boolean) => v == null ? "" : gs ? String(Math.round(Number(v))) : Number(v).toFixed(2).replace(".", ",");
const exibir = (v: string | null, gs: boolean) => v == null ? "—" : gs ? `Gs ${Math.round(Number(v)).toLocaleString("es-PY")}` : `R$ ${Number(v).toFixed(2).replace(".", ",")}`;

type Resultado = { ok?: string; erro?: string };
type Desfazer = { texto: string; erro?: boolean; desfazer?: () => Promise<{ ok?: string; erro?: string }> };

/** Lista de produtos. Gerente e dono editam direto na tabela e salvam tudo de uma vez; dá para desfazer a última ação. */
export function TabelaProdutos({ linhas, gestao, acao }: {
  linhas: LinhaProduto[]; gestao: boolean; acao: (fd: FormData) => Promise<{ ok?: string; erro?: string }>;
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [mudados, setMudados] = useState<Record<string, boolean>>({});
  const [aviso, setAviso] = useState<Desfazer | null>(null);
  const [salvando, iniciar] = useTransition();
  const total = Object.values(mudados).filter(Boolean).length;
  const marcar = (nome: string, original: string, valor: string) => setMudados((m) => ({ ...m, [nome]: valor.trim() !== original }));

  // o aviso de desfazer some sozinho depois de 30 segundos
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 30000); return () => clearTimeout(t); }, [aviso]);

  function salvar() {
    const novos = new FormData(), antigos = new FormData();
    for (const el of Array.from(form.current?.elements ?? []) as HTMLInputElement[]) {
      if (el.dataset.original === undefined || !mudados[el.name]) continue;
      novos.set(el.name, el.value);
      antigos.set(el.name, el.dataset.original);
    }
    antigos.set("desfazer", "1");
    iniciar(async () => {
      const r = await acao(novos);
      if (r.erro) { setAviso({ texto: r.erro, erro: true }); return; }
      setMudados({});
      setAviso({ texto: r.ok ?? "Salvo.", desfazer: () => acao(antigos) });
      router.refresh();
    });
  }

  function desfazer() {
    const d = aviso?.desfazer;
    if (!d) return;
    iniciar(async () => {
      const r = await d();
      setAviso(r.erro ? { texto: r.erro, erro: true } : { texto: r.ok ?? "Desfeito." });
      router.refresh();
    });
  }

  const campo = (nome: string, original: string, rotulo: string, largura: number, modo: "numeric" | "decimal", extra = "") => (
    <input name={nome} form="edicao" data-original={original} defaultValue={original} inputMode={modo} placeholder="—" aria-label={rotulo}
           className={`celula ${extra} ${mudados[nome] ? "mudou" : ""}`} style={{ width: largura }} onChange={(e) => marcar(nome, original, e.target.value)}
           onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (total) salvar(); } }} />
  );

  return (
    <>
      {gestao && <form id="edicao" ref={form} hidden onSubmit={(e) => { e.preventDefault(); salvar(); }} />}
      <div className="tabela tabela-produtos"><table data-sem-filtro>
        <thead><tr>
          {gestao && <th style={{ width: 32 }}><MarcarTodos form="lote" /></th>}
          {gestao && <th title="A = ativo no site · D = desativado (clique para trocar) · E = excluir">Site</th>}
          <th></th><th>Produto</th>
          <th className="num" title="Saldo somando os depósitos ativos">Estoque</th>
          <th className="num" title="Abaixo disso o produto entra no relatório de compra">Mínimo</th>
          <th className="num" title="Peças na caixa do fornecedor. Para o cliente a caixa é sempre de 12 unidades">Cx forn.</th>
          {TABELAS.map((t) => <th key={t.k} className="num">{t.t}</th>)}
          {PROMOS.map((t) => <th key={t.k} className="num promo-col" title="Preço promocional (sobre a tabela normal do país). Vale 30 dias e aparece em Promoções no site. Em branco = sem promoção.">{t.t}</th>)}
        </tr></thead>
        <tbody>{linhas.map((p) => {
          const kit = p.tipo === "kit";
          const saldo = Number(p.saldo);
          const situacao = kit ? "" : saldo <= 0 ? "zerado" : p.estoque_minimo != null && saldo <= p.estoque_minimo ? "baixo" : "";
          // a chave muda quando os valores mudam: a linha recarrega com o que foi salvo (ou desfeito)
          const chave = [p.id, p.ativo, p.estoque_minimo, p.unidades_caixa, p.py_normal, p.py_vip, p.br_normal, p.br_vip, p.promo_py, p.promo_br].join("|");
          return (
            <tr key={chave} className={p.ativo ? "" : "inativo"}>
              {gestao && <td><input type="checkbox" name="ids" value={p.id} form="lote" aria-label={`Selecionar ${p.nome}`} /></td>}
              {gestao && (
                <td style={{ width: 80 }}><div className="acoes-ad">
                  <BotaoAtivo id={p.id} ativo={p.ativo} nome={p.nome} avisar={setAviso} />
                  <BotaoExcluir id={p.id} nome={p.nome} avisar={setAviso} />
                </div></td>
              )}
              <td style={{ width: 52 }}>
                {p.foto ? <img src={p.foto} alt="" width={40} height={40} style={{ objectFit: "cover", borderRadius: 6, display: "block" }} />
                  : <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--afundado)" }} />}
              </td>
              <td style={{ minWidth: 220 }}>
                <Link href={`/produtos/${p.id}`}>{p.nome}</Link>
                <div className="pequeno suave">
                  {p.codigo}{p.marca ? ` · ${p.marca}` : ""}
                  {kit && <> · <span className="selo info">kit</span></>}
                  {!p.ativo && <> · <span className="selo">inativo</span></>}
                  {(p.promo_py || p.promo_br) && <> · <span className="selo aviso">promoção{p.promo_fim ? ` até ${p.promo_fim.slice(8, 10)}/${p.promo_fim.slice(5, 7)}` : ""}</span></>}
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
              {PROMOS.map((t) => (
                <td key={t.k} className="num promo-col">
                  {gestao ? campo(`promo:${p.id}:${t.pais}`, editavel(p[t.k], t.gs), `${t.t} de ${p.nome}`, t.gs ? 100 : 84, "decimal", "promo")
                    : <span className={p[t.k] ? "preco-promo" : ""}>{exibir(p[t.k], t.gs)}</span>}
                </td>
              ))}
            </tr>
          );
        })}</tbody>
      </table></div>
      {gestao && (total > 0 || aviso) && (
        <div className={`salvar-fixo ${aviso?.erro ? "com-erro" : ""}`}>
          {total > 0 && <button type="button" className="principal" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : `Salvar ${total} alteração(ões)`}</button>}
          {aviso && <span className={aviso.erro ? "texto-erro" : ""}>{aviso.texto}</span>}
          {aviso?.desfazer && <button type="button" disabled={salvando} onClick={desfazer}>↶ Desfazer</button>}
          {total === 0 && aviso && <button type="button" className="fechar-aviso" aria-label="Fechar" onClick={() => setAviso(null)}>×</button>}
        </div>
      )}
      {gestao && total === 0 && !aviso && linhas.length > 0 && (
        <p className="pequeno suave" style={{ margin: 0 }}>Clique num número para mudar e aperte Enter ou Salvar. Preço em Gs arredonda para múltiplos de 500; o preço novo vale a partir de hoje. Preço promocional vale 30 dias e aparece em Promoções no site. Depois de salvar, aparece o botão Desfazer.</p>
      )}
    </>
  );
}

/** A = ativo no site (clique para desativar) · D = desativado (clique para ativar). */
function BotaoAtivo({ id, ativo, nome, avisar }: { id: string; ativo: boolean; nome: string; avisar: (d: Desfazer) => void }) {
  const router = useRouter();
  const [ocupado, iniciar] = useTransition();
  const trocar = async (para: boolean): Promise<Resultado> => {
    const r = await alternarAtivo(id, para);
    return r.erro ? { erro: r.erro } : { ok: `${nome}: ${para ? "ativado" : "desativado"} no site.` };
  };
  return (
    <button type="button" className={`botao-ad ${ativo ? "ativo" : "inativo"}`} disabled={ocupado}
      title={ativo ? `Ativo no site. Clique para desativar` : `Desativado. Clique para ativar no site`}
      aria-label={ativo ? `Desativar ${nome}` : `Ativar ${nome}`}
      onClick={() => iniciar(async () => {
        const r = await trocar(!ativo);
        avisar(r.erro ? { texto: r.erro, erro: true } : { texto: r.ok ?? "", desfazer: () => trocar(ativo) });
        router.refresh();
      })}>
      {ocupado ? "…" : ativo ? "A" : "D"}
    </button>
  );
}

/** E = excluir (pede confirmação; apagar de vez não tem desfazer, desativar tem). */
function BotaoExcluir({ id, nome, avisar }: { id: string; nome: string; avisar: (d: Desfazer) => void }) {
  const router = useRouter();
  const [ocupado, iniciar] = useTransition();
  return (
    <button type="button" className="botao-ad excluir" disabled={ocupado} title={`Excluir ${nome}`} aria-label={`Excluir ${nome}`}
      onClick={() => {
        if (!window.confirm(`Excluir "${nome}"?\n\nSe ele já teve pedido ou estoque, fica só desativado (o histórico é mantido). Se nunca teve, é apagado e não dá para desfazer.`)) return;
        iniciar(async () => {
          const r = await excluirProduto(id);
          if (r.erro) avisar({ texto: r.erro, erro: true });
          else if (r.desativado) avisar({ texto: r.msg ?? "", desfazer: async (): Promise<Resultado> => { const x = await alternarAtivo(id, true); return x.erro ? { erro: x.erro } : { ok: `${nome} ativado de novo.` }; } });
          else avisar({ texto: r.msg ?? "" });
          router.refresh();
        });
      }}>
      {ocupado ? "…" : "E"}
    </button>
  );
}
