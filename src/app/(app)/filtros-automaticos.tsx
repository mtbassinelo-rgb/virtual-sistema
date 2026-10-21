"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Filtro automático para todas as tabelas do sistema (div.tabela > table).
 * Coloca em cima da tabela: busca por texto, um seletor para cada coluna com poucos valores
 * (situação, vendedora, marca, status…) e o contador "x de y".
 * Só esconde/mostra linhas; não muda a ordem nem os dados.
 * Para desligar numa tabela: <table data-sem-filtro>. Tabelas com menos de 6 linhas ficam sem filtro.
 */
const MIN_LINHAS = 6;
const MAX_OPCOES = 15;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const textoCelula = (td: Element) => (td.querySelector("input,select,textarea,button,form") && !td.querySelector("a") ? "" : (td.textContent ?? "").replace(/\s+/g, " ").trim());
const pareceNumero = (s: string) => /^[-+]?(R\$|Gs|US\$)?\s*[\d.,%\s]+$/.test(s);

function preparar(tabela: HTMLTableElement) {
  if (tabela.dataset.filtroPronto || tabela.hasAttribute("data-sem-filtro")) return;
  const corpo = tabela.tBodies[0];
  if (!corpo) return;
  const linhas = Array.from(corpo.rows).filter((r) => r.cells.length > 1);
  if (linhas.length < MIN_LINHAS) return;
  tabela.dataset.filtroPronto = "1";

  const cab = Array.from(tabela.tHead?.rows[0]?.cells ?? []).map((th) => (th.textContent ?? "").replace(/\s+/g, " ").trim());
  // colunas boas para seletor: 2 a 15 valores distintos, texto curto, não numérico
  const colunas: { i: number; nome: string; valores: string[] }[] = [];
  cab.forEach((nome, i) => {
    if (!nome) return;
    const vals = linhas.map((r) => (r.cells[i] ? textoCelula(r.cells[i]) : "")).filter(Boolean);
    if (vals.length < linhas.length * 0.5) return;
    const dist = [...new Set(vals)];
    if (dist.length < 2 || dist.length > MAX_OPCOES) return;
    if (dist.some((v) => v.length > 40) || dist.filter(pareceNumero).length > dist.length * 0.6) return;
    colunas.push({ i, nome, valores: dist.sort((a, b) => a.localeCompare(b, "pt-BR")) });
  });

  const barra = document.createElement("div");
  barra.className = "filtro-tabela";
  barra.setAttribute("role", "search");
  const busca = document.createElement("input");
  busca.type = "search";
  busca.placeholder = "Filtrar esta lista…";
  busca.setAttribute("aria-label", "Filtrar esta lista");
  barra.appendChild(busca);
  const seletores = colunas.map((c) => {
    const s = document.createElement("select");
    s.setAttribute("aria-label", `Filtrar por ${c.nome}`);
    s.append(new Option(`${c.nome}: todos`, ""), ...c.valores.map((v) => new Option(v, v)));
    barra.appendChild(s);
    return { s, i: c.i };
  });
  const limpar = document.createElement("button");
  limpar.type = "button";
  limpar.textContent = "Limpar";
  limpar.hidden = true;
  barra.appendChild(limpar);
  const conta = document.createElement("span");
  conta.className = "pequeno suave";
  barra.appendChild(conta);

  const aplicar = () => {
    const termos = norm(busca.value).split(" ").filter(Boolean);
    const todas = Array.from(corpo.rows).filter((r) => r.cells.length > 1);
    let vis = 0;
    for (const r of todas) {
      const txt = norm(r.textContent ?? "");
      const ok = termos.every((t) => txt.includes(t)) && seletores.every(({ s, i }) => !s.value || (r.cells[i] && textoCelula(r.cells[i]) === s.value));
      r.style.display = ok ? "" : "none";
      if (ok) vis++;
    }
    const ativo = !!busca.value || seletores.some(({ s }) => s.value);
    limpar.hidden = !ativo;
    conta.textContent = ativo ? `${vis} de ${todas.length}` : `${todas.length} linhas`;
  };
  busca.addEventListener("input", aplicar);
  seletores.forEach(({ s }) => s.addEventListener("change", aplicar));
  limpar.addEventListener("click", () => { busca.value = ""; seletores.forEach(({ s }) => { s.value = ""; }); aplicar(); busca.focus(); });

  const alvo = tabela.closest(".tabela") ?? tabela;
  alvo.parentElement?.insertBefore(barra, alvo);
  (tabela as HTMLTableElement & { _barraFiltro?: HTMLElement })._barraFiltro = barra;
  aplicar();
}

export function FiltrosAutomaticos() {
  const caminho = usePathname();
  const params = useSearchParams();
  useEffect(() => {
    const varrer = () => {
      document.querySelectorAll<HTMLTableElement>(".tabela table").forEach(preparar);
      // remove barras de tabelas que saíram da tela
      document.querySelectorAll<HTMLElement>(".filtro-tabela").forEach((b) => {
        const prox = b.nextElementSibling;
        if (!prox || !(prox.matches("table") || prox.querySelector("table"))) b.remove();
      });
    };
    varrer();
    let pendente = 0;
    const obs = new MutationObserver(() => { cancelAnimationFrame(pendente); pendente = requestAnimationFrame(varrer); });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => { obs.disconnect(); cancelAnimationFrame(pendente); };
  }, [caminho, params]);
  return null;
}
