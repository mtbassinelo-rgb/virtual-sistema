import { readFile } from "node:fs/promises";
import path from "node:path";
import { ehGestao, usuarioAtual } from "@/lib/auth";
import { pastaFotosCatalogo } from "@/lib/arquivos";

// Fotos candidatas do catálogo: só gerente ou dono vê (ainda não estão no site).
export async function GET(_: Request, { params }: { params: Promise<{ arquivo: string }> }) {
  const u = await usuarioAtual();
  if (!u || !ehGestao(u)) return new Response("Sem permissão.", { status: 403 });
  const { arquivo } = await params;
  if (!/^p[0-9]{2}-[0-9]{2}\.webp$/.test(arquivo)) return new Response("Não encontrado", { status: 404 });
  try {
    const dados = await readFile(path.join(pastaFotosCatalogo(), arquivo));
    return new Response(new Uint8Array(dados), {
      headers: { "content-type": "image/webp", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" },
    });
  } catch {
    return new Response("Não encontrado", { status: 404 });
  }
}
