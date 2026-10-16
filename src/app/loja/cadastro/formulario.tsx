"use client";

import { useActionState, useEffect } from "react";
import { enviarCadastro, type RespostaCadastro } from "./acoes";

type T = {
  cadNome: string; cadContato: string; whatsapp: string; cadEmail: string; cadCidade: string; cadTipo: string;
  cadDoc: string; cadMsg: string; cadEnviar: string; cadAviso: string; enviando: string; tipos: [string, string][];
};

export function FormularioCadastro({ t }: { t: T }) {
  const [estado, acao, enviando] = useActionState<RespostaCadastro, FormData>(enviarCadastro, {});
  useEffect(() => { if (estado.url) window.location.href = estado.url; }, [estado]);
  return (
    <form action={acao} className="cadastro-form">
      <label className="largo">{t.cadNome}<input name="nome" required maxLength={120} autoComplete="organization" /></label>
      <label>{t.cadContato}<input name="contato" maxLength={120} autoComplete="name" /></label>
      <label>{t.whatsapp}<input name="whatsapp" required inputMode="tel" autoComplete="tel" maxLength={25} /></label>
      <label>{t.cadEmail}<input name="email" type="email" maxLength={160} autoComplete="email" /></label>
      <label>{t.cadCidade}<input name="cidade" maxLength={120} autoComplete="address-level2" /></label>
      <label>{t.cadTipo}
        <select name="tipo" defaultValue="">
          <option value="">—</option>
          {t.tipos.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select>
      </label>
      <label>{t.cadDoc}<input name="documento" maxLength={30} /></label>
      <label className="largo">{t.cadMsg}<textarea name="mensagem" rows={3} maxLength={1000} /></label>
      <input name="site" tabIndex={-1} autoComplete="off" aria-hidden="true" className="armadilha" />
      {estado.erro && <div className="g-erro largo" role="alert">{estado.erro}</div>}
      <p className="g-nota largo">{t.cadAviso}</p>
      <button className="enviar largo" disabled={enviando}>{enviando ? t.enviando : t.cadEnviar}</button>
    </form>
  );
}
