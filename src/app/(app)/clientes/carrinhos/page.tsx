import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { dataHora, linkWhatsApp, telefone } from "@/lib/formato";
import { Avisos, Selo } from "../../avisos";

export const metadata = { title: "Carrinhos parados" };

type Linha = { cliente_id: string; cliente: string; whatsapp: string | null; vendedora: string; itens: number; pecas: string;
  produtos: string | null; atualizado_em: string; avisado_em: string | null };

async function marcarAvisado(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  let q = "ok=" + encodeURIComponent("Marcado como chamado.");
  try {
    await comUsuario(u.id, (c) => c.query("select app.marcar_carrinho_avisado($1)", [String(fd.get("cliente") ?? "")]));
  } catch (e) { q = "erro=" + encodeURIComponent(mensagemErro(e)); }
  redirect(`/clientes/carrinhos?${q}`);
}

export default async function Carrinhos({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const lista = await comUsuario(u.id, async (c) => (await c.query("select * from app.carrinhos_parados()")).rows as Linha[]);
  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Carrinhos parados</h1>
          <p>Clientes que montaram um carrinho na loja e não enviaram o pedido há mais de 2 horas. Chame no WhatsApp: muitas vezes falta só uma dúvida para fechar.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />
      {lista.length === 0 ? <div className="painel vazio">Nenhum carrinho parado agora.</div> : (
        <div className="tabela"><table>
          <thead><tr><th>Cliente</th><th>Carrinho</th><th>Atualizado</th><th>Vendedora</th><th></th></tr></thead>
          <tbody>{lista.map((l) => {
            const msg = `Olá, ${l.cliente}! Vi que você separou alguns produtos no nosso site (${l.itens} item(ns)). Posso ajudar a fechar o pedido?`;
            const zap = linkWhatsApp(l.whatsapp, msg);
            return (
              <tr key={l.cliente_id}>
                <td><Link href={`/clientes/${l.cliente_id}`}>{l.cliente}</Link><div className="pequeno suave">{telefone(l.whatsapp)}</div></td>
                <td><b>{l.itens} item(ns) · {Number(l.pecas).toLocaleString("pt-BR")} peças</b><div className="pequeno suave">{(l.produtos ?? "").slice(0, 160)}</div></td>
                <td className="num">{dataHora(l.atualizado_em)}{l.avisado_em && <div><Selo cor="ok">chamado</Selo></div>}</td>
                <td>{l.vendedora}</td>
                <td>
                  <div className="linha" style={{ gap: 6 }}>
                    {zap && <a className="botao whatsapp" href={zap} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
                    {!l.avisado_em && <form action={marcarAvisado}><input type="hidden" name="cliente" value={l.cliente_id} /><button>Já chamei</button></form>}
                  </div>
                </td>
              </tr>);
          })}</tbody>
        </table></div>
      )}
    </>
  );
}
