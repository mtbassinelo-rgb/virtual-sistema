import "server-only";

/**
 * Integração com o servidor de WhatsApp (Evolution API, conexão por QR Code, igual ao WhatsApp Web).
 * Ele roda no mesmo servidor, numa rede interna: não fica exposto na internet.
 * O número continua funcionando normalmente no celular; o sistema só recebe uma cópia das mensagens.
 */
const URL_API = process.env.WHATSAPP_API_URL ?? "";
const CHAVE_API = process.env.WHATSAPP_API_KEY ?? "";

export const whatsappInstalado = () => Boolean(URL_API && CHAVE_API);

export async function evo<T = unknown>(caminho: string, metodo: "GET" | "POST" | "DELETE" = "GET", corpo?: unknown): Promise<T> {
  if (!whatsappInstalado()) throw new Error("O WhatsApp ainda não foi instalado no servidor.");
  const r = await fetch(`${URL_API}${caminho}`, {
    method: metodo,
    headers: { apikey: CHAVE_API, "content-type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const txt = await r.text();
  let json: unknown = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { json = txt; }
  if (!r.ok) {
    const j = json as { response?: { message?: unknown }; message?: unknown } | null;
    const msg = j?.response?.message ?? j?.message ?? txt;
    throw new Error(`Servidor de WhatsApp (${r.status}): ${Array.isArray(msg) ? msg.join("; ") : String(msg).slice(0, 300)}`);
  }
  return json as T;
}

/** Configurações de cada número: não marca como lido, não fica "online" (o celular continua recebendo notificação), ignora grupos. */
export const AJUSTES_CONEXAO = {
  rejectCall: false, msgCall: "", groupsIgnore: true, alwaysOnline: false, readMessages: false, readStatus: false, syncFullHistory: true,
};

/** Cria a instância no servidor de WhatsApp, se ainda não existe, com os ajustes do sistema. */
async function garantirInstancia(instancia: string) {
  try {
    await evo("/instance/create", "POST", { instanceName: instancia, integration: "WHATSAPP-BAILEYS", qrcode: true, ...AJUSTES_CONEXAO });
  } catch (e) {
    if (!/already|in use|existe|exists|403/i.test(String((e as Error).message))) throw e;
  }
  await evo(`/settings/set/${instancia}`, "POST", AJUSTES_CONEXAO).catch(() => undefined);
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cria a instância (se ainda não existe) e devolve o QR Code em imagem (data:image/png;base64,...).
 *  O servidor às vezes demora alguns segundos para gerar o primeiro QR: tenta de novo antes de desistir. */
export async function gerarQr(instancia: string): Promise<string | null> {
  await garantirInstancia(instancia);
  for (let i = 0; i < 4; i++) {
    const r = await evo<{ base64?: string; qrcode?: { base64?: string } }>(`/instance/connect/${instancia}`);
    const b64 = r?.base64 ?? r?.qrcode?.base64 ?? null;
    if (b64) return b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
    await esperar(2500);
  }
  return null;
}

/** Entrar por código (sem câmera): o WhatsApp do celular pede um código de 8 letras em
 *  Dispositivos conectados → Conectar com número de telefone. Número com DDI (595… ou 55…). */
export async function gerarCodigo(instancia: string, numero: string): Promise<string> {
  const num = numero.replace(/\D/g, "");
  if (num.length < 10 || num.length > 15) throw new Error("Informe o número com DDI e DDD, só números. Ex.: 595981123456 ou 5545999123456.");
  await garantirInstancia(instancia);
  for (let i = 0; i < 4; i++) {
    const r = await evo<{ pairingCode?: string | null }>(`/instance/connect/${instancia}?number=${num}`);
    const c = r?.pairingCode?.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (c) return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
    await esperar(2500);
  }
  throw new Error("O servidor de WhatsApp não devolveu o código. Tente de novo em alguns segundos.");
}

/** Estado atual no servidor de WhatsApp: open (conectado), connecting, close. E o número, quando conectado. */
export async function estadoAtual(instancia: string): Promise<{ estado: string; numero: string | null } | null> {
  try {
    const r = await evo<{ instance?: { state?: string } }>(`/instance/connectionState/${instancia}`);
    const st = r?.instance?.state ?? "close";
    let numero: string | null = null;
    if (st === "open") {
      const f = await evo<Array<{ ownerJid?: string; owner?: string; instance?: { owner?: string } }>>(`/instance/fetchInstances?instanceName=${instancia}`).catch(() => []);
      const i = Array.isArray(f) ? f[0] : null;
      numero = soNumero(i?.ownerJid ?? i?.owner ?? i?.instance?.owner ?? null);
    }
    return { estado: st === "open" ? "conectado" : st === "connecting" ? "conectando" : "desconectado", numero };
  } catch (e) {
    if (/404|not exist|não existe/i.test(String((e as Error).message))) return { estado: "desconectado", numero: null };
    return null;
  }
}

function soNumero(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const d = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export type MensagemZap = { id: string; contato: string; nome: string | null; enviada: boolean; tipo: string; texto: string | null; em: number };

type Bruta = {
  key?: { id?: string; remoteJid?: string; fromMe?: boolean; remoteJidAlt?: string; senderPn?: string; participant?: string };
  pushName?: string; senderPn?: string; message?: Record<string, any> | null; messageType?: string; messageTimestamp?: unknown;
};

/** Converte uma mensagem do servidor de WhatsApp para o formato do sistema. Grupos, status, reações e avisos internos ficam de fora. */
export function converterMensagem(raw: Bruta): MensagemZap | null {
  const key = raw?.key ?? {};
  if (!key.id) return null;
  let jid = String(key.remoteJid ?? "");
  if (!jid || jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter") || jid === "status@broadcast") return null;
  if (jid.endsWith("@lid")) {
    const alt = key.remoteJidAlt ?? key.senderPn ?? raw.senderPn;
    if (alt && alt.includes("@s.whatsapp.net")) jid = alt;
  }
  const [usuario, servidor] = jid.split("@");
  const num = usuario.split(":")[0].replace(/\D/g, "");
  if (num.length < 5) return null;
  const contato = servidor === "lid" ? `lid:${num}` : num;

  let m: Record<string, any> = raw.message ?? {};
  for (let i = 0; i < 3; i++) {
    const dentro = m.ephemeralMessage?.message ?? m.viewOnceMessage?.message ?? m.viewOnceMessageV2?.message ?? m.documentWithCaptionMessage?.message ?? m.editedMessage?.message;
    if (!dentro) break;
    m = dentro;
  }
  const chave = Object.keys(m).find((k) => k !== "messageContextInfo") ?? raw.messageType ?? "";
  if (!chave || ["protocolMessage", "reactionMessage", "senderKeyDistributionMessage", "pollUpdateMessage", "keepInChatMessage"].includes(chave)) return null;

  const TIPOS: Record<string, string> = {
    conversation: "texto", extendedTextMessage: "texto", imageMessage: "imagem", audioMessage: "audio", pttMessage: "audio",
    videoMessage: "video", ptvMessage: "video", documentMessage: "documento", stickerMessage: "figurinha", locationMessage: "localizacao",
    liveLocationMessage: "localizacao", contactMessage: "contato", contactsArrayMessage: "contato", pollCreationMessage: "enquete",
    pollCreationMessageV3: "enquete", buttonsResponseMessage: "texto", listResponseMessage: "texto", templateButtonReplyMessage: "texto",
  };
  const tipo = TIPOS[chave] ?? "outro";
  const texto = m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.videoMessage?.caption
    ?? m.documentMessage?.caption ?? m.documentMessage?.fileName ?? m.buttonsResponseMessage?.selectedDisplayText
    ?? m.listResponseMessage?.title ?? m.templateButtonReplyMessage?.selectedDisplayText ?? m.contactMessage?.displayName
    ?? m.pollCreationMessage?.name ?? m.pollCreationMessageV3?.name ?? null;

  const ts = raw.messageTimestamp as unknown;
  let em = typeof ts === "object" && ts !== null ? Number((ts as { low?: number }).low ?? 0) : Number(ts ?? 0);
  if (em > 1e12) em = Math.floor(em / 1000);
  if (!Number.isFinite(em) || em <= 0) em = Math.floor(Date.now() / 1000);

  return {
    id: String(key.id), contato, enviada: Boolean(key.fromMe), tipo, em,
    nome: key.fromMe ? null : (raw.pushName?.trim() || null),
    texto: typeof texto === "string" ? texto.slice(0, 4000) : null,
  };
}

export const TIPO_MSG: Record<string, string> = {
  texto: "", imagem: "📷 Foto", audio: "🎤 Áudio", video: "🎬 Vídeo", documento: "📄 Documento", figurinha: "Figurinha",
  localizacao: "📍 Localização", contato: "👤 Contato", enquete: "Enquete", outro: "Mensagem",
};

/** Texto curto para mostrar uma mensagem na lista. */
export function resumoMsg(tipo: string, texto: string | null): string {
  const t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (tipo === "texto") return t || "—";
  return [TIPO_MSG[tipo] ?? "Mensagem", t].filter(Boolean).join(": ");
}

/** Contato legível: número formatado ou "Contato oculto" (WhatsApp às vezes esconde o número). */
export function contatoLegivel(contato: string): string {
  if (contato.startsWith("lid:")) return "Número oculto pelo WhatsApp";
  if (contato.startsWith("55") && contato.length === 13) return `+55 ${contato.slice(2, 4)} ${contato.slice(4, 9)}-${contato.slice(9)}`;
  if (contato.startsWith("55") && contato.length === 12) return `+55 ${contato.slice(2, 4)} ${contato.slice(4, 8)}-${contato.slice(8)}`;
  if (contato.startsWith("595") && contato.length === 12) return `+595 ${contato.slice(3, 6)} ${contato.slice(6)}`;
  return `+${contato}`;
}
