import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { tipoImagem } from "./arquivos";

const MAX = 5 * 1024 * 1024;

/** Endereço interno (servidor, rede local, nuvem): não buscamos fotos nesses lugares. */
function ipPrivado(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
           (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80") ||
         (x.startsWith("::ffff:") && ipPrivado(x.slice(7)));
}

async function conferirEndereco(u: URL): Promise<void> {
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("O link da foto precisa começar com http:// ou https://");
  if (u.username || u.password) throw new Error("Link de foto inválido.");
  const ips = await lookup(u.hostname, { all: true }).catch(() => { throw new Error("Não achei o site desse link. Confira o endereço."); });
  if (!ips.length || ips.some((i) => ipPrivado(i.address))) throw new Error("Esse link não pode ser usado.");
}

async function lerAte(r: Response, max: number): Promise<Buffer> {
  const partes: Uint8Array[] = []; let total = 0;
  const leitor = r.body!.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > max) { await leitor.cancel(); throw new Error("Arquivo grande demais: máximo 5 MB."); }
    partes.push(value);
  }
  return Buffer.concat(partes);
}

/** Baixa a foto de um link público (até 5 MB, JPG, PNG ou WEBP), seguindo no máximo 3 redirecionamentos. */
export async function baixarFotoDoLink(link: string): Promise<{ bytes: Buffer; ext: "jpg" | "png" | "webp" }> {
  let u: URL;
  try { u = new URL(link.trim()); } catch { throw new Error("Cole o link completo da foto (começando com https://)."); }
  for (let salto = 0; salto < 4; salto++) {
    await conferirEndereco(u);
    const r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(15000), headers: { "user-agent": "Mozilla/5.0 (VirtualCosmeticos foto)", accept: "image/*,text/html;q=0.8" } });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { u = new URL(r.headers.get("location")!, u); continue; }
    if (!r.ok || !r.body) throw new Error(`O site da foto respondeu com erro (${r.status}). Tente outro link ou baixe a foto e arraste.`);
    // link de página (loja, catálogo): usa a foto principal que a página anuncia (og:image)
    if (/text\/html/i.test(r.headers.get("content-type") ?? "")) {
      const html = (await lerAte(r, 1024 * 1024)).toString("utf8");
      const og = /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1]
              ?? /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i.exec(html)?.[1];
      if (!og) throw new Error("Esse link é de uma página sem foto principal. Abra a foto, clique com o botão direito em “Copiar endereço da imagem” e cole aqui.");
      u = new URL(og.replace(/&amp;/g, "&"), u);
      continue;
    }
    if (Number(r.headers.get("content-length") ?? 0) > MAX) throw new Error("Foto grande demais: máximo 5 MB.");
    const bytes = await lerAte(r, MAX);
    const ext = tipoImagem(bytes);
    if (!ext) throw new Error("Esse link não é de uma foto JPG, PNG ou WEBP. Abra a foto, clique com o botão direito em “Copiar endereço da imagem” e cole aqui.");
    return { bytes, ext };
  }
  throw new Error("O link redireciona demais. Use o endereço direto da imagem.");
}
