import { readFile } from "node:fs/promises";
import path from "node:path";
import { usuarioAtual } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { pastaArquivos } from "@/lib/arquivos";

// Foto de um produto pendente: só quem enviou ou a gerência (a regra do banco decide).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await usuarioAtual();
  if (!u) return new Response("Faça login.", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Não encontrado.", { status: 404 });
  const p = await comUsuario(u.id, async (db) => (await db.query("select foto, foto_mime from app.produtos_pendentes where id = $1", [id])).rows[0]);
  if (!p?.foto) return new Response("Não encontrado.", { status: 404 });
  const bytes = await readFile(path.join(pastaArquivos(), path.basename(String(p.foto))));
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": String(p.foto_mime ?? "image/jpeg"), "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
  });
}
