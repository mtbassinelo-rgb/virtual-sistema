"use client";

import { useState } from "react";

/** Lista pronta para mandar ao fornecedor (WhatsApp ou e-mail). */
export function CopiarLista({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="linha" style={{ marginTop: 10 }}>
      <button type="button" onClick={async () => { await navigator.clipboard.writeText(texto); setOk(true); }}>{ok ? "Lista copiada ✓" : "Copiar lista de compra"}</button>
      <a className="botao whatsapp" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>
    </div>
  );
}
