import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { pool } from "@/lib/db";
import { converterMensagem, type MensagemZap } from "@/lib/whatsapp";

/**
 * Recebe os avisos do servidor de WhatsApp (mensagens novas, histórico, QR Code e conexão).
 * Só aceita quem envia a chave secreta (WHATSAPP_WEBHOOK_SEGREDO), que o servidor de WhatsApp recebe pela configuração.
 */
export const dynamic = "force-dynamic";

function chaveCerta(req: NextRequest): boolean {
  const segredo = process.env.WHATSAPP_WEBHOOK_SEGREDO ?? "";
  const veio = req.nextUrl.searchParams.get("chave") ?? req.headers.get("x-chave") ?? "";
  if (segredo.length < 16 || veio.length !== segredo.length) return false;
  return timingSafeEqual(Buffer.from(veio), Buffer.from(segredo));
}

function lista(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const d = data as { messages?: unknown; key?: unknown } | null;
  if (d && Array.isArray(d.messages)) return d.messages;
  if (d && d.key) return [d];
  return [];
}

export async function POST(req: NextRequest) {
  if (!chaveCerta(req)) return new NextResponse(null, { status: 401 });
  try {
    const b = await req.json();
    const evento = String(b?.event ?? "").toLowerCase().replace(/_/g, ".");
    const instancia = String(b?.instance ?? b?.instanceName ?? "");
    if (!instancia) return NextResponse.json({ ok: true });
    const data = b?.data;

    if (evento === "messages.upsert" || evento === "messages.set" || evento === "send.message") {
      const msgs = lista(data).map((m) => converterMensagem(m as Parameters<typeof converterMensagem>[0])).filter(Boolean) as MensagemZap[];
      for (let i = 0; i < msgs.length; i += 500) {
        await pool.query("select app.whatsapp_registrar($1, $2::jsonb)", [instancia, JSON.stringify(msgs.slice(i, i + 500))]);
      }
    } else if (evento === "qrcode.updated") {
      const b64 = data?.qrcode?.base64 ?? data?.base64 ?? null;
      if (b64) await pool.query("select app.whatsapp_estado($1, 'aguardando_qr', null, $2)",
        [instancia, String(b64).startsWith("data:") ? b64 : `data:image/png;base64,${b64}`]);
    } else if (evento === "connection.update") {
      const st = String(data?.state ?? "");
      const estado = st === "open" ? "conectado" : st === "connecting" ? "conectando" : st === "close" ? "desconectado" : null;
      const numero = String(data?.wuid ?? b?.sender ?? "").split("@")[0].split(":")[0];
      if (estado) await pool.query("select app.whatsapp_estado($1, $2, $3, null)", [instancia, estado, estado === "conectado" ? numero : null]);
    }
  } catch (e) {
    console.error("Webhook do WhatsApp:", (e as Error).message);
  }
  // sempre 200: se der erro aqui, o servidor de WhatsApp não fica reenviando sem parar
  return NextResponse.json({ ok: true });
}
