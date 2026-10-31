import "server-only";
import type { PoolClient } from "pg";

/** Filas que esperam decisão da gerência. Cada uma tem uma seção na tela Aprovações (âncora = id). */
export type ContagemAprovacoes = {
  pagamentos: number; caixa: number; descontos: number; remocoes: number; site: number; unidade: number;
  local: number; credito: number; metas: number; transferencias: number; cadastros: number; produtos: number; fotos: number;
};

export const FILAS: { id: keyof ContagemAprovacoes; titulo: string }[] = [
  { id: "pagamentos", titulo: "Pagamentos a conferir" },
  { id: "caixa", titulo: "Transferências do caixa" },
  { id: "descontos", titulo: "Descontos por quantidade" },
  { id: "remocoes", titulo: "Tirar produto do pedido" },
  { id: "site", titulo: "Pedidos do site" },
  { id: "transferencias", titulo: "Envios entre unidades" },
  { id: "unidade", titulo: "Compra por unidade" },
  { id: "local", titulo: "Cliente local (Retire em Foz)" },
  { id: "credito", titulo: "Crédito sugerido" },
  { id: "metas", titulo: "Metas propostas" },
  { id: "cadastros", titulo: "Cadastros do site" },
  { id: "produtos", titulo: "Novos produtos" },
  { id: "fotos", titulo: "Fotos do catálogo" },
];

/** Quanto há em cada fila. Só gestão chama (as regras do banco já limitam o que cada um vê). */
export async function contarAprovacoes(c: PoolClient): Promise<ContagemAprovacoes> {
  const zero: ContagemAprovacoes = { pagamentos: 0, caixa: 0, descontos: 0, remocoes: 0, site: 0, unidade: 0, local: 0, credito: 0, metas: 0, transferencias: 0, cadastros: 0, produtos: 0, fotos: 0 };
  const r = await c.query(`select
      (select count(*) from app.pagamentos g join app.pedidos p on p.id = g.pedido_id where g.status_conferencia = 'pendente' and p.status_comercial <> 'cancelado')::int pagamentos,
      (select count(*) from app.caixa_movimentos where confirmacao = 'pendente')::int caixa,
      (select count(*) from app.pedidos where desconto_qtd_status = 'pendente' and status_comercial <> 'cancelado')::int descontos,
      (select count(*) from app.pedido_remocoes where status = 'pendente')::int remocoes,
      (select count(*) from app.pedidos where status_comercial = 'aguardando_aprovacao')::int site,
      (select count(*) from app.clientes where mesclado_em is null and compra_unidade_sugerido_em is not null and not compra_unidade and categoria_preco = 'normal')::int unidade,
      (select count(*) from app.clientes where mesclado_em is null and cliente_local_sugerido_em is not null and not cliente_local)::int "local",
      (select count(*) from app.clientes where mesclado_em is null and credito_sugestao_limite is not null)::int credito,
      (select count(*) from app.metas_cliente where status = 'proposta')::int metas,
      (select count(*) from app.transferencias where status = 'separada')::int transferencias,
      (select count(*) from app.cadastros_site where atendido_em is null)::int cadastros,
      (select count(*) from app.produtos_pendentes where status = 'pendente')::int produtos,
      (select count(*) from app.fotos_catalogo where status = 'pendente')::int fotos`).catch(() => null);
  return r ? { ...zero, ...(r.rows[0] as ContagemAprovacoes) } : zero;
}

export const totalAprovacoes = (n: ContagemAprovacoes) => Object.values(n).reduce((a, b) => a + Number(b || 0), 0);
