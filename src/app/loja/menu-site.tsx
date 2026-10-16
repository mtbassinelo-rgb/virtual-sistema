"use client";

import { useEffect, useState } from "react";

type Grupo = { titulo?: string; linha?: boolean; links: { href: string; texto: string; qtd?: number }[] };

/** Menu lateral (três risquinhos): mapa do site com categorias, marcas e páginas. */
export function MenuSite({ rotulo, fechar, grupos }: { rotulo: string; fechar: string; grupos: Grupo[] }) {
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    document.body.style.overflow = aberto ? "hidden" : "";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberto]);
  return (
    <div className="menu-site">
      <button type="button" className="menu-site-botao" aria-label={rotulo} aria-expanded={aberto} onClick={() => setAberto(true)}>
        <span className="risquinhos" />
      </button>
      {aberto && (
        <>
          <div className="menu-site-fundo" onClick={() => setAberto(false)} />
          <nav className="menu-site-painel" aria-label={rotulo}>
            <div className="menu-site-topo">
              <b>Virtual Cosméticos</b>
              <button type="button" className="fechar" onClick={() => setAberto(false)} aria-label={fechar}>×</button>
            </div>
            {grupos.map((g, i) => g.titulo ? (
              <details key={i} className="menu-sub">
                <summary>{g.titulo}</summary>
                <div className="menu-sub-itens">
                  {g.links.map((l) => (
                    <a key={l.href} href={l.href} onClick={() => setAberto(false)}>{l.texto}{l.qtd != null && <span>{l.qtd}</span>}</a>
                  ))}
                </div>
              </details>
            ) : (
              <div key={i} className={g.linha ? "menu-linha" : "menu-grupo"}>
                {g.links.map((l) => (
                  <a key={l.href} href={l.href} onClick={() => setAberto(false)}
                     {...(l.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{l.texto}</a>
                ))}
              </div>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}
