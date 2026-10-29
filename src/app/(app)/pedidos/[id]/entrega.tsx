"use client";

import { useState } from "react";
import { definirEntrega } from "../acoes";

/** Vendedora informa como o pedido sai: envio (meio + dados) ou retirada (loja CDE / depósito Foz). */
export function FormEntrega({ pedidoId, pais, atual }: {
  pedidoId: string; pais: "PY" | "BR";
  atual: { tipo: string | null; meio: string | null; dados: string | null };
}) {
  const retiraLocal = pais === "PY" ? "Loja CDE" : "Depósito Foz";
  const [tipo, setTipo] = useState<string>(atual.tipo ?? "");
  const meios = pais === "PY" ? ["Passeiro", "Transportadora", "Encomienda (ómnibus)", "Delivery"] : ["Correios", "Transportadora", "Melhor Envio", "Motoboy", "Passeiro"];
  return (
    <form action={definirEntrega} className="campos">
      <input type="hidden" name="pedido_id" value={pedidoId} />
      <div className="linha largo" style={{ gap: 8 }}>
        <label className={`chip ${tipo === "envio" ? "ativo" : ""}`}><input type="radio" name="tipo" value="envio" checked={tipo === "envio"} onChange={() => setTipo("envio")} /> Envio</label>
        <label className={`chip ${tipo === "retira" ? "ativo" : ""}`}><input type="radio" name="tipo" value="retira" checked={tipo === "retira"} onChange={() => setTipo("retira")} /> Retira {pais === "PY" ? "na loja CDE" : "no depósito (Foz)"}</label>
      </div>
      {tipo === "envio" && (
        <>
          <label>Meio de envio
            <input name="meio" list="meios-envio" required defaultValue={atual.tipo === "envio" ? atual.meio ?? "" : ""} placeholder="Ex.: Transportadora Nasa" />
            <datalist id="meios-envio">{meios.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          <label className="largo">Dados para o envio
            <textarea name="dados" required defaultValue={atual.tipo === "envio" ? atual.dados ?? "" : ""}
              placeholder={pais === "PY" ? "Nome, CI, telefone, cidade/endereço, transportadora" : "Nome, CPF, telefone, endereço com CEP"} />
          </label>
        </>
      )}
      {tipo === "retira" && (
        <>
          <input type="hidden" name="meio" value={retiraLocal} />
          <label className="largo">Observação (opcional)<input name="dados" defaultValue={atual.tipo === "retira" ? atual.dados ?? "" : ""} placeholder="Ex.: quem vai retirar" /></label>
        </>
      )}
      {tipo && <button className="principal">Salvar entrega</button>}
    </form>
  );
}
