import { data, dataHora } from "@/lib/formato";

export type PedidoAcomp = {
  data_pedido: string; etapa: string; total_confirmado: boolean; saldo: string;
  separado_em: string | null; enviado_em: string | null; chegou_em: string | null; entregue_em: string | null; local_retirada: string | null;
  indisponiveis: { descricao: string; pedida: number; faltou: number }[];
};

const T = {
  pt: { passos: ["Pedido recebido", "Separação (expedição)", "Pagamento", "Em transporte", "Aguardando retirada", "Retirado"],
        cancelado: "Pedido cancelado", retirarEm: "Retire em", indisp: "Não estavam disponíveis e saíram do pedido:", faltou: (f: number, p: number) => `faltaram ${f} de ${p}`,
        aguardando: "Aguardando a vendedora confirmar", pagar: "Aguardando pagamento", pago: "Pago" },
  es: { passos: ["Pedido recibido", "Preparación (depósito)", "Pago", "En transporte", "Esperando retiro", "Retirado"],
        cancelado: "Pedido cancelado", retirarEm: "Retire en", indisp: "No estaban disponibles y salieron del pedido:", faltou: (f: number, p: number) => `faltaron ${f} de ${p}`,
        aguardando: "Esperando confirmación de la vendedora", pagar: "Esperando pago", pago: "Pagado" },
};

/** Linha do tempo do pedido para o cliente: recebido → separação → pagamento → transporte → retirada → retirado. */
export function Acompanhamento({ p, idioma }: { p: PedidoAcomp; idioma: "pt" | "es" }) {
  const t = T[idioma];
  if (p.etapa === "cancelado") return <div className="acomp-cancelado">{t.cancelado}</div>;
  const pago = p.total_confirmado && Number(p.saldo) <= 0;
  const feito = [
    true,
    Boolean(p.separado_em),
    pago,
    Boolean(p.enviado_em) || ["enviado", "aguardando_retirada", "entregue"].includes(p.etapa),
    Boolean(p.chegou_em) || ["aguardando_retirada", "entregue"].includes(p.etapa),
    p.etapa === "entregue",
  ];
  const quando = [data(p.data_pedido), p.separado_em ? dataHora(p.separado_em) : null,
    pago ? t.pago : p.total_confirmado ? t.pagar : null, p.enviado_em ? data(p.enviado_em) : null,
    p.chegou_em ? dataHora(p.chegou_em) : null, p.entregue_em ? data(p.entregue_em) : null];
  const atual = feito.lastIndexOf(true) + 1;
  return (
    <div className="acomp">
      <ol className="acomp-passos">
        {t.passos.map((nome, k) => (
          <li key={nome} className={feito[k] ? "feito" : k === atual ? "atual" : ""}>
            <span className="acomp-ponto" aria-hidden="true">{feito[k] ? "✓" : k + 1}</span>
            <span className="acomp-nome">{nome}</span>
            {quando[k] && <span className="acomp-quando">{quando[k]}</span>}
            {k === 0 && p.etapa === "aguardando_vendedora" && <span className="acomp-quando">{t.aguardando}</span>}
          </li>
        ))}
      </ol>
      {p.etapa === "aguardando_retirada" && p.local_retirada && (
        <div className="acomp-retirada">📍 {t.retirarEm}: <b>{p.local_retirada}</b></div>
      )}
      {p.indisponiveis.length > 0 && (
        <div className="acomp-indisp">
          <b>{t.indisp}</b>
          <ul>{p.indisponiveis.map((x, k) => <li key={k}>{x.descricao} · {t.faltou(Number(x.faltou), Number(x.pedida))}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
