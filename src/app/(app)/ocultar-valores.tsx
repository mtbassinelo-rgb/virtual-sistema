"use client";

import { useEffect, useState } from "react";

const CHAVE = "vc_ocultar_valores";
const DINHEIRO = /(R\$|Gs\.?)\s?-?[\d.,]+/;

/** Marca (sem mexer no texto) os elementos que mostram dinheiro (R$ / Gs), para embaçar só eles. */
function marcar(raiz: Node) {
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = (n as Text).parentElement;
    if (el && DINHEIRO.test((n as Text).data) && !el.closest("input, textarea, script, style, select, option")) el.setAttribute("data-dinheiro", "");
  }
}

/** Olhinho no topo: esconde (embaça) os valores na tela, para mostrar o painel sem expor números. Fica lembrado neste navegador. */
export function OcultarValores() {
  const [oculto, setOculto] = useState(false);

  useEffect(() => {
    try { setOculto(localStorage.getItem(CHAVE) === "1"); } catch { /* sem armazenamento */ }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("ocultar-valores", oculto);
    try { localStorage.setItem(CHAVE, oculto ? "1" : "0"); } catch { /* sem armazenamento */ }
    if (!oculto) return;
    const main = document.querySelector("main.conteudo");
    if (!main) return;
    marcar(main);
    const obs = new MutationObserver((m) => { for (const x of m) { if (x.type === "characterData") marcar(x.target); else x.addedNodes.forEach((n) => marcar(n)); } });
    obs.observe(main, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, [oculto]);

  return (
    <button type="button" className="rapido olho" onClick={() => setOculto((x) => !x)} aria-pressed={oculto}
      title={oculto ? "Mostrar valores" : "Ocultar valores"} aria-label={oculto ? "Mostrar valores" : "Ocultar valores"}>
      {oculto ? "🙈" : "👁"}
    </button>
  );
}
