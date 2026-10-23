import { readFile } from "node:fs/promises";
import path from "node:path";
import { usuarioAtual } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { pastaArquivos } from "@/lib/arquivos";

// Print da conversa anexado na troca de produto: só para quem pode ver o pedido (a regra do banco decide).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await usuarioAtual();
  if (!u) return new Response("Faça login.", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Não encontrado.", { status: 404 });
  const t = await comUsuario(u.id, async (db) =>
    (await db.query("select arquivo, mime, nome_original from app.pedido_trocas where id = $1", [id])).rows[0]);
  if (!t) return new Response("Não encontrado.", { status: 404 });
  const nome = path.basename(String(t.arquivo));
  const bytes = await readFile(path.join(pastaArquivos(), nome));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": String(t.mime ?? "application/octet-stream"),
      "content-disposition": `inline; filename="${encodeURIComponent(String(t.nome_original ?? nome))}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
