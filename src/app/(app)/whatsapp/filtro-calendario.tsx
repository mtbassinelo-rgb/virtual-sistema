"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Filtro de período com calendário: atalhos (hoje, ontem, 7/30/90 dias, este mês, mês passado),
 * um dia específico ou um intervalo De/Até. Mantém os outros filtros da página.
 */
const fuso = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
const somar = (dias: number) => fuso(new Date(Date.now() + dias * 86400000));

function atalhos(): { t: string; de: string; ate: string }[] {
  const hoje = somar(0);
  const [a, m] = hoje.split("-").map(Number);
  const iniMes = `${a}-${String(m).padStart(2, "0")}-01`;
  const pa = m === 1 ? a - 1 : a, pm = m === 1 ? 12 : m - 1;
  const iniPassado = `${pa}-${String(pm).padStart(2, "0")}-01`;
  const fimPassado = fuso(new Date(Date.UTC(a, m - 1, 0, 12)));
  return [
    { t: "Hoje", de: hoje, ate: hoje },
    { t: "Ontem", de: somar(-1), ate: somar(-1) },
    { t: "7 dias", de: somar(-6), ate: hoje },
    { t: "30 dias", de: somar(-29), ate: hoje },
    { t: "90 dias", de: somar(-89), ate: hoje },
    { t: "Este mês", de: iniMes, ate: hoje },
    { t: "Mês passado", de: iniPassado, ate: fimPassado },
  ];
}

export function FiltroCalendario({ caminho, de, ate, manter }: { caminho: string; de: string; ate: string; manter: Record<string, string | undefined> }) {
  const router = useRouter();
  const [d1, setD1] = useState(de);
  const [d2, setD2] = useState(ate);
  const ir = (a: string, b: string) => {
    if (!a) return;
    const [x, y] = b && b < a ? [b, a] : [a, b || a];
    const s = new URLSearchParams();
    Object.entries(manter).forEach(([k, v]) => { if (v !== undefined && v !== null) s.set(k, v); });
    s.set("de", x); s.set("ate", y);
    router.push(`${caminho}?${s}`);
  };
  const lista = atalhos();
  const fmt = (s: string) => s.split("-").reverse().join("/");

  return (
    <section className="painel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <nav className="filtros" aria-label="Período">
        {lista.map((p) => (
          <a key={p.t} href="#" className={p.de === de && p.ate === ate ? "ativo" : ""}
            onClick={(e) => { e.preventDefault(); setD1(p.de); setD2(p.ate); ir(p.de, p.ate); }}>{p.t}</a>
        ))}
      </nav>
      <div className="linha" style={{ gap: 16, alignItems: "flex-end" }}>
        <label className="pequeno">Um dia
          <input type="date" value={d1 === d2 ? d1 : ""} max={somar(0)}
            onChange={(e) => { const v = e.target.value; if (v) { setD1(v); setD2(v); ir(v, v); } }} />
        </label>
        <span className="pequeno suave" style={{ paddingBottom: 8 }}>ou</span>
        <form className="linha" style={{ gap: 8, alignItems: "flex-end" }} onSubmit={(e) => { e.preventDefault(); ir(d1, d2); }}>
          <label className="pequeno">De<input type="date" value={d1} max={somar(0)} onChange={(e) => setD1(e.target.value)} required /></label>
          <label className="pequeno">Até<input type="date" value={d2} max={somar(0)} onChange={(e) => setD2(e.target.value)} /></label>
          <button className="principal">Ver intervalo</button>
        </form>
        <span className="pequeno suave" style={{ paddingBottom: 8 }}>Mostrando: <b>{de === ate ? fmt(de) : `${fmt(de)} a ${fmt(ate)}`}</b></span>
      </div>
    </section>
  );
}
