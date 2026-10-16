import { pool } from "@/lib/db";
import { exigirCliente } from "@/lib/portal";
import { dinheiro, data, type Moeda } from "@/lib/formato";
import { enviarPedido } from "./acoes";

export const metadata = { title: "Catálogo" };

type Item = {
  produto_id: string; codigo: string; nome: string; fornecedor: string | null; moeda: Moeda;
  preco: string; preco_tabela: string; desconto_pct: string | null; limite_qtd: string | null;
  disponibilidade: "disponivel" | "ultimas" | "indisponivel"; disponivel_abastecedor: boolean; prazo_abastecimento: string | null;
  ja_comprou: boolean; ultima_compra: string | null; destaque: "promocao" | "recompra" | "sugestao" | null;
};

const GRUPOS: { chave: string; titulo: string; nota: string }[] = [
  { chave: "promocao", titulo: "Promoções", nota: "Por tempo limitado" },
  { chave: "recompra", titulo: "Você costuma comprar", nota: "Para repor o seu estoque" },
  { chave: "outros", titulo: "Catálogo", nota: "Todos os produtos com o seu preço" },
];

export default async function Catalogo({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { cliente, sessao } = await exigirCliente();
  const { erro } = await searchParams;
  const itens = (await pool.query("select * from app.portal_catalogo($1)", [sessao])).rows as Item[];
  const meta = (await pool.query("select * from app.portal_meta($1)", [sessao])).rows[0];
  const moeda = cliente.moeda;
  const grupo = (i: Item) => (i.destaque === "promocao" ? "promocao" : i.destaque === "recompra" ? "recompra" : "outros");
  const temAbastecimento = itens.some((i) => i.disponivel_abastecedor);
  const prazo = itens.find((i) => i.prazo_abastecimento)?.prazo_abastecimento;

  return (
    <>
      <section>
        <h1>Olá, {cliente.nome}</h1>
        <div className="suave">
          Preços {cliente.categoria === "vip" ? "VIP" : ""} em {moeda === "GS" ? "guaranis" : "reais"}. Escolha as quantidades e envie o pedido:
          sua vendedora, {cliente.vendedora}, confirma o total e envia os dados para pagamento.
        </div>
      </section>

      {meta && (
        <section className="meta-cliente">
          <b>
            {meta.meta_batida
              ? `Parabéns! Você atingiu a meta e ganhou ${dinheiro(meta.valor_premio, moeda)} em mercadorias.`
              : `Faltam ${dinheiro(meta.falta, moeda)} em compras até ${data(meta.fim)} para você ganhar ${dinheiro(meta.valor_premio, moeda)} em mercadorias.`}
          </b>
          <div className="barra"><span style={{ width: `${Math.min(100, Number(meta.percentual))}%` }} /></div>
          <span className="pequeno">{dinheiro(meta.vendido, moeda)} de {dinheiro(meta.valor_meta, moeda)} · {meta.dias_restantes} dia(s) restantes</span>
        </section>
      )}

      {erro && <div className="aviso-caixa erro" role="alert">{erro}</div>}
      {temAbastecimento && (
        <div className="aviso-caixa">
          Produtos marcados <b>&quot;pedido ao CD de Foz&quot;</b> não estão na loja agora e podem levar <b>{prazo ?? "alguns dias"}</b> para
          chegar a Ciudad del Este. Sua vendedora confirma o prazo antes de separar.
        </div>
      )}

      <form action={enviarPedido} className="coluna" style={{ gap: 18 }}>
        {GRUPOS.map((g) => {
          const lista = itens.filter((i) => grupo(i) === g.chave);
          if (lista.length === 0) return null;
          return (
            <section key={g.chave} className="coluna" style={{ gap: 10 }}>
              <div className="grupo-titulo"><h2>{g.titulo}</h2><span>{g.nota}</span></div>
              <div className="vitrine">
                {lista.map((i) => {
                  const semNada = i.disponibilidade === "indisponivel" && !i.disponivel_abastecedor;
                  return (
                    <div key={i.produto_id} className={`produto ${i.destaque === "promocao" ? "promocao" : ""} ${semNada ? "indisponivel" : ""}`}>
                      <div className="linha entre" style={{ gap: 6 }}>
                        <span className="pequeno suave">{i.fornecedor ?? ""}</span>
                        {i.desconto_pct && <span className="selo marca">-{Number(i.desconto_pct)}%</span>}
                      </div>
                      <div className="nome">{i.nome}</div>
                      <div className="preco">
                        {dinheiro(i.preco, moeda)}
                        {i.desconto_pct && <span className="riscado">{dinheiro(i.preco_tabela, moeda)}</span>}
                      </div>
                      <div className="pequeno">
                        {i.disponibilidade === "disponivel" && <span className="selo ok">Disponível</span>}
                        {i.disponibilidade === "ultimas" && <span className="selo aviso">Últimas unidades</span>}
                        {i.disponibilidade === "indisponivel" && i.disponivel_abastecedor && (
                          <span className="selo info">Pedido ao CD de Foz · {i.prazo_abastecimento}</span>
                        )}
                        {semNada && <span className="selo">Indisponível no momento</span>}
                        {i.disponibilidade === "ultimas" && i.disponivel_abastecedor && (
                          <div className="suave" style={{ marginTop: 4 }}>O que passar do estoque da loja vem do CD de Foz.</div>
                        )}
                      </div>
                      {i.ja_comprou && i.ultima_compra && <div className="pequeno suave">Última compra: {data(i.ultima_compra)}</div>}
                      {i.limite_qtd && <div className="pequeno suave">Máximo de {Number(i.limite_qtd)} por pedido</div>}
                      <label className="qtd">
                        <span>Quantidade</span>
                        <input name={`q_${i.produto_id}`} type="number" min={0} step={1} inputMode="numeric" disabled={semNada}
                               max={i.limite_qtd ? Number(i.limite_qtd) : undefined} aria-label={`Quantidade de ${i.nome}`} />
                      </label>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {itens.length === 0 && <div className="painel vazio">O catálogo ainda está sendo preparado. Fale com a sua vendedora.</div>}

        <div className="barra-pedido">
          <div className="loja-in">
            <label style={{ flex: 1, minWidth: 200 }}>
              <span className="suave">Observação (opcional)</span>
              <input name="observacao" placeholder="Ex.: entregar na sexta" />
            </label>
            <button className="principal" type="submit">Enviar pedido</button>
          </div>
        </div>
      </form>
    </>
  );
}
