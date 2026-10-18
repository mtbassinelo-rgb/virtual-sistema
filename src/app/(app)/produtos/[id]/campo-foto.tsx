"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enviarFotoProduto } from "../acoes";

/**
 * Foto do produto: arraste a imagem, cole (Ctrl+V), clique para escolher ou informe o link.
 * Produto já cadastrado: a foto é salva na hora. Produto novo: vai junto quando clicar em Criar.
 */
export function CampoFoto({ produtoId, fotoAtual, nome }: { produtoId: string | null; fotoAtual: string | null; nome: string }) {
  const router = useRouter();
  const arquivo = useRef<HTMLInputElement>(null);
  const [previa, setPrevia] = useState<string | null>(fotoAtual);
  const [link, setLink] = useState("");
  const [linkPendente, setLinkPendente] = useState("");
  const [sobre, setSobre] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; erro?: string }>({});
  const [salvando, iniciar] = useTransition();

  function enviar(fd: FormData, previaLocal: string | null) {
    if (!produtoId) return;
    fd.set("id", produtoId);
    setMsg({});
    if (previaLocal) setPrevia(previaLocal);
    iniciar(async () => {
      const r = await enviarFotoProduto(fd);
      if (r.erro) { setMsg({ erro: r.erro }); setPrevia(fotoAtual); return; }
      setPrevia(r.foto ?? null);
      setMsg({ ok: "Foto salva. Já aparece na loja." });
      router.refresh();
    });
  }

  function usarArquivo(f: File) {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { setMsg({ erro: "Use uma foto JPG, PNG ou WEBP." }); return; }
    if (f.size > 5 * 1024 * 1024) { setMsg({ erro: "Foto grande demais: máximo 5 MB." }); return; }
    const local = URL.createObjectURL(f);
    if (produtoId) {
      const fd = new FormData(); fd.set("foto", f);
      if (arquivo.current) arquivo.current.value = "";   // já foi enviada: não manda de novo ao salvar o produto
      enviar(fd, local);
    } else {
      // produto novo: coloca o arquivo no campo do formulário principal
      const dt = new DataTransfer(); dt.items.add(f);
      if (arquivo.current) arquivo.current.files = dt.files;
      setLinkPendente(""); setPrevia(local); setMsg({ ok: "Foto pronta: ela entra quando você criar o produto." });
    }
  }

  function usarLink(l: string) {
    const v = l.trim();
    if (!/^https?:\/\//i.test(v)) { setMsg({ erro: "Cole o link completo da foto, começando com https://" }); return; }
    if (produtoId) {
      const fd = new FormData(); fd.set("foto_link", v);
      enviar(fd, null);
    } else {
      if (arquivo.current) arquivo.current.value = "";
      setLinkPendente(v); setPrevia(v); setMsg({ ok: "Link guardado: a foto é baixada quando você criar o produto." });
    }
    setLink("");
  }

  function aoSoltar(e: React.DragEvent) {
    e.preventDefault(); setSobre(false);
    const f = e.dataTransfer.files?.[0];
    if (f) return usarArquivo(f);
    // imagem arrastada de outra aba do navegador: vem como link
    const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (url) usarLink(url.split("\n")[0]);
  }

  function aoColar(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    const f = item?.getAsFile();
    if (f) { e.preventDefault(); usarArquivo(f); return; }
    const t = e.clipboardData.getData("text");
    if (/^https?:\/\//i.test(t.trim()) && (e.target as HTMLElement).tagName !== "INPUT") { e.preventDefault(); usarLink(t); }
  }

  return (
    <div className="campo-foto" onPaste={aoColar}>
      <div
        className={`soltar-foto ${sobre ? "sobre" : ""} ${salvando ? "salvando" : ""}`}
        role="button" tabIndex={0} aria-label="Escolher, arrastar ou colar a foto do produto"
        onClick={() => arquivo.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); arquivo.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
        onDragLeave={() => setSobre(false)}
        onDrop={aoSoltar}
      >
        {previa
          ? <img src={previa} alt={nome} />
          : <div className="soltar-vazio"><b>Arraste a foto aqui</b><span>ou clique para escolher · ou cole com Ctrl+V</span></div>}
        {previa && <span className="soltar-dica">{salvando ? "Salvando…" : "Arraste outra foto para trocar"}</span>}
      </div>
      <input ref={arquivo} type="file" name="foto" accept="image/jpeg,image/png,image/webp" hidden
             onChange={(e) => { const f = e.target.files?.[0]; if (f) usarArquivo(f); }} />
      <input type="hidden" name="foto_link" value={linkPendente} />
      <div className="linha" style={{ gap: 6, flexWrap: "nowrap" }}>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Ou cole o link da foto (https://…)" aria-label="Link da foto"
               onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (link) usarLink(link); } }} />
        <button type="button" onClick={() => link && usarLink(link)} disabled={!link || salvando}>Usar link</button>
      </div>
      {msg.erro && <div className="aviso-caixa erro" role="alert">{msg.erro}</div>}
      {msg.ok && <div className="aviso-caixa ok" role="status">{msg.ok}</div>}
    </div>
  );
}
