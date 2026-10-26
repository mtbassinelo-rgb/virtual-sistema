"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Dep = { id: string; nome: string };
export type LinhaPedido = { id: string; codigo: string; nome: string; marca: string | null; caixa: number | null; origem: number; destino: number; vendas30: number; sugerido: number | null };

/** De → Para em destaque, com botão para inverter. Trocar a unidade recarrega a lista. */
export function EscolherUnidades({ deps, origem, destino, extra }: { deps: Dep[]; origem: string; destino: string; extra: Record<string, string> }) {
  const r = useRouter();
  const ir = (o: string, d: string) => {
    if (o === d) d = deps.find((x) => x.id !== o)?.id ?? d;
    r.push("/estoque/transferencias/nova?" + new URLSearchParams({ ...extra, origem: o, destino: d }));
  };
  return (
    <div className="rota-unidades">
      <label><span>Sai de</span>
        <select value={origem} onChange={(e) => ir(e.target.value, destino)}>{deps.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>
      </label>
      <button type="button" className="rota-inverter" title="Inverter" aria-label="Inverter origem e destino" onClick={() => ir(destino, origem)}>⇄</button>
      <label><span>Vai para</span>
        <select value={destino} onChange={(e) => ir(origem, e.target.value)}>{deps.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>
      </label>
    </div>
  );
}

/** Lista de produtos com busca na hora, filtro por marca e botões −/+ por caixa. A barra de baixo mostra o que vai no pedido. */
export function ListaPedido({ linhas, marcas, origemNome, destinoNome }: { linhas: LinhaPedido[]; marcas: string[]; origemNome: string; destinoNome: string }) {
  const [busca, setBusca] = useState("");
  const [marca, setMarca] = useState("");
  const [qtd, setQtd] = useState<Record<string, number>>(() => {
    const ini: Record<string, number> = {};
    for (const l of linhas) if (l.sugerido != null) ini[l.id] = Math.min(l.sugerido, Math.max(l.origem, 0)) || l.sugerido;
    return ini;
  });

  const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const vis = useMemo(() => {
    const termos = norm(busca).split(/\s+/).filter(Boolean);
    return linhas.filter((l) => (!marca || l.marca === marca) && termos.every((t) => norm(`${l.nome} ${l.codigo} ${l.marca ?? ""}`).includes(t)));
  }, [linhas, busca, marca]);

  const passo = (l: LinhaPedido) => l.caixa && l.caixa > 1 ? l.caixa : 12;
  const mudar = (l: LinhaPedido, v: number) => setQtd((q) => ({ ...q, [l.id]: Math.max(0, Math.round(v)) }));
  const escolhidos = linhas.filter((l) => (qtd[l.id] ?? 0) > 0);
  const pecas = escolhidos.reduce((s, l) => s + (qtd[l.id] ?? 0), 0);

  return (
    <>
      <div className="pedir-busca">
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto, código ou marca…" aria-label="Buscar produto" />
        <select value={marca} onChange={(e) => setMarca(e.target.value)} aria-label="Marca">
          <option value="">Todas as marcas</option>{marcas.map((m) => <option key={m}>{m}</option>)}
        </select>
        <span className="pequeno suave">{vis.length} produto(s)</span>
      </div>

      {vis.length === 0 ? <div className="vazio">Nenhum produto com essa busca.</div> : (
        <div className="pedir-lista">
          {vis.slice(0, 300).map((l) => {
            const q = qtd[l.id] ?? 0;
            const p = passo(l);
            return (
              <div key={l.id} className={`pedir-item ${q > 0 ? "escolhido" : ""}`}>
                <div className="pedir-nome">
                  <b>{l.nome}</b>
                  <span className="pequeno suave">{l.codigo}{l.marca ? ` · ${l.marca}` : ""}{l.caixa ? ` · caixa com ${l.caixa}` : ""}</span>
                </div>
                <div className="pedir-estoques">
                  <span title={`Estoque em ${origemNome}`}>{origemNome.split(" ")[0]}: <b>{l.origem.toLocaleString("pt-BR")}</b></span>
                  <span title={`Estoque em ${destinoNome}`} className={l.destino <= 0 ? "zerado" : ""}>{destinoNome.includes("Ciudad") ? "CDE" : destinoNome.split(" ")[0]}: <b>{l.destino.toLocaleString("pt-BR")}</b></span>
                  {l.vendas30 > 0 && <span className="suave">vendeu {l.vendas30.toLocaleString("pt-BR")} em 30 dias</span>}
                </div>
                <div className="pedir-qtd">
                  <button type="button" onClick={() => mudar(l, q - p)} disabled={q <= 0} aria-label="Menos uma caixa">−</button>
                  <input name={`q:${l.id}`} inputMode="numeric" value={q || ""} placeholder="0"
                    onChange={(e) => mudar(l, Number(e.target.value.replace(/\D/g, "")) || 0)} aria-label={`Quantidade de ${l.nome}`} />
                  <button type="button" onClick={() => mudar(l, q + p)} aria-label="Mais uma caixa">+{p}</button>
                </div>
              </div>
            );
          })}
          {vis.length > 300 && <p className="pequeno suave">Mostrando 300 de {vis.length}: use a busca.</p>}
        </div>
      )}
      {/* escolhidos que a busca escondeu continuam no pedido */}
      {escolhidos.filter((l) => !vis.slice(0, 300).includes(l)).map((l) => <input key={l.id} type="hidden" name={`q:${l.id}`} value={qtd[l.id]} />)}

      <div className="pedir-barra">
        <span>{escolhidos.length === 0 ? "Nenhum produto escolhido" : <><b>{escolhidos.length}</b> produto(s) · <b>{pecas.toLocaleString("pt-BR")}</b> unidades</>}</span>
        {escolhidos.length > 0 && <button type="button" className="discreto" onClick={() => setQtd({})}>Limpar</button>}
        <button className="principal" disabled={escolhidos.length === 0}>Enviar pedido para {origemNome}</button>
      </div>
    </>
  );
}
