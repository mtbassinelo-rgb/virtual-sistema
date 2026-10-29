import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { dinheiro, type Moeda } from "@/lib/formato";
import { chaveSincronizacao } from "@/lib/marketplace-rotas";
import { evo, whatsappInstalado } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

type Dados = {
  vendas: { vendedora: string; moeda: Moeda; n: number; total: string }[];
  marketplace: number;
  pagos: { moeda: Moeda; n: number; total: string }[];
  a_conferir: number; a_finalizar: number; a_separar: number; cde: number;
  parados: { cliente: string; vendedora: string | null; saldo: string; moeda: Moeda; dias: number }[];
};

/** Resumo do dia no WhatsApp do gerente. Chamado a cada 5 minutos pelo serviço do servidor; envia uma vez, na hora do parâmetro. */
export async function GET(req: NextRequest) {
  if (!chaveSincronizacao(req)) return new NextResponse(null, { status: 401 });
  if (!whatsappInstalado()) return NextResponse.json({ ok: true, enviado: false });
  const r = (await pool.query("select * from app.resumo_diario_pendente()")).rows[0] as
    { dia: string; numero: string; instancia: string; dados: Dados } | undefined;
  if (!r) return NextResponse.json({ ok: true, enviado: false });
  const d = r.dados;
  const [a, m, dia] = r.dia.split("-");
  const somaMoeda = (xs: { moeda: Moeda; total: string }[]) =>
    (["GS", "BRL"] as Moeda[]).map((mo) => [mo, xs.filter((x) => x.moeda === mo).reduce((s, x) => s + Number(x.total), 0)] as const)
      .filter(([, v]) => v > 0).map(([mo, v]) => dinheiro(v, mo)).join(" + ") || "—";
  const linhas = [
    `📊 *Resumo do dia ${dia}/${m}/${a}*`,
    "",
    `🛒 *Vendas:* ${d.vendas.reduce((s, x) => s + x.n, 0)} pedido(s) · ${somaMoeda(d.vendas)}`,
    ...d.vendas.map((x) => `   • ${x.vendedora}: ${x.n} · ${dinheiro(x.total, x.moeda)}`),
    ...(d.marketplace ? [`   • Shopee/ML: ${d.marketplace} pedido(s)`] : []),
    `💰 *Pagamentos informados:* ${d.pagos.reduce((s, x) => s + x.n, 0)} · ${somaMoeda(d.pagos)}`,
    "",
    "*O que falta:*",
    `   • Conferir pagamento: ${d.a_conferir}`,
    `   • Finalizar: ${d.a_finalizar}`,
    `   • Separar: ${d.a_separar}`,
    ...(d.cde ? [`   • CDE despachar pela transportadora: ${d.cde}`] : []),
    ...(d.parados.length ? ["", `⚠️ *Parados (separados há +3 dias, sem pagamento):*`,
      ...d.parados.map((x) => `   • ${x.cliente}${x.vendedora ? ` (${x.vendedora})` : ""}: falta ${dinheiro(x.saldo, x.moeda)} · ${x.dias} dias`)] : []),
    "",
    `${(process.env.APP_URL ?? "https://app.distribuidoravirtualcosmeticos.com").replace(/\/$/, "")}/pedidos`,
  ];
  try {
    await evo(`/message/sendText/${r.instancia}`, "POST", { number: r.numero, text: linhas.join("\n") });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: String((e as Error).message).slice(0, 200) });
  }
  await pool.query("select app.resumo_diario_marcar($1)", [r.dia]);
  return NextResponse.json({ ok: true, enviado: true });
}
