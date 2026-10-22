"use client";

import { useState, useTransition } from "react";
import { marcarBoasVindas } from "./acoes";

/** Aviso de boas-vindas na primeira entrada do cliente na loja. Fecha e não aparece mais. */
export function BoasVindas({ nome, vendedora, es }: { nome: string; vendedora: string; es: boolean }) {
  const [aberto, setAberto] = useState(true);
  const [, iniciar] = useTransition();
  if (!aberto) return null;
  const fechar = () => { setAberto(false); iniciar(() => { marcarBoasVindas().catch(() => undefined); }); };
  const primeiro = nome.split(" ")[0];
  return (
    <div className="folha-fundo boas-vindas-fundo" onClick={fechar}>
      <div className="boas-vindas" role="dialog" aria-modal="true" aria-labelledby="bv-titulo" onClick={(e) => e.stopPropagation()}>
        <div className="bv-emoji" aria-hidden="true">🎉</div>
        {es ? (
          <>
            <h2 id="bv-titulo">¡Bienvenido/a, {primeiro}!</h2>
            <p>Gracias por ser cliente de <b>Virtual Cosméticos</b>. Desde ahora usted puede hacer sus pedidos directamente por nuestro sitio.</p>
            <ul>
              <li><b>Comprar por el sitio es más rápido y seguro:</b> ve sus precios, las promociones y las novedades actualizadas, arma el pedido cuando quiera y sigue cada etapa hasta la entrega.</li>
              <li>Su pedido llega <b>directo a su vendedora{vendedora ? ` ${vendedora}` : ""}</b>, sin errores de anotación.</li>
              <li>Si algún producto de su pedido <b>no está disponible</b>, su vendedora se comunicará con usted para avisarle y cerrar juntos el pedido.</li>
            </ul>
            <p className="bv-final">¡Buenas compras! 🛍️</p>
            <button type="button" className="adicionar" onClick={fechar}>Empezar a comprar</button>
          </>
        ) : (
          <>
            <h2 id="bv-titulo">Bem-vindo(a), {primeiro}!</h2>
            <p>Obrigado por ser cliente da <b>Virtual Cosméticos</b>. A partir de agora você pode fazer seus pedidos direto pelo nosso site.</p>
            <ul>
              <li><b>Comprar pelo site é mais rápido e seguro:</b> você vê seus preços, as promoções e as novidades atualizadas, monta o pedido quando quiser e acompanha cada etapa até a entrega.</li>
              <li>Seu pedido chega <b>direto para a sua vendedora{vendedora ? ` ${vendedora}` : ""}</b>, sem erro de anotação.</li>
              <li>Se algum produto do seu pedido <b>não estiver disponível</b>, a sua vendedora entra em contato para avisar e fechar o pedido com você.</li>
            </ul>
            <p className="bv-final">Boas compras! 🛍️</p>
            <button type="button" className="adicionar" onClick={fechar}>Começar a comprar</button>
          </>
        )}
      </div>
    </div>
  );
}
