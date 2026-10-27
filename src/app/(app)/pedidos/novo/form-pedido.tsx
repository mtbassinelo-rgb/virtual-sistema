"use client";

import { useState, useTransition, type ReactNode } from "react";
import { criarPedidoSemPerder } from "../acoes";

/**
 * Formulário do novo pedido: envia sem recarregar a página.
 * Se o sistema recusar (preço, estoque, cliente…), mostra o motivo e mantém tudo o que foi digitado.
 */
export function FormPedido({ children }: { children: ReactNode }) {
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  return (
    <form className="painel campos" aria-busy={enviando || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        if (enviando) return;
        const fd = new FormData(e.currentTarget);
        setErro(null);
        iniciar(async () => {
          const r = await criarPedidoSemPerder(fd);
          if (r?.erro) { setErro(r.erro); window.scrollTo({ top: 0, behavior: "smooth" }); }
        });
      }}>
      {erro && <div className="aviso-caixa erro largo" role="alert"><b>O pedido não foi criado:</b> {erro} <span className="pequeno">(o que você digitou continua aqui: corrija e clique em Criar pedido de novo)</span></div>}
      {children}
      {enviando && <div className="largo pequeno suave">Criando o pedido…</div>}
    </form>
  );
}
