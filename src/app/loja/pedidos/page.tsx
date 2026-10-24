import { pool } from "@/lib/db";
import { exigirCliente } from "@/lib/portal";
import { dinheiro, data, hojeISO, linkWhatsApp, telefone, type Moeda } from "@/lib/formato";
import { enviarComprovante } from "../acoes";
import { LimparCarrinho, RepetirPedido } from "../carrinho";
import { Acompanhamento, type PedidoAcomp } from "../acompanhamento";
import { idiomaAtual } from "@/lib/idioma";

export const metadata = { title: "Meus pedidos" };

const TX = {
  pt: {
    titulo: "Meus pedidos", vazio: "Você ainda não fez pedidos por aqui.", andamento: "Em andamento", pagar: "Para pagar", saldo: "Saldo em aberto",
    pedidoDe: "Pedido de", itens: (n: number) => `${n} produto(s)`, verItens: "Ver produtos", produto: "Produto", qtd: "Qtd", preco: "Preço", total: "Total",
    aConfirmar: " (a confirmar)", saldoL: "Saldo", conferencia: "Comprovante em conferência", previsao: "Previsão de envio",
    dadosPag: "Dados para pagamento", venc: "Vencimento", enviarComp: "Enviar comprovante de pagamento", valorPago: "Valor pago", data: "Data", forma: "Forma",
    arquivo: "Foto ou PDF do comprovante", enviar: "Enviar comprovante", pedidoPor: "pedido",
    formas: { transferencia: "Transferência", deposito: "Depósito", pix: "Pix", efetivo: "Dinheiro" } as Record<string, string>,
    avisar: "Avisar no WhatsApp", repetir: "Pedir de novo", nada: "Nenhum produto disponível", proximo: "O que falta",
    etapas: {
      aguardando_cliente: ["Esperando você confirmar as caixas", "aviso", "Confira o pedido no link que a vendedora enviou e confirme."],
      aguardando_vendedora: ["Aguardando confirmação da vendedora", "aviso", "A vendedora vai conferir e confirmar o seu pedido."],
      em_separacao: ["Em separação", "info", "Estamos separando. Se faltar algo, a vendedora fala com você."],
      aguardando_pagamento: ["Aguardando pagamento", "marca", "Pague com os dados abaixo e envie o comprovante aqui."],
      pago_preparando_envio: ["Pago: preparando o envio", "ok", "Pagamento recebido. Já estamos preparando o envio."],
      enviado: ["Em transporte", "info", "Seu pedido está a caminho."],
      aguardando_retirada: ["Aguardando retirada", "ok", "Seu pedido chegou e está pronto para retirar."],
      entregue: ["Retirado / entregue", "ok", ""],
      cancelado: ["Cancelado", "", ""],
    } as Record<string, [string, string, string]>,
  },
  es: {
    titulo: "Mis pedidos", vazio: "Todavía no hizo pedidos por aquí.", andamento: "En curso", pagar: "Para pagar", saldo: "Saldo pendiente",
    pedidoDe: "Pedido del", itens: (n: number) => `${n} producto(s)`, verItens: "Ver productos", produto: "Producto", qtd: "Cant.", preco: "Precio", total: "Total",
    aConfirmar: " (a confirmar)", saldoL: "Saldo", conferencia: "Comprobante en revisión", previsao: "Previsión de envío",
    dadosPag: "Datos para el pago", venc: "Vencimiento", enviarComp: "Enviar comprobante de pago", valorPago: "Monto pagado", data: "Fecha", forma: "Forma",
    arquivo: "Foto o PDF del comprobante", enviar: "Enviar comprobante", pedidoPor: "pedido",
    formas: { transferencia: "Transferencia", deposito: "Depósito", pix: "Pix", efetivo: "Efectivo" } as Record<string, string>,
    avisar: "Avisar por WhatsApp", repetir: "Pedir de nuevo", nada: "Ningún producto disponible", proximo: "Qué falta",
    etapas: {
      aguardando_cliente: ["Esperando que confirme las cajas", "aviso", "Revise el pedido en el link que le envió la vendedora y confirme."],
      aguardando_vendedora: ["Esperando confirmación de la vendedora", "aviso", "La vendedora va a revisar y confirmar su pedido."],
      em_separacao: ["En preparación", "info", "Estamos preparando su pedido. Si falta algo, la vendedora le avisa."],
      aguardando_pagamento: ["Esperando pago", "marca", "Pague con los datos de abajo y envíe el comprobante aquí."],
      pago_preparando_envio: ["Pagado: preparando el envío", "ok", "Pago recibido. Ya estamos preparando el envío."],
      enviado: ["En transporte", "info", "Su pedido está en camino."],
      aguardando_retirada: ["Esperando retiro", "ok", "Su pedido llegó y está listo para retirar."],
      entregue: ["Retirado / entregado", "ok", ""],
      cancelado: ["Cancelado", "", ""],
    } as Record<string, [string, string, string]>,
  },
};

type Pedido = {
  id: string; data_pedido: string; bling_numero: string | null; valor_total: string; recebido: string; a_conferir: string;
  saldo: string; moeda: Moeda; etapa: string; total_confirmado: boolean; conta_pagamento: string | null;
  previsao_envio: string | null; vencimento: string | null; observacoes: string | null;
  itens: { descricao: string; quantidade: number; pedida: number; preco: number; total: number }[];
} & PedidoAcomp;

export default async function MeusPedidos({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; novo?: string }> }) {
  const { sessao, cliente } = await exigirCliente();
  const avisos = await searchParams;
  const pedidos = (await pool.query("select * from app.portal_pedidos($1)", [sessao])).rows as Pedido[];
  const idioma = await idiomaAtual();

  const t = TX[idioma];
  const abertos = pedidos.filter((p) => !["entregue", "cancelado"].includes(p.etapa));
  const aPagar = pedidos.filter((p) => p.etapa === "aguardando_pagamento");
  const saldos = new Map<Moeda, number>();
  for (const p of pedidos) if (p.total_confirmado && p.etapa !== "cancelado" && Number(p.saldo) > 0) saldos.set(p.moeda, (saldos.get(p.moeda) ?? 0) + Number(p.saldo));

  return (
    <div className="in pagina">
      {avisos.novo && <LimparCarrinho />}
      <h1>{t.titulo}</h1>
      {avisos.erro && <div className="aviso-caixa erro" role="alert">{avisos.erro}</div>}
      {avisos.ok && <div className="aviso-caixa ok" role="status">{avisos.ok}</div>}
      {avisos.novo && pedidos[0] && (() => {
        const p = pedidos[0];
        const msg = `Olá, ${cliente.vendedora}! Sou ${cliente.nome}. Acabei de enviar este pedido pelo site:\n${p.itens.map((i) => `• ${Number(i.quantidade)}× ${i.descricao}`).join("\n")}\nTotal: ${dinheiro(p.valor_total, p.moeda)}`;
        const link = linkWhatsApp(cliente.vendedora_whatsapp, msg);
        return link ? <a className="botao whatsapp" href={link} target="_blank" rel="noopener noreferrer">{t.avisar} ({telefone(cliente.vendedora_whatsapp)})</a> : null;
      })()}
      {pedidos.length > 0 && (
        <div className="meus-resumo">
          <div><span>{t.andamento}</span><b>{abertos.length}</b></div>
          <div className={aPagar.length ? "alerta" : ""}><span>{t.pagar}</span><b>{aPagar.length}</b></div>
          {[...saldos.entries()].map(([m, v]) => <div key={m}><span>{t.saldo}</span><b className="num">{dinheiro(v, m)}</b></div>)}
        </div>
      )}
      {pedidos.length === 0 && <div className="painel vazio">{t.vazio}</div>}
      {pedidos.map((p) => {
        const [texto, cor, dica] = t.etapas[p.etapa] ?? [p.etapa, "", ""];
        const moeda = p.moeda;
        const pecas = p.itens.reduce((s, i) => s + Number(i.quantidade), 0);
        return (
          <section key={p.id} className={`painel pedido-cliente ${cor}`}>
            <div className="linha entre">
              <div>
                <b className="pedido-titulo">{t.pedidoDe} {data(p.data_pedido)}{p.bling_numero ? ` · nº ${p.bling_numero}` : ""}</b>
                <div className="pequeno suave">{t.itens(p.itens.length)} · {pecas} un</div>
              </div>
              <div className="pedido-valor">
                <span className={`selo ${cor}`}>{texto}</span>
                <b className="num">{dinheiro(p.valor_total, moeda)}</b>
                {!p.total_confirmado && p.etapa !== "cancelado" && <small className="suave">{t.aConfirmar.trim()}</small>}
              </div>
            </div>
            {dica && <div className={`pedido-dica ${cor}`}><span>{t.proximo}</span>{dica}</div>}
            <Acompanhamento p={p} idioma={idioma} />

            {p.etapa === "aguardando_pagamento" && (
              <div className="aviso-caixa pagamento-caixa">
                <div><b>{t.dadosPag}</b></div>
                <div style={{ whiteSpace: "pre-wrap" }}>{p.conta_pagamento}</div>
                {p.vencimento && <div className="pequeno">{t.venc}: {data(p.vencimento)}</div>}
              </div>
            )}
            {p.total_confirmado && Number(p.saldo) > 0 && p.etapa !== "cancelado" && (
              <details open={p.etapa === "aguardando_pagamento" && Number(p.a_conferir) === 0}>
                <summary><b>{t.enviarComp}</b></summary>
                <form action={enviarComprovante} className="campos" style={{ marginTop: 10 }}>
                  <input type="hidden" name="pedido_id" value={p.id} />
                  <label>{t.valorPago}<input name="valor" inputMode="decimal" required defaultValue={Number(p.saldo) - Number(p.a_conferir) > 0 ? String(Number(p.saldo) - Number(p.a_conferir)) : ""} /></label>
                  <label>{t.data}<input name="data" type="date" defaultValue={hojeISO()} /></label>
                  <label>{t.forma}
                    <select name="modalidade" defaultValue="transferencia">
                      {Object.entries(t.formas).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                  <label className="largo">{t.arquivo}<input name="comprovante" type="file" accept="image/*,application/pdf" required /></label>
                  <button className="principal">{t.enviar}</button>
                </form>
              </details>
            )}

            <details className="pedido-itens">
              <summary>{t.verItens} ({p.itens.length})</summary>
              <div className="tabela" style={{ marginTop: 8 }}>
                <table style={{ minWidth: 420 }}>
                  <thead><tr><th>{t.produto}</th><th>{t.qtd}</th><th>{t.preco}</th><th>{t.total}</th></tr></thead>
                  <tbody>
                    {p.itens.map((i, k) => (
                      <tr key={k}>
                        <td>{i.descricao}</td>
                        <td className="num">
                          {Number(i.quantidade)}
                          {Number(i.pedida) !== Number(i.quantidade) && <div className="pequeno suave">{t.pedidoPor}: {Number(i.pedida)}</div>}
                        </td>
                        <td className="num">{dinheiro(i.preco, moeda)}</td>
                        <td className="num">{dinheiro(i.total, moeda)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <div className="linha entre pequeno">
              <span className="linha" style={{ gap: 14 }}>
                {p.total_confirmado && <span>{t.saldoL}: <b className="num">{dinheiro(p.saldo, moeda)}</b></span>}
                {Number(p.a_conferir) > 0 && <span className="suave">{t.conferencia}: {dinheiro(p.a_conferir, moeda)}</span>}
                {p.previsao_envio && <span className="suave">{t.previsao}: {data(p.previsao_envio)}</span>}
              </span>
              <RepetirPedido pedidoId={p.id} rotulo={t.repetir} vazio={t.nada} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
