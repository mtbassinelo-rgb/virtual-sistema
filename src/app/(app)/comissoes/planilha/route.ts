import { ehGestao, usuarioAtual } from "@/lib/auth";
import { comUsuario } from "@/lib/db";

// Planilha (CSV) das comissões do mês, para abrir no Excel ou no Google Planilhas.
export async function GET(req: Request) {
  const u = await usuarioAtual();
  if (!u || !ehGestao(u)) return new Response("Sem permissão.", { status: 403 });
  const p = new URL(req.url).searchParams.get("mes") ?? "";
  const mes = /^\d{4}-\d{2}$/.test(p) ? p : new Date().toISOString().slice(0, 7);
  const rows = await comUsuario(u.id, async (c) => (await c.query("select * from app.comissoes(($1 || '-01')::date)", [mes])).rows);
  const num = (v: unknown, moeda: string) =>
    v == null ? "" : moeda === "GS" ? String(Math.round(Number(v))) : Number(v).toFixed(2).replace(".", ",");
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const linhas = [
    ["Mês", "Vendedora", "Moeda", "Base", "Percentual", "Vendido", "Recebido", "Lucro", "Itens sem custo", "Valor da base", "Comissão"].map(q).join(";"),
    ...rows.map((r) => [q(mes), q(r.vendedora), q(r.moeda === "GS" ? "Gs" : "R$"), q(r.base ?? "sem regra"),
      r.percentual == null ? "" : String(r.percentual).replace(".", ","),
      num(r.vendido, r.moeda), num(r.recebido, r.moeda), num(r.lucro, r.moeda), r.itens_sem_custo,
      num(r.valor_base, r.moeda), num(r.comissao, r.moeda)].join(";")),
  ];
  return new Response("﻿" + linhas.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="comissoes-${mes}.csv"`,
      "cache-control": "no-store",
    },
  });
}
