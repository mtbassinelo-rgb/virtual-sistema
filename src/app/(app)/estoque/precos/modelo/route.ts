import { ehGestao, usuarioAtual } from "@/lib/auth";
import { comUsuario } from "@/lib/db";

// Planilha (CSV) com todos os produtos e os preços atuais de cada tabela, para editar e reenviar.
export async function GET() {
  const u = await usuarioAtual();
  if (!u || !ehGestao(u)) return new Response("Sem permissão.", { status: 403 });
  const rows = await comUsuario(u.id, async (c) => (await c.query(`
    select p.codigo, p.nome, coalesce(p.fornecedor, p.marca, '') as fornecedor, p.custo, p.preco_bling, p.unidades_caixa_fornecedor as unidades_caixa,
           ${["py_normal", "py_vip", "br_normal", "br_vip"].map((t) => `
           (select valor from app.precos x where x.produto_id = p.id and x.tabela = '${t}' and x.vigente_desde <= current_date
             order by vigente_desde desc limit 1) as ${t}`).join(",")}
      from app.produtos p where p.ativo and not p.marketplace order by p.nome`)).rows);
  const br = (v: unknown) => (v == null ? "" : Number(v).toFixed(2).replace(".", ","));
  const gs = (v: unknown) => (v == null ? "" : String(Math.round(Number(v))));
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const linhas = [
    ["Código", "Produto", "Fornecedor", "Custo (R$)", "Preço Bling (R$)", "Peças por caixa", "PY Normal (Gs)", "PY VIP (Gs)", "BR Normal (R$)", "BR VIP (R$)"].map(q).join(";"),
    ...rows.map((r) => [q(r.codigo), q(r.nome), q(r.fornecedor), br(r.custo), br(r.preco_bling), r.unidades_caixa ?? "",
      gs(r.py_normal), gs(r.py_vip), br(r.br_normal), br(r.br_vip)].join(";")),
  ];
  return new Response("﻿" + linhas.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="tabela-de-precos-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
