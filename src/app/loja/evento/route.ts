import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { sha256, tokenCliente } from "@/lib/portal";

// Eventos do site (visita, produto no carrinho) para o funil de vendas. Sem dados pessoais: só um id anônimo do navegador.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const tipo = ["visita", "carrinho"].includes(b?.tipo) ? b.tipo : null;
    const sessao = typeof b?.sessao === "string" && /^[a-z0-9-]{8,64}$/i.test(b.sessao) ? b.sessao : null;
    if (!tipo || !sessao) return new NextResponse(null, { status: 204 });
    const produto = typeof b?.produto === "string" && /^[0-9a-f-]{36}$/i.test(b.produto) ? b.produto : null;
    const t = await tokenCliente();
    await pool.query("select app.registrar_evento_site($1, $2, $3, $4, null, null, $5)",
      [tipo, sessao, t ? sha256(t) : null, produto, typeof b?.unidade === "string" ? b.unidade.slice(0, 20) : null]);
  } catch { /* evento é opcional: nunca atrapalha o site */ }
  return new NextResponse(null, { status: 204 });
}
