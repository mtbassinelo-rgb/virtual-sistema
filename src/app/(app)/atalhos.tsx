"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type Atalho = { tecla: string; href: string; texto: string };

/** Fora de um campo de texto: uma tecla abre a tela (N = novo pedido…), "/" vai para a busca e "?" mostra a lista. */
export function Atalhos({ atalhos, rapidos }: { atalhos: Atalho[]; rapidos: Atalho[] }) {
  const r = useRouter();
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const alvo = e.target as HTMLElement | null;
      const digitando = alvo && (alvo.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName));
      if (e.key === "Escape") { setAberto(false); if (digitando) alvo?.blur(); return; }
      if (digitando) return;
      if (e.key === "?") { e.preventDefault(); setAberto((x) => !x); return; }
      if (e.key === "/") {
        const busca = document.getElementById("busca-geral") as HTMLInputElement | null;
        if (busca) { e.preventDefault(); busca.focus(); busca.select(); }
        return;
      }
      const a = atalhos.find((x) => x.tecla.toLowerCase() === e.key.toLowerCase());
      if (a) { e.preventDefault(); setAberto(false); r.push(a.href); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [atalhos, r]);

  return (
    <>
      <nav className="acoes-rapidas" aria-label="Ações rápidas">
        {rapidos.map((a) => (
          <a key={a.href} href={a.href} className="botao rapido" title={`${a.texto} (tecla ${a.tecla})`}
             onClick={(e) => { e.preventDefault(); r.push(a.href); }}>
            {a.texto}<kbd>{a.tecla}</kbd>
          </a>
        ))}
        <button type="button" className="rapido teclado" onClick={() => setAberto(true)} title="Teclas de atalho (?)" aria-label="Teclas de atalho">⌨</button>
      </nav>
      {aberto && (
        <div className="atalhos-fundo" onClick={() => setAberto(false)}>
          <div className="atalhos-caixa" role="dialog" aria-label="Teclas de atalho" onClick={(e) => e.stopPropagation()}>
            <div className="linha entre"><h2 style={{ margin: 0 }}>Teclas de atalho</h2><button type="button" onClick={() => setAberto(false)}>Fechar</button></div>
            <p className="pequeno suave">Funcionam em qualquer tela, quando você não está digitando num campo. Aperte só a letra.</p>
            <ul className="atalhos-lista">
              {atalhos.map((a) => (
                <li key={a.tecla}><a href={a.href} onClick={(e) => { e.preventDefault(); setAberto(false); r.push(a.href); }}><kbd>{a.tecla}</kbd> {a.texto}</a></li>
              ))}
              <li><span><kbd>/</kbd> Buscar produto, cliente ou pedido</span></li>
              <li><span><kbd>?</kbd> Mostrar esta lista</span></li>
              <li><span><kbd>Esc</kbd> Sair do campo / fechar</span></li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
