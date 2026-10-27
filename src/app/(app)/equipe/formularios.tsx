"use client";

import { useActionState, useState } from "react";
import { convidarPessoa, definirSenha, gerarLinkSenha, type RespostaLink } from "./acoes";

/** Mostra o link uma única vez, com botão de copiar e de enviar pelo WhatsApp. */
function LinkGerado({ r }: { r: RespostaLink }) {
  const [copiado, setCopiado] = useState(false);
  if (r.erro) return <div className="aviso-caixa erro" role="alert">{r.erro}</div>;
  if (r.senha) return <SenhaDefinida r={r} />;
  if (!r.link) return null;
  const msg = `Olá${r.nome ? ", " + r.nome.split(" ")[0] : ""}! Este é o seu link para criar a senha do sistema da Virtual Cosméticos (vale 72 horas, uma única vez): ${r.link}`;
  return (
    <div className="aviso-caixa ok" role="status" style={{ display: "grid", gap: 8 }}>
      <div>Link criado{r.nome ? ` para ${r.nome}` : ""}. Ele aparece só agora: copie e mande só para a pessoa.</div>
      <input readOnly value={r.link} onFocus={(e) => e.currentTarget.select()} aria-label="Link de nova senha" />
      <div className="linha">
        <button type="button" onClick={async () => { await navigator.clipboard.writeText(r.link!); setCopiado(true); }}>{copiado ? "Copiado ✓" : "Copiar link"}</button>
        <a className="botao whatsapp" href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>
      </div>
    </div>
  );
}

/** Mostra o login e a senha provisória para mandar à pessoa. */
function SenhaDefinida({ r }: { r: RespostaLink }) {
  const [copiado, setCopiado] = useState(false);
  const site = typeof window !== "undefined" ? window.location.origin : "";
  const msg = `Olá${r.nome ? ", " + r.nome.split(" ")[0] : ""}! Seu acesso ao sistema da Virtual Cosméticos:\n${site}/login\nUsuário: ${r.email}\nSenha: ${r.senha}\nDepois de entrar, você pode trocar a senha em Minha conta.`;
  return (
    <div className="aviso-caixa ok" role="status" style={{ display: "grid", gap: 8 }}>
      <div>Pronto. {r.nome ? `${r.nome} já pode entrar` : "Já pode entrar"} com:</div>
      <div><b>Usuário:</b> {r.email}<br /><b>Senha:</b> {r.senha}</div>
      <div className="linha">
        <button type="button" onClick={async () => { await navigator.clipboard.writeText(msg); setCopiado(true); }}>{copiado ? "Copiado ✓" : "Copiar dados de acesso"}</button>
        <a className="botao whatsapp" href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>
      </div>
    </div>
  );
}

export function NovaPessoa({ dono, vendedoras }: { dono: boolean; vendedoras: { id: string; nome: string }[] }) {
  const [r, acao, enviando] = useActionState<RespostaLink, FormData>(convidarPessoa, {});
  const [perfil, setPerfil] = useState("vendedora");
  return (
    <form action={acao} className="painel campos">
      <h2 className="largo">Adicionar pessoa</h2>
      <label>Nome<input name="nome" required maxLength={120} /></label>
      <label>E-mail (vira o usuário)<input name="email" type="email" required maxLength={160} /></label>
      <label>Perfil
        <select name="perfil" value={perfil} onChange={(e) => setPerfil(e.target.value)}>
          <option value="vendedora">Vendedora</option>
          <option value="estoquista">Estoquista</option>
          <option value="gerente">Gerente</option>
          <option value="consulta">Consulta (só vê)</option>
          {dono && <option value="dono">Dono</option>}
        </select>
      </label>
      {perfil === "vendedora" && (
        <label>Qual vendedora
          <select name="vendedora" required defaultValue="">
            <option value="" disabled>Escolha</option>
            {vendedoras.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
          </select>
        </label>
      )}
      <label>Senha provisória (opcional)<input name="senha" type="text" autoComplete="off" minLength={6} maxLength={100} placeholder="Ex.: Virtual2026" /></label>
      <p className="pequeno suave largo" style={{ margin: 0 }}>Com senha: a pessoa já entra com o e-mail e esta senha e troca depois em Minha conta, se quiser.
        Sem senha: o sistema gera um link para ela criar a própria senha.</p>
      <div className="largo"><button className="principal" disabled={enviando}>{enviando ? "Criando…" : "Criar acesso"}</button></div>
      <div className="largo"><LinkGerado r={r} /></div>
    </form>
  );
}

export function BotaoLinkSenha({ id, nome, temSenha }: { id: string; nome: string; temSenha: boolean }) {
  const [r, acao, enviando] = useActionState<RespostaLink, FormData>(gerarLinkSenha, {});
  const [rs, acaoSenha, definindo] = useActionState<RespostaLink, FormData>(definirSenha, {});
  return (
    <div style={{ display: "grid", gap: 8 }}>
    <form action={acaoSenha} className="linha" style={{ gap: 6 }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="nome" value={nome} />
      <input name="senha" type="text" autoComplete="off" minLength={6} maxLength={100} required placeholder="Senha provisória" aria-label={`Senha provisória de ${nome}`} style={{ width: 150 }} />
      <button className="principal" disabled={definindo}>{definindo ? "Salvando…" : "Definir senha"}</button>
    </form>
    <LinkGerado r={rs} />
    <form action={acao} style={{ display: "grid", gap: 8 }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="nome" value={nome} />
      <div><button disabled={enviando}>{enviando ? "Gerando…" : temSenha ? "Link de nova senha" : "Gerar link de acesso"}</button></div>
      <LinkGerado r={r} />
    </form>
    </div>
  );
}
