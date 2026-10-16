import { pool } from "@/lib/db";
import { exigirCliente } from "@/lib/portal";
import { dinheiro, data, hojeISO, linkWhatsApp, telefone, type Moeda } from "@/lib/formato";
import { enviarComprovante } from "../acoes";
import { LimparCarrinho } from "../carrinho";

export const metadata = { title: "Meus pedidos" };

const ETAPAS: Record<string, { texto: string; cor: string }> = {
  aguardando_vendedora: { texto: "Aguardando confirmação da vendedora", cor: "aviso" },
  em_separacao: { texto: "Em separação: conferindo as quantidades", cor: "info" },
  aguardando_pagamento: { texto: "Total confirmado: aguardando pagamento", cor: "marca" },
  pago_preparando_envio: { texto: "Pago: preparando o envio", cor: "ok" },
  enviado: { texto: "Enviado", cor: "ok" },
  entregue: { texto: "Entregue", cor: "ok" },
  cancelado: { texto: "Cancelado", cor: "" },
};

type Pedido = {
  id: string; data_pedido: string; bling_numero: string | null; valor_total: string; recebido: string; a_conferir: string;
  saldo: string; moeda: Moeda; etapa: string; total_confirmado: boolean; conta_pagamento: string | null;
  previsao_envio: string | null; vencimento: string | null; observacoes: string | null;
  itens: { descricao: string; quantidade: number; pedida: number; preco: number; total: number }[];
};

export default async function MeusPedidos({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; novo?: string }> }) {
  const { sessao, cliente } = await exigirCliente();
  const avisos = await searchParams;
  const pedidos = (await pool.query("select * from app.portal_pedidos($1)", [sessao])).rows as Pedido[];

  return (
    <div className="in pagina">
      {avisos.novo && <LimparCarrinho />}
      <h1>Meus pedidos</h1>
      {avisos.erro && <div className="aviso-caixa erro" role="alert">{avisos.erro}</div>}
      {avisos.ok && <div className="aviso-caixa ok" role="status">{avisos.ok}</div>}
      {avisos.novo && pedidos[0] && (() => {
        const p = pedidos[0];
        const msg = `Olá, ${cliente.vendedora}! Sou ${cliente.nome}. Acabei de enviar este pedido pelo site:\n${p.itens.map((i) => `• ${Number(i.quantidade)}× ${i.descricao}`).join("\n")}\nTotal: ${dinheiro(p.valor_total, p.moeda)}`;
        const link = linkWhatsApp(cliente.vendedora_whatsapp, msg);
        return link ? <a className="botao whatsapp" href={link} target="_blank" rel="noopener noreferrer">Avisar no WhatsApp ({telefone(cliente.vendedora_whatsapp)})</a> : null;
      })()}
      {pedidos.length === 0 && <div className="painel vazio">Você ainda não fez pedidos por aqui.</div>}
      {pedidos.map((p) => {
        const e = ETAPAS[p.etapa] ?? { texto: p.etapa, cor: "" };
        const moeda = p.moeda;
        return (
          <section key={p.id} className="painel">
            <div className="linha entre">
              <b>Pedido de {data(p.data_pedido)}{p.bling_numero ? ` · nº ${p.bling_numero}` : ""}</b>
              <span className={`selo ${e.cor}`}>{e.texto}</span>
            </div>
            <div className="tabela">
              <table style={{ minWidth: 420 }}>
                <thead><tr><th>Produto</th><th>Qtd</th><th>Preço</th><th>Total</th></tr></thead>
                <tbody>
                  {p.itens.map((i, k) => (
                    <tr key={k}>
                      <td>{i.descricao}</td>
                      <td className="num">
                        {Number(i.quantidade)}
                        {Number(i.pedida) !== Number(i.quantidade) && <div className="pequeno suave">pedido: {Number(i.pedida)}</div>}
                      </td>
                      <td className="num">{dinheiro(i.preco, moeda)}</td>
                      <td className="num">{dinheiro(i.total, moeda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="linha entre">
              <span>Total{p.total_confirmado ? "" : " (a confirmar)"}: <b className="num">{dinheiro(p.valor_total, moeda)}</b></span>
              {p.total_confirmado && <span>Saldo: <b className="num">{dinheiro(p.saldo, moeda)}</b></span>}
              {Number(p.a_conferir) > 0 && <span className="suave">Comprovante em conferência: {dinheiro(p.a_conferir, moeda)}</span>}
              {p.previsao_envio && <span className="suave">Previsão de envio: {data(p.previsao_envio)}</span>}
            </div>

            {p.etapa === "aguardando_pagamento" && (
              <div className="aviso-caixa">
                <div><b>Dados para pagamento</b></div>
                <div style={{ whiteSpace: "pre-wrap" }}>{p.conta_pagamento}</div>
                {p.vencimento && <div className="pequeno">Vencimento: {data(p.vencimento)}</div>}
              </div>
            )}
            {p.total_confirmado && Number(p.saldo) > 0 && p.etapa !== "cancelado" && (
              <details>
                <summary>Enviar comprovante de pagamento</summary>
                <form action={enviarComprovante} className="campos" style={{ marginTop: 10 }}>
                  <input type="hidden" name="pedido_id" value={p.id} />
                  <label>Valor pago<input name="valor" inputMode="decimal" required defaultValue={Number(p.saldo) - Number(p.a_conferir) > 0 ? String(Number(p.saldo) - Number(p.a_conferir)) : ""} /></label>
                  <label>Data<input name="data" type="date" defaultValue={hojeISO()} /></label>
                  <label>Forma
                    <select name="modalidade" defaultValue="transferencia">
                      <option value="transferencia">Transferência</option><option value="deposito">Depósito</option>
                      <option value="pix">Pix</option><option value="efetivo">Efetivo</option>
                    </select>
                  </label>
                  <label className="largo">Foto ou PDF do comprovante<input name="comprovante" type="file" accept="image/*,application/pdf" required /></label>
                  <button className="principal">Enviar comprovante</button>
                </form>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
