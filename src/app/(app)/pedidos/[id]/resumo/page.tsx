import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, data, linkWhatsApp, STATUS_COMERCIAL, telefone, type Moeda } from "@/lib/formato";
import { BotaoImprimir } from "./imprimir";

export const metadata = { title: "Resumo do pedido" };

/** Caixas fechadas de um item: "2 cx" ou "1 cx + 4 un" ou só as unidades quando o produto não tem caixa. */
function caixas(qtd: number, porCaixa: number | null): string {
  if (!porCaixa || porCaixa <= 1) return `${qtd.toLocaleString("pt-BR")} un`;
  const cx = Math.floor(qtd / porCaixa);
  const resto = qtd - cx * porCaixa;
  return [cx ? `${cx} cx` : "", resto ? `${resto.toLocaleString("pt-BR")} un` : ""].filter(Boolean).join(" + ");
}

export default async function Resumo({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await comUsuario(u.id, async (c) => {
    const p = (await c.query("select * from app.v_pedidos where id = $1", [id])).rows[0];
    if (!p) return null;
    const cliente = p.cliente_id
      ? (await c.query("select nome, whatsapp, telefone, cidade from app.clientes where id = $1", [p.cliente_id])).rows[0] : null;
    const itens = (await c.query(
      `select i.codigo, i.descricao, i.quantidade, i.preco_unitario, i.total, pr.unidades_caixa
         from app.pedido_itens i left join app.produtos pr on pr.id = i.produto_id
        where i.pedido_id = $1 order by i.descricao`, [id])).rows;
    const volumes = (await c.query("select volumes from app.pedidos where id = $1", [id])).rows[0]?.volumes ?? null;
    return { p, cliente, itens, volumes };
  });
  if (!d) notFound();
  const { p, cliente, itens } = d;
  const moeda = p.moeda as Moeda;
  const totalCaixas = itens.reduce((t, i) => t + (i.unidades_caixa > 1 ? Math.floor(Number(i.quantidade) / i.unidades_caixa) : 0), 0);
  const totalPecas = itens.reduce((t, i) => t + Number(i.quantidade), 0);
  const titulo = `Pedido${p.bling_numero ? " nº " + p.bling_numero : ""} de ${data(p.data_pedido)}`;
  const texto =
    `*Virtual Cosméticos · ${titulo}*\n${cliente?.nome ?? ""}\n\n` +
    itens.map((i) => `• ${caixas(Number(i.quantidade), i.unidades_caixa)} · ${i.descricao} · ${dinheiro(i.total, moeda)} _(${dinheiro(i.preco_unitario, moeda)} un.)_`).join("\n") +
    `\n\n*Total: ${dinheiro(p.valor_total, moeda)}*` +
    (totalCaixas ? `\nCaixas: ${totalCaixas}` : "") + `\nPeças: ${totalPecas.toLocaleString("pt-BR")}` +
    (d.volumes ? `\nVolumes no envio: ${d.volumes}` : "") +
    (Number(p.saldo) > 0 && p.status_comercial !== "aguardando_cliente" ? `\nSaldo a pagar: ${dinheiro(p.saldo, moeda)}` : "") +
    (p.previsao_envio ? `\nPrevisão de envio: ${data(p.previsao_envio)}` : "");
  const whats = linkWhatsApp(cliente?.whatsapp ?? cliente?.telefone, texto);

  return (
    <>
      <nav className="linha nao-imprimir">
        <Link href={`/pedidos/${p.id}`}>← Voltar ao pedido</Link>
        <BotaoImprimir />
        {whats && <a className="botao whatsapp" href={whats} target="_blank" rel="noopener noreferrer">Enviar resumo pelo WhatsApp</a>}
      </nav>
      <article className="painel resumo-pedido">
        <header className="linha entre">
          <div className="linha">
            <img src="/marca/icone.png" width={40} height={38} alt="" />
            <div><b>Virtual Cosméticos</b><div className="pequeno suave">Distribuidora direto de fábrica · Foz do Iguaçu</div></div>
          </div>
          <div style={{ textAlign: "right" }}>
            <b>{titulo}</b>
            <div className="pequeno suave">{STATUS_COMERCIAL[p.status_comercial] ?? p.status_comercial}</div>
          </div>
        </header>
        <div className="linha entre">
          <div><span className="pequeno suave">Cliente</span><div><b>{cliente?.nome ?? "—"}</b>{cliente?.cidade ? ` · ${cliente.cidade}` : ""}</div></div>
          <div><span className="pequeno suave">Vendedora</span><div>{p.vendedora_nome}{p.vendedora_whatsapp ? ` · ${telefone(p.vendedora_whatsapp)}` : ""}</div></div>
        </div>
        <div className="tabela"><table style={{ minWidth: 0 }}>
          <thead><tr><th>Produto</th><th>Caixas</th><th>Preço un.</th><th>Total</th></tr></thead>
          <tbody>{itens.map((i, k) => (
            <tr key={k}>
              <td>{i.descricao}<div className="pequeno suave">{i.codigo}{i.unidades_caixa > 1 ? ` · caixa com ${i.unidades_caixa}` : ""}</div></td>
              <td className="num">{caixas(Number(i.quantidade), i.unidades_caixa)}</td>
              <td className="num pequeno suave">{dinheiro(i.preco_unitario, moeda)}</td>
              <td className="num"><b>{dinheiro(i.total, moeda)}</b></td>
            </tr>))}</tbody>
        </table></div>
        <section className="indicadores">
          <div className="indicador"><span className="rotulo">Total</span><span className="valor">{dinheiro(p.valor_total, moeda)}</span></div>
          {totalCaixas > 0 && <div className="indicador"><span className="rotulo">Caixas</span><span className="valor">{totalCaixas}</span></div>}
          <div className="indicador"><span className="rotulo">Peças</span><span className="valor">{totalPecas.toLocaleString("pt-BR")}</span></div>
          {d.volumes ? <div className="indicador"><span className="rotulo">Volumes no envio</span><span className="valor">{d.volumes}</span></div> : null}
          {Number(p.recebido) > 0 && <div className="indicador"><span className="rotulo">Pago</span><span className="valor">{dinheiro(p.recebido, moeda)}</span></div>}
          {Number(p.saldo) > 0 && p.status_comercial !== "aguardando_cliente" && <div className="indicador"><span className="rotulo">Saldo a pagar</span><span className="valor">{dinheiro(p.saldo, moeda)}</span></div>}
        </section>
        {p.previsao_envio && <p className="pequeno">Previsão de envio: {data(p.previsao_envio)}</p>}
      </article>
    </>
  );
}
