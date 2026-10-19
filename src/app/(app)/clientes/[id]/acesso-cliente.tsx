"use client";

import { useActionState, useState } from "react";
import { criarAcessoCliente, type RespostaAcesso } from "../acoes";

/** Documento + senha que a vendedora escolhe (em branco = o sistema sorteia 6 números). A senha aparece só agora, para enviar ao cliente. */
export function AcessoCliente({ clienteId, documento, temAcesso }: { clienteId: string; documento: string | null; temAcesso: boolean }) {
  const [r, acao, enviando] = useActionState<RespostaAcesso, FormData>(criarAcessoCliente, {});
  const [copiado, setCopiado] = useState(false);
  const zap = r.mensagem
    ? `https://wa.me/${(r.whatsapp ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(r.mensagem)}`
    : null;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <form action={acao} className="linha" style={{ alignItems: "end" }}>
        <input type="hidden" name="cliente_id" value={clienteId} />
        <label style={{ flex: 1, minWidth: 180 }}>CI, RUC, CPF ou CNPJ (vira o usuário)
          <input name="documento" defaultValue={documento ?? ""} required maxLength={30} />
        </label>
        <label style={{ flex: 1, minWidth: 180 }}>Senha (mínimo 6; em branco o sistema cria)
          <input name="senha" type="text" minLength={6} maxLength={64} autoComplete="off" placeholder="ex.: virtual2026" />
        </label>
        <button className="principal" disabled={enviando}>
          {enviando ? "Salvando…" : temAcesso ? "Definir nova senha" : "Criar acesso"}
        </button>
      </form>
      {r.erro && <div className="aviso-caixa erro" role="alert">{r.erro}</div>}
      {r.senha && (
        <div className="aviso-caixa ok" role="status" style={{ display: "grid", gap: 8 }}>
          <div><b>Acesso pronto.</b> Usuário: <b>{r.login}</b> · Senha: <b className="num" style={{ letterSpacing: 2 }}>{r.senha}</b></div>
          <div className="pequeno">A senha aparece só agora. O cliente entra direto com ela; se quiser, troca em Minha área. Não expira.</div>
          <div className="linha">
            {zap && <a className="botao whatsapp" href={zap} target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>}
            <button type="button" onClick={async () => { await navigator.clipboard.writeText(r.mensagem!); setCopiado(true); }}>
              {copiado ? "Copiado ✓" : "Copiar mensagem"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
