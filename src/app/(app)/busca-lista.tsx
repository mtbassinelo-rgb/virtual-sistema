"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type OpcaoBusca = { v: string; t: string; d?: string };

/** Sem acento, minúsculo. */
const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Busca do jeito do sistema: "%" é coringa e espaço separa palavras.
 * "sha%uva" acha "Shampoo Babalu Uva"; "kit maycrene" acha os kits da Maycrene.
 * Todas as partes precisam aparecer (em qualquer ordem).
 */
export function casa(texto: string, busca: string): boolean {
  const alvo = normal(texto);
  return normal(busca).split(/[%\s]+/).filter(Boolean).every((p) => alvo.includes(p));
}

/**
 * Campo de texto com lista que vai filtrando enquanto digita (substitui o <select> comprido).
 * Envia o valor escolhido num campo escondido com o mesmo `name`.
 */
export function BuscaLista({ name, opcoes, placeholder, required, defaultValue, ariaLabel, maximo = 40 }: {
  name: string; opcoes: OpcaoBusca[]; placeholder?: string; required?: boolean; defaultValue?: string; ariaLabel?: string; maximo?: number;
}) {
  const inicial = opcoes.find((o) => o.v === defaultValue);
  const [valor, setValor] = useState(inicial?.v ?? "");
  const [texto, setTexto] = useState(inicial?.t ?? "");
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);

  const achados = useMemo(() => {
    const b = texto.trim();
    if (!b || (valor && opcoes.find((o) => o.v === valor)?.t === texto)) return opcoes.slice(0, maximo);
    return opcoes.filter((o) => casa(`${o.t} ${o.d ?? ""}`, b)).slice(0, maximo);
  }, [texto, valor, opcoes, maximo]);

  useEffect(() => {
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  // valida no envio do formulário: campo obrigatório precisa de uma opção escolhida
  useEffect(() => {
    campo.current?.setCustomValidity(required && !valor ? "Escolha uma opção da lista." : texto && !valor ? "Escolha uma opção da lista (ou apague o texto)." : "");
  }, [valor, texto, required]);

  const escolher = (o: OpcaoBusca | null) => {
    setValor(o?.v ?? "");
    setTexto(o?.t ?? "");
    setAberto(false);
  };

  return (
    <div ref={caixa} className="busca-lista" style={{ position: "relative" }}>
      <input type="hidden" name={name} value={valor} />
      <input
        ref={campo}
        type="text"
        value={texto}
        placeholder={placeholder ?? "Digite para buscar (use % como coringa)"}
        aria-label={ariaLabel}
        autoComplete="off"
        role="combobox"
        aria-expanded={aberto}
        onFocus={(e) => { setAberto(true); e.currentTarget.select(); }}
        onChange={(e) => { setTexto(e.target.value); setValor(""); setAberto(true); setAtivo(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setAberto(true); setAtivo((a) => Math.min(a + 1, achados.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && aberto && achados[ativo]) { e.preventDefault(); escolher(achados[ativo]); }
          else if (e.key === "Escape") setAberto(false);
          else if (e.key === "Backspace" && valor) { setValor(""); }
        }}
      />
      {aberto && (
        <ul role="listbox" style={{
          position: "absolute", zIndex: 30, left: 0, right: 0, top: "100%", margin: 0, padding: 4, listStyle: "none",
          maxHeight: 320, overflowY: "auto", background: "var(--fundo, #fff)", border: "1px solid var(--borda, #ddd)",
          borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.12)",
        }}>
          {achados.length === 0 && <li className="pequeno suave" style={{ padding: "8px 10px" }}>Nada encontrado. Tente outra parte do nome ou use %.</li>}
          {!required && valor && (
            <li role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); escolher(null); }}
              className="pequeno suave" style={{ padding: "6px 10px", cursor: "pointer" }}>— limpar —</li>
          )}
          {achados.map((o, i) => (
            <li key={o.v} role="option" aria-selected={i === ativo}
              onMouseDown={(e) => { e.preventDefault(); escolher(o); }}
              onMouseEnter={() => setAtivo(i)}
              style={{ padding: "6px 10px", cursor: "pointer", borderRadius: 6, background: i === ativo ? "var(--marca-claro, #f1eafa)" : undefined }}>
              <div>{o.t}</div>
              {o.d && <div className="pequeno suave">{o.d}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
