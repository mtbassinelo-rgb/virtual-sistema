"use client";

import { useState } from "react";
import { definirEntrega } from "../acoes";

/** Vendedora informa como o pedido sai: envio (meio + dados) ou retirada (loja CDE / depósito Foz). */
export type DadosEnvio = { nome: string; documento: string; telefone: string; endereco: string; tem: boolean };

export function FormEntrega({ pedidoId, pais, atual, guardado }: {
  pedidoId: string; pais: "PY" | "BR";
  atual: { tipo: string | null; meio: string | null; dados: string | null };
  guardado: DadosEnvio;
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
          <fieldset className="largo dados-envio">
            <legend>{guardado.tem ? "Confira os dados de envio (guardados na ficha do cliente)" : "Dados de envio (ficam guardados na ficha do cliente)"}</legend>
            <div className="campos">
              <label>Nome de quem recebe<input name="envio_nome" required maxLength={120} defaultValue={guardado.nome} /></label>
              <label>{pais === "PY" ? "Nº de identidade (CI)" : "Nº de identidade (CPF/RG)"}<input name="envio_documento" required maxLength={40} defaultValue={guardado.documento} /></label>
              <label>Telefone<input name="envio_telefone" required maxLength={40} inputMode="tel" defaultValue={guardado.telefone} /></label>
              <label className="largo">Direção (endereço e cidade)<textarea name="envio_endereco" required maxLength={500} rows={2} defaultValue={guardado.endereco}
                placeholder={pais === "PY" ? "Calle, número, barrio, ciudad" : "Rua, número, bairro, cidade, CEP"} /></label>
              <label className="largo">Observação (opcional)<input name="dados" maxLength={300} placeholder="Ex.: entregar à tarde, agência da transportadora" /></label>
            </div>
            <label className="confirmo"><input type="checkbox" name="confirmo" required style={{ width: "auto" }} /> <b>Confirmo nome, identidade, telefone e direção</b></label>
            <p className="pequeno suave" style={{ margin: 0 }}>Se mudar algo aqui, a ficha do cliente atualiza para os próximos envios.</p>
          </fieldset>
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
