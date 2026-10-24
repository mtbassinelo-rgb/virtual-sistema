import { ehGestao, usuarioAtual } from "@/lib/auth";
import { comUsuario } from "@/lib/db";

// Planilha (CSV) da loja de Ciudad del Este: todos os produtos com o preço atual de CDE (Normal e VIP)
// e o preço do Paraguai como referência. Preencha as colunas "CDE Normal (Gs)" e "CDE VIP (Gs)" e
// envie em Produtos → Preços por planilha (ou mande para o Claude lançar).
export async function GET(req: Request) {
  const u = await usuarioAtual();
  if (!u || !ehGestao(u)) return new Response("Sem permissão.", { status: 403 });
  const marca = new URL(req.url).searchParams.get("marca") || null;
  const ultimo = (t: string) => `(select valor from app.precos z where z.produto_id = p.id and z.tabela = '${t}' and z.vigente_desde <= current_date
      order by vigente_desde desc limit 1) as ${t}`;
  const rows = await comUsuario(u.id, async (c) => (await c.query(`
    select p.codigo, p.nome, coalesce(p.marca, '') as marca, p.unidades_caixa,
           coalesce((select sum(s.quantidade) from app.estoque_saldos s join app.depositos d on d.id = s.deposito_id
                      where s.produto_id = p.id and d.codigo = 'loja-cde'), 0) as estoque_cde,
           ${ultimo("py_normal")}, ${ultimo("py_vip")}, ${ultimo("cde_normal")}, ${ultimo("cde_vip")}
      from app.produtos p
     where p.ativo and not p.marketplace and p.codigo is not null and ($1::text is null or p.marca = $1)
     order by p.marca nulls last, p.nome`, [marca])).rows);
  const gs = (v: unknown) => (v == null ? "" : String(Math.round(Number(v))));
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const linhas = [
    ["Código", "Produto", "Marca", "Peças por caixa", "Estoque CDE", "Paraguai Normal (referência)", "Paraguai VIP (referência)",
      "CDE Normal (Gs)", "CDE VIP (Gs)"].map(q).join(";"),
    ...rows.map((r) => [q(r.codigo), q(r.nome), q(r.marca), r.unidades_caixa ?? "", Math.round(Number(r.estoque_cde)),
      gs(r.py_normal), gs(r.py_vip), gs(r.cde_normal), gs(r.cde_vip)].join(";")),
  ];
  return new Response("﻿" + linhas.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="precos-loja-cde-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
