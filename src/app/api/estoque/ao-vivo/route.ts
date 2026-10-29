import type { NextRequest } from "next/server";
import { usuarioAtual } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { cartaoFila, ouvirFila, type AvisoFila } from "@/lib/marketplace-fila";
import { pode } from "@/lib/permissoes";

/**
 * Canal ao vivo da área do estoquista (Server-Sent Events).
 * Eventos: "pedido" {evento, pedido}, "sincronizar" (recarregar a lista: a conexão com o banco caiu e voltou).
 * Cada pedido é lido com o usuário logado (RLS): estoquista só recebe os pedidos do estoque em que trabalha.
 * Fecha sozinho a cada 30 min; o navegador reconecta e a sessão é conferida de novo.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const u = await usuarioAtual();
  if (!u || !pode(u, "separacao")) return new Response(null, { status: 401 });
  const deposito = req.nextUrl.searchParams.get("deposito");
  const enc = new TextEncoder();
  let encerrar = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(ctl) {
      let aberto = true;
      const escrever = (t: string) => { if (aberto) try { ctl.enqueue(enc.encode(t)); } catch { aberto = false; } };
      const enviar = (evento: string, dados: unknown) => escrever(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);

      const tirar = await ouvirFila(async (a: AvisoFila) => {
        if (a.tipo === "reconectou") return enviar("sincronizar", {});
        try {
          const pedido = await comUsuario(u.id, (c) => cartaoFila(c, a.id));
          if (!pedido || (deposito && pedido.deposito_id !== deposito)) return; // de outro estoque / outra unidade aberta na tela
          enviar("pedido", { evento: a.evento, pedido });
        } catch (e) {
          console.error("Ao vivo:", (e as Error).message);
        }
      });
      const batida = setInterval(() => escrever(": ping\n\n"), 25_000); // mantém a conexão aberta no Caddy e no navegador
      const limite = setTimeout(() => encerrar(), 30 * 60_000);
      encerrar = () => {
        if (!aberto) return;
        aberto = false; clearInterval(batida); clearTimeout(limite); tirar();
        try { ctl.close(); } catch { /* já fechado */ }
      };
      req.signal.addEventListener("abort", () => encerrar());
      escrever("retry: 3000\n\n");
      enviar("pronto", { em: new Date().toISOString() });
    },
    cancel() { encerrar(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
