/** Situação dos pedidos entre unidades (texto e cor do selo). */
export const SITUACAO_TRANSF: Record<string, { t: string; cor: string }> = {
  solicitada: { t: "Aguardando separação", cor: "aviso" },
  separada: { t: "Aguardando aprovação", cor: "marca" },
  rascunho: { t: "Rascunho", cor: "" },
  enviada: { t: "A caminho", cor: "info" },
  recebida: { t: "Recebida", cor: "ok" },
  recebida_com_divergencia: { t: "Recebida com diferença", cor: "aviso" },
  cancelada: { t: "Cancelada", cor: "" },
};
