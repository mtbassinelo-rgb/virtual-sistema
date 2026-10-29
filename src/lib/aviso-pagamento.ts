import "server-only";
import { comUsuario } from "@/lib/db";
import { dinheiro, type Moeda } from "@/lib/formato";
import { evo, whatsappInstalado } from "@/lib/whatsapp";

/**
 * Avisa o gerente no WhatsApp quando a vendedora informa um pagamento, para ele finalizar na hora.
 * O número fica em Parâmetros → aviso_pagamento_whatsapp (0 = desligado). Sai por um número já conectado
 * em WhatsApp → Conexões (de preferência um que não é de vendedora). Se algo falhar, o pagamento continua salvo.
 */
export async function avisarPagamento(uid: string, pagamentoId: string, pedidoId: string) {
  try {
    if (!whatsappInstalado()) return;
    const p = (await comUsuario(uid, (c) => c.query("select * from app.aviso_pagamento_dados($1)", [pagamentoId]))).rows[0] as
      { numero: string; instancia: string | null; cliente: string | null; vendedora: string | null; bling_numero: string | null;
        moeda: Moeda; valor: string; falta: string; comprovante: boolean } | undefined;
    if (!p || !p.instancia || !/^[0-9]{10,15}$/.test(p.numero)) return;
    const base = (process.env.APP_URL ?? "https://app.distribuidoravirtualcosmeticos.com").replace(/\/$/, "");
    const texto = [
      `💰 *Pagamento informado*${p.vendedora ? ` por ${p.vendedora}` : ""}`,
      `Cliente: ${p.cliente ?? "—"}${p.bling_numero ? ` · Pedido ${p.bling_numero}` : ""}`,
      `Valor: ${dinheiro(p.valor, p.moeda)}${p.comprovante ? " (com comprovante)" : " (sem comprovante)"}`,
      Number(p.falta) > 0 ? `Ainda falta: ${dinheiro(p.falta, p.moeda)}` : "Pedido pago ✔",
      "",
      `Conferir e finalizar: ${base}/pedidos/${pedidoId}`,
    ].join("\n");
    await evo(`/message/sendText/${p.instancia}`, "POST", { number: p.numero, text: texto });
  } catch {
    // aviso é só conveniência: não atrapalha o registro do pagamento
  }
}
