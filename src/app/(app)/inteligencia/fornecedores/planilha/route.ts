import { readFile } from "node:fs/promises";
import path from "node:path";
import { ehGestao, usuarioAtual } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { PLANILHA_FORNECEDORES } from "../dados";

// Planilha (Excel) do comparativo de fornecedores de cílios e unhas. Fica em arquivos/fornecedores (fora de public/), só gestão baixa.
export async function GET() {
  const u = await usuarioAtual();
  if (!u || !ehGestao(u) || !pode(u, "inteligencia")) return new Response("Sem permissão.", { status: 403 });
  try {
    const arq = await readFile(path.join(process.cwd(), "arquivos", "fornecedores", PLANILHA_FORNECEDORES.arquivo));
    return new Response(new Uint8Array(arq), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${PLANILHA_FORNECEDORES.arquivo}"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("Planilha não encontrada no servidor.", { status: 404 });
  }
}
