import { readFile } from "node:fs/promises";
import path from "node:path";
import { pastaFotos } from "@/lib/arquivos";

const TIPOS: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

// Fotos de produto: públicas (aparecem no site). O nome do arquivo muda a cada troca de foto.
export async function GET(_: Request, { params }: { params: Promise<{ arquivo: string }> }) {
  const { arquivo } = await params;
  const m = /^[0-9a-f-]{36}-[0-9]+\.(jpg|png|webp)$/.exec(arquivo);
  if (!m) return new Response("Não encontrado", { status: 404 });
  try {
    const dados = await readFile(path.join(pastaFotos(), arquivo));
    return new Response(new Uint8Array(dados), {
      headers: { "content-type": TIPOS[m[1]], "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
    });
  } catch {
    return new Response("Não encontrado", { status: 404 });
  }
}
