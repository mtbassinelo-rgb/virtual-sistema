export type Moeda = "GS" | "BRL";

export function dinheiro(valor: number | string | null | undefined, moeda: Moeda): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  const n = Number(valor);
  if (Number.isNaN(n)) return "—";
  if (moeda === "BRL") return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return "Gs " + Math.round(n).toLocaleString("pt-BR");
}

export function data(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const s = typeof d === "string" ? d : d.toISOString();
  const [a, m, dia] = s.slice(0, 10).split("-");
  return `${dia}/${m}/${a}`;
}

export function dataHora(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Asuncion" });
}

/** Data de hoje (fuso do Paraguai) no formato do campo <input type="date">. */
export function hojeISO(somarDias = 0): string {
  const d = new Date(Date.now() + somarDias * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
}

export const STATUS_COMERCIAL: Record<string, string> = {
  aguardando_cliente: "Aguardando o cliente confirmar",
  aguardando_aprovacao: "Aguardando aprovação",
  em_separacao: "Em separação",
  enviado: "Em transporte",
  aguardando_retirada: "Aguardando retirada",
  entregue: "Entregue / retirado",
  cancelado: "Cancelado",
};

export const STATUS_PAGAMENTO: Record<string, string> = {
  pago: "Pago",
  parcial: "Parcialmente pago",
  aguardando: "Aguardando pagamento",
  a_credito: "A crédito",
  atrasado: "Atrasado",
  cancelado: "Cancelado",
};

export const COR_PAGAMENTO: Record<string, string> = {
  pago: "ok",
  parcial: "info",
  aguardando: "neutro",
  a_credito: "aviso",
  atrasado: "erro",
  cancelado: "neutro",
};

export const MODALIDADES: Record<string, string> = {
  transferencia: "Transferência",
  efetivo: "Efetivo",
  pix: "Pix",
  cartao: "Cartão",
  link_pagamento: "Link de pagamento",
  deposito: "Depósito",
  repasse_marketplace: "Repasse de marketplace",
  outro: "Outro",
};

export const CONFERENCIA: Record<string, string> = {
  pendente: "A conferir",
  conferido: "Conferido",
  recusado: "Recusado",
};

export const STATUS_META: Record<string, string> = {
  proposta: "Aguardando aprovação",
  aprovada: "Em andamento",
  recusada: "Recusada",
  cancelada: "Cancelada",
  atingida: "Atingida",
  nao_atingida: "Não atingida",
  premio_entregue: "Prêmio entregue",
};

export const TIPO_ATENDIMENTO: Record<string, string> = {
  whatsapp: "WhatsApp",
  ligacao: "Ligação",
  visita: "Visita",
  reclamacao: "Reclamação",
  observacao: "Observação",
};

export const STATUS_TRANSFERENCIA: Record<string, string> = {
  rascunho: "Rascunho",
  enviada: "Enviada (em trânsito)",
  recebida: "Recebida",
  recebida_com_divergencia: "Recebida com divergência",
  cancelada: "Cancelada",
};

export const SITUACAO_DESPESA: Record<string, { texto: string; cor: string }> = {
  vencida: { texto: "Vencida", cor: "erro" },
  vence_hoje: { texto: "Vence hoje", cor: "aviso" },
  vence_7_dias: { texto: "Vence em até 7 dias", cor: "aviso" },
  a_vencer: { texto: "A vencer", cor: "info" },
  sem_vencimento: { texto: "Sem vencimento", cor: "" },
  paga: { texto: "Paga", cor: "ok" },
};

export const BASE_COMISSAO: Record<string, string> = {
  vendido: "sobre o vendido",
  recebido: "sobre o recebido (pago e conferido)",
  lucro: "sobre o lucro",
};

/** "2026-10" → "outubro de 2026" */
export function nomeMes(mes: string): string {
  return new Date(mes.slice(0, 7) + "-15T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

/** Percentual com uma casa: 0.256 → "25,6%" */
export function pct(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) return "—";
  return (Number(v) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
}

export const PERFIS: Record<string, string> = {
  dono: "Dono",
  gerente: "Gerente",
  vendedora: "Vendedora",
  estoquista: "Estoquista",
  consulta: "Consulta",
};

/** Link do WhatsApp com mensagem pronta. Abre a conversa no aparelho de quem clica. */
export function linkWhatsApp(numero: string | null | undefined, mensagem: string): string | null {
  const digitos = (numero ?? "").replace(/\D/g, "");
  if (digitos.length < 8) return null;
  return `https://wa.me/${digitos}?text=${encodeURIComponent(mensagem)}`;
}

/** 5545999972092 → +55 45 99997-2092 · 595994859971 → +595 994 859971 */
export function telefone(numero: string | null | undefined): string {
  const d = (numero ?? "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length === 13) return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.startsWith("595") && d.length === 12) return `+595 ${d.slice(3, 6)} ${d.slice(6)}`;
  return d ? `+${d}` : "";
}

export function texto(fd: FormData, campo: string): string {
  return String(fd.get(campo) ?? "").trim();
}

export function numero(fd: FormData, campo: string): number | null {
  let s = texto(fd, campo).replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");      // 1.234,56
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");    // 20.000.000
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
