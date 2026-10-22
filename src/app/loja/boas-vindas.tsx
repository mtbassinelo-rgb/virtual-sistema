"use client";

import { Fragment, useState, useTransition } from "react";
import { marcarBoasVindas } from "./acoes";

/** **negrito** dentro da linha */
function negrito(txt: string) {
  return txt.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>);
}

/** Texto da mensagem: linhas começando com "- " viram lista; o resto, parágrafos. */
export function TextoMensagem({ texto }: { texto: string }) {
  const blocos: { lista: boolean; linhas: string[] }[] = [];
  for (const l of texto.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    const lista = l.startsWith("- ");
    const ult = blocos[blocos.length - 1];
    if (ult && ult.lista && lista) ult.linhas.push(l.slice(2));
    else blocos.push({ lista, linhas: [lista ? l.slice(2) : l] });
  }
  return <>{blocos.map((b, i) => b.lista
    ? <ul key={i}>{b.linhas.map((x, j) => <li key={j}>{negrito(x)}</li>)}</ul>
    : <p key={i}>{negrito(b.linhas[0])}</p>)}</>;
}

/** Mensagem ao cliente quando abre a loja (editável em Site → Mensagem ao cliente). Fecha e só volta quando houver mensagem nova. */
export function BoasVindas({ titulo, texto, botao }: { titulo: string; texto: string; botao: string }) {
  const [aberto, setAberto] = useState(true);
  const [, iniciar] = useTransition();
  if (!aberto) return null;
  const fechar = () => { setAberto(false); iniciar(() => { marcarBoasVindas().catch(() => undefined); }); };
  return (
    <div className="folha-fundo boas-vindas-fundo" onClick={fechar}>
      <div className="boas-vindas" role="dialog" aria-modal="true" aria-labelledby="bv-titulo" onClick={(e) => e.stopPropagation()}>
        {titulo && <h2 id="bv-titulo">{titulo}</h2>}
        <TextoMensagem texto={texto} />
        <button type="button" className="adicionar" onClick={fechar}>{botao}</button>
      </div>
    </div>
  );
}
