import Link from "next/link";

export const TIPO_CONTRATO: Record<string, string> = {
  clt: "CLT (carteira assinada)",
  experiencia: "Contrato de experiência",
  mei: "MEI / PJ",
  autonomo: "Autônomo",
  ips: "IPS (Paraguai)",
  contrato: "Contrato por prazo",
  estagio: "Estágio",
  informal: "Sem registro",
  outro: "Outro",
};

export const PAIS: Record<string, string> = { BR: "Brasil", PY: "Paraguai", AMBOS: "Brasil e Paraguai" };
export const TIPO_DATA: Record<string, string> = { feriado: "Feriado", comemorativa: "Data comercial", evento: "Evento" };
export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Data só (AAAA-MM-DD ou Date) em dd/mm/aaaa, sem deslocar fuso. */
export function dia(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const s = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const [a, m, x] = s.split("-");
  return `${x}/${m}/${a}`;
}
export function diaMes(d: string | Date | null | undefined): string {
  return dia(d).slice(0, 5);
}
export function iso(d: string | Date | null | undefined): string {
  if (!d) return "";
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}
/** Dias entre hoje e a data (negativo = já passou). */
export function diasAte(d: string | Date | null | undefined, hoje: string): number | null {
  if (!d) return null;
  return Math.round((Date.parse(iso(d)) - Date.parse(hoje)) / 86400000);
}
export function tempoCasa(dias: number): string {
  const anos = Math.floor(dias / 365.25);
  const meses = Math.floor((dias - anos * 365.25) / 30.44);
  if (anos === 0) return meses <= 0 ? "menos de 1 mês" : `${meses} ${meses === 1 ? "mês" : "meses"}`;
  return `${anos} ${anos === 1 ? "ano" : "anos"}${meses > 0 ? ` e ${meses} ${meses === 1 ? "mês" : "meses"}` : ""}`;
}

export function AbasRH({ atual }: { atual: string }) {
  const abas = [
    { href: "/rh", k: "painel", t: "Painel do RH" },
    { href: "/rh/funcionarios", k: "funcionarios", t: "Funcionários" },
    { href: "/rh/ferias", k: "ferias", t: "Férias" },
    { href: "/rh/aniversariantes", k: "aniversariantes", t: "Aniversariantes" },
    { href: "/calendario", k: "calendario", t: "Calendário comercial" },
  ];
  return (
    <nav className="abas" aria-label="RH">
      {abas.map((a) => <Link key={a.k} href={a.href} aria-current={a.k === atual ? "page" : undefined}>{a.t}</Link>)}
    </nav>
  );
}
