"use client";

import { useEffect, useRef } from "react";
import type { Banner } from "@/lib/banners-padrao";

/** Faixa de banners que passa sozinha a cada 6 s (para quando a pessoa interage ou prefere menos movimento). */
export function FaixaBanners({ banners, rotulo, acao, compacta }: { banners: Banner[]; rotulo: string; acao: string; compacta?: boolean }) {
  const trilho = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = trilho.current;
    if (!el || banners.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let parado = false;
    const parar = () => { parado = true; };
    const voltar = () => { parado = false; };
    el.addEventListener("pointerenter", parar); el.addEventListener("pointerleave", voltar);
    el.addEventListener("touchstart", parar, { passive: true });
    const t = setInterval(() => {
      if (parado || document.hidden) return;
      const fim = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      el.scrollTo({ left: fim ? 0 : el.scrollLeft + el.clientWidth, behavior: "smooth" });
    }, 6000);
    return () => { clearInterval(t); el.removeEventListener("pointerenter", parar); el.removeEventListener("pointerleave", voltar); el.removeEventListener("touchstart", parar); };
  }, [banners.length]);

  return (
    <section className={`banners ${compacta ? "banners-compacta" : ""}`} aria-label={rotulo}>
      <div className="banners-trilho" ref={trilho}>
        {banners.map((b) => {
          const conteudo = (
            <>
              {b.imagem ? <img src={b.imagem} alt="" /> : <img className="banner-icone" src="/marca/icone.png" alt="" />}
              <div className="banner-texto">
                <h2>{b.titulo}</h2>
                {b.subtitulo && <p>{b.subtitulo}</p>}
                {b.link && <span className="banner-acao">{acao}</span>}
              </div>
            </>
          );
          return b.link
            ? <a key={b.id} href={b.link} className={`banner ${b.imagem ? "com-imagem" : ""}`}>{conteudo}</a>
            : <div key={b.id} className={`banner ${b.imagem ? "com-imagem" : ""}`}>{conteudo}</div>;
        })}
      </div>
    </section>
  );
}
