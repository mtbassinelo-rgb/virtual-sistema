"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export type ItemMenu = { href: string; texto: string; dica?: string; contador?: number };
export type GrupoMenu = { id: string; titulo: string; icone: string; itens: ItemMenu[] };

/** Qual link do menu corresponde à página aberta: o de caminho mais longo que bate (e o filtro, se o link tiver). */
function linkAtual(grupos: GrupoMenu[], caminho: string, busca: URLSearchParams): string | null {
  let melhor: string | null = null, tam = -1;
  for (const g of grupos) for (const i of g.itens) {
    const [base, qs] = i.href.split("?");
    const bate = base === "/" ? caminho === "/" : caminho === base || caminho.startsWith(base + "/");
    if (!bate) continue;
    if (qs && ![...new URLSearchParams(qs).entries()].every(([k, v]) => busca.get(k) === v)) continue;
    const peso = base.length * 10 + (qs ? 5 : 0) - (!qs && busca.get("filtro") ? 1 : 0);
    if (peso > tam) { tam = peso; melhor = i.href; }
  }
  return melhor;
}

const ICONES: Record<string, React.ReactNode> = {
  inicio: <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />,
  vendas: <path d="M5 6h14l-1.5 9h-11zM8 19.5a1 1 0 1 0 0 .01M17 19.5a1 1 0 1 0 0 .01M3 3h2l.6 3" />,
  produtos: <path d="M12 3 4 7v10l8 4 8-4V7zM4 7l8 4 8-4M12 11v10" />,
  estoque: <path d="M3 8h18v12H3zM7 8V5h10v3M8 13h8" />,
  relatorios: <path d="M5 20V10M10 20V4M15 20v-7M20 20v-4" />,
  site: <path d="M3 5h18v14H3zM3 9h18M7 7h.01M10 7h.01" />,
  financeiro: <path d="M3 7h18v12H3zM3 11h18M7 15h3M16 4H6" />,
  admin: <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />,
  clientes: <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.7" />,
  whatsapp: <path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8zM9 9.5c0 3 2.5 5.5 5.5 5.5l1.3-1.3-2-1-.8.8a4 4 0 0 1-2.5-2.5l.8-.8-1-2z" />,
  inteligencia: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />,
};

export function MenuLateral({ grupos }: { grupos: GrupoMenu[] }) {
  const caminho = usePathname();
  const busca = useSearchParams();
  const [aberto, setAberto] = useState(false);
  // fecha o menu do celular ao trocar de página
  useEffect(() => setAberto(false), [caminho, busca]);
  const atual = linkAtual(grupos, caminho, busca);

  return (
    <>
      <button type="button" className="abrir-menu" aria-expanded={aberto} aria-controls="menu-lateral" onClick={() => setAberto(!aberto)}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        Menu
      </button>
      <nav id="menu-lateral" className={`menu-lateral ${aberto ? "aberto" : ""}`} aria-label="Menu do sistema">
        {grupos.map((g) => {
          const temAtivo = g.itens.some((i) => i.href === atual);
          if (g.itens.length === 1) {
            const i = g.itens[0];
            return (
              <Link key={g.id} href={i.href} className={`grupo-unico ${temAtivo ? "atual" : ""}`} aria-current={temAtivo ? "page" : undefined}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">{ICONES[g.icone]}</svg>
                <span>{g.titulo}</span>
              </Link>
            );
          }
          return (
            <details key={g.id} className="grupo" open={temAtivo || undefined}>
              <summary className={temAtivo ? "atual" : ""}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">{ICONES[g.icone]}</svg>
                <span>{g.titulo}</span>
              </summary>
              <ul>
                {g.itens.map((i) => {
                  const a = i.href === atual;
                  return (
                    <li key={i.href}>
                      <Link href={i.href} className={a ? "atual" : ""} aria-current={a ? "page" : undefined} title={i.dica}>
                        {i.texto}
                        {i.contador ? <span className="contador">{i.contador}</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </nav>
      {aberto && <div className="menu-fundo" onClick={() => setAberto(false)} aria-hidden="true" />}
    </>
  );
}
