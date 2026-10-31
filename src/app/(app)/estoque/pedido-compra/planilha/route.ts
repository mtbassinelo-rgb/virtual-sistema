import { ehGestao, usuarioAtual } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { linhasCompra } from "../dados";

// Planilha (CSV) do pedido de compra da marca, para abrir no Excel e mandar ao fornecedor. Só o que tem quantidade.
export async function GET(req: Request) {
  const u = await usuarioAtual();
  if (!u || !ehGestao(u)) return new Response("Sem permissão.", { status: 403 });
  const marca = (new URL(req.url).searchParams.get("marca") ?? "").trim();
  if (!marca) return new Response("Escolha a marca.", { status: 400 });
  const linhas = (await comUsuario(u.id, (c) => linhasCompra(c, marca))).filter((l) => l.quantidade > 0);
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const brl = (v: number | null) => (v == null ? "" : v.toFixed(2).replace(".", ","));
  const caixas = (l: { quantidade: number; caixa: number | null }) =>
    l.caixa && l.caixa > 1 ? String(Math.round((l.quantidade / l.caixa) * 10) / 10).replace(".", ",") : "";
  const total = linhas.reduce((s, l) => s + (l.custo ?? 0) * l.quantidade, 0);
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const csv = [
    [q(`Pedido de compra ${marca}`), q(hoje)].join(";"),
    ["Código", "Produto", "Un. por caixa", "Caixas", "Quantidade (un.)", "Custo unit. sem frete (R$)", "Total (R$)"].map(q).join(";"),
    ...linhas.map((l) => [q(l.codigo), q(l.nome), l.caixa ?? "", caixas(l), l.quantidade, brl(l.custo),
      l.custo == null ? q("sem custo") : brl(l.custo * l.quantidade)].join(";")),
    ["", q("TOTAL"), "", "", linhas.reduce((s, l) => s + l.quantidade, 0), "", brl(total)].join(";"),
  ];
  const nome = `pedido-compra-${marca.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response("﻿" + csv.join("\r\n") + "\r\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${nome}"`, "cache-control": "no-store" },
  });
}
