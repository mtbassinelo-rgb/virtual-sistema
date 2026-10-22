import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, dinheiro, hojeISO, linkWhatsApp, type Moeda } from "@/lib/formato";
import { Avisos, Selo } from "../../avisos";
import { Imprimir } from "../../estoque/transferencias/[id]/imprimir";
import { cancelarOrcamento, converterOrcamento, vincularOrcamento } from "../acoes";

export const metadata = { title: "Orçamento" };

export default async function Orcamento({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const { id } = await params;
  const f = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await comUsuario(u.id, async (c) => {
    const o = (await c.query(`select o.*, t.moeda, t.nome tabela_nome, t.pais, cl.nome cliente_nome, cl.whatsapp cliente_whatsapp, v.nome vendedora, dp.nome deposito
      from app.orcamentos o join app.tabelas_preco t on t.codigo = o.tabela left join app.clientes cl on cl.id = o.cliente_id
      left join app.vendedoras v on v.id = o.vendedora_id left join app.depositos dp on dp.id = o.deposito_id where o.id = $1`, [id])).rows[0];
    if (!o) return null;
    const itens = (await c.query(`select i.*, p.codigo, p.unidades_caixa from app.orcamento_itens i join app.produtos p on p.id = i.produto_id
      where i.orcamento_id = $1 order by i.ordem`, [id])).rows;
    const clientes = o.status === "aberto" ? (await c.query(`select id, nome from app.clientes where mesclado_em is null and ativo order by nome`)).rows : [];
    const depositos = (await c.query(ehGestao(u) ? "select id, nome from app.depositos where ativo order by nome"
      : `select d.id, d.nome from app.depositos d join app.vendedora_depositos vd on vd.deposito_id = d.id where vd.vendedora_id = $1 and d.ativo order by vd.padrao desc`,
      ehGestao(u) ? [] : [u.vendedora_id])).rows;
    return { o, itens, clientes, depositos };
  });
  if (!d) notFound();
  const { o, itens } = d;
  const m = o.moeda as Moeda;
  const semPreco = itens.filter((i) => i.preco_unitario == null);
  const para = o.cliente_nome ?? o.contato_nome;
  const es = o.pais === "PY";
  const texto = [
    es ? `Hola ${para}! Presupuesto Nº ${o.numero} de Virtual Cosméticos:` : `Olá ${para}! Orçamento nº ${o.numero} da Virtual Cosméticos:`,
    "",
    ...itens.map((i) => `${Number(i.quantidade)} × ${i.descricao}${i.preco_unitario != null ? ` — ${dinheiro(i.preco_unitario, m)} = ${dinheiro(Number(i.quantidade) * Number(i.preco_unitario), m)}` : ""}`),
    "",
    `${es ? "Total" : "Total"}: ${dinheiro(o.total, m)}`,
    o.validade ? (es ? `Válido hasta ${data(o.validade)}.` : `Válido até ${data(o.validade)}.`) : "",
    o.observacoes ?? "",
  ].filter((x, k, a) => x !== "" || (k > 0 && a[k - 1] !== "")).join("\n");
  const zap = linkWhatsApp(o.cliente_whatsapp ?? o.contato_whatsapp, texto);
  const aberto = o.status === "aberto";
  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/orcamentos">Orçamentos</Link> / #{o.numero}</div>
          <h1>Orçamento #{o.numero} · {para}</h1>
          <p>{o.tabela_nome} · criado em {data(o.criado_em)} por {o.vendedora}{o.deposito ? ` · ${o.deposito}` : ""} · válido até {o.validade ? data(o.validade) : "—"}{" "}
            <Selo cor={aberto ? "aviso" : o.status === "convertido" ? "ok" : ""}>{aberto ? "Aberto" : o.status === "convertido" ? "Virou pedido" : "Cancelado"}</Selo></p>
        </div>
        <div className="linha nao-imprimir">
          {zap && <a className="botao whatsapp" href={zap} target="_blank" rel="noopener noreferrer">Enviar no WhatsApp</a>}
          <Imprimir />
          {aberto && <Link className="botao" href={`/orcamentos/novo?id=${o.id}`}>Editar</Link>}
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />
      {o.pedido_id && <div className="aviso-caixa ok"><Link href={`/pedidos/${o.pedido_id}`}>Ver o pedido criado a partir deste orçamento →</Link></div>}

      <section className="painel">
        <div className="tabela"><table>
          <thead><tr><th>Produto</th><th className="num">Qtd</th><th className="num">Preço un.</th><th className="num">Total</th></tr></thead>
          <tbody>{itens.map((i) => (
            <tr key={i.ordem}>
              <td>{i.descricao}<div className="pequeno suave">{i.codigo}{i.unidades_caixa ? ` · ${Number(i.quantidade) / Number(i.unidades_caixa)} cx de ${i.unidades_caixa}` : ""}</div></td>
              <td className="num">{Number(i.quantidade).toLocaleString("pt-BR")}</td>
              <td className="num">{i.preco_unitario != null ? dinheiro(i.preco_unitario, m) : <Selo cor="erro">sem preço</Selo>}</td>
              <td className="num">{i.preco_unitario != null ? dinheiro(Number(i.quantidade) * Number(i.preco_unitario), m) : "—"}</td>
            </tr>))}</tbody>
          <tfoot><tr><th colSpan={3}>Total</th><th className="num">{dinheiro(o.total, m)}</th></tr></tfoot>
        </table></div>
        {o.observacoes && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{o.observacoes}</p>}
        {semPreco.length > 0 && <p className="pequeno" style={{ color: "var(--erro)", margin: 0 }}>{semPreco.length} produto(s) sem preço nesta tabela: ficam fora do total. Peça o preço ao gerente.</p>}
      </section>

      {aberto && (
        <div className="duas-colunas nao-imprimir">
          <section className="painel">
            <h2>{o.cliente_id ? "Cliente vinculado" : "Vincular a um cliente"}</h2>
            {o.cliente_id ? <p style={{ margin: 0 }}><Link href={`/clientes/${o.cliente_id}`}>{o.cliente_nome}</Link>: os preços são os da tabela dele.</p> : (
              <>
                <form action={vincularOrcamento} className="campos">
                  <input type="hidden" name="id" value={o.id} />
                  <label className="largo">Cliente já cadastrado
                    <select name="cliente_id" defaultValue=""><option value="">Escolha…</option>{d.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
                  </label>
                  <button>Vincular</button>
                </form>
                <form action={vincularOrcamento} className="campos" style={{ marginTop: 10 }}>
                  <input type="hidden" name="id" value={o.id} /><input type="hidden" name="cadastrar" value="1" />
                  <p className="largo pequeno suave" style={{ margin: 0 }}>Ou cadastre <b>{o.contato_nome}</b>{o.contato_whatsapp ? ` (${o.contato_whatsapp})` : ""} como cliente novo, {o.pais === "PY" ? "do Paraguai" : "do Brasil"}, {String(o.tabela).endsWith("_vip") ? "VIP" : "Normal"}:</p>
                  <label>Cidade<input name="cidade" maxLength={80} /></label>
                  <button className="principal">Cadastrar e vincular</button>
                </form>
              </>
            )}
          </section>
          <section className="painel">
            <h2>Virar pedido</h2>
            {!o.cliente_id ? <p className="suave" style={{ margin: 0 }}>Vincule a um cliente primeiro.</p> : (
              <form action={converterOrcamento} className="campos">
                <input type="hidden" name="id" value={o.id} />
                <label>Depósito<select name="deposito_id" defaultValue={o.deposito_id ?? ""}><option value="">Padrão da vendedora</option>{d.depositos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
                <label>Previsão de envio<input type="date" name="previsao" defaultValue={hojeISO(2)} /></label>
                <label className="largo linha"><input type="checkbox" name="para_cliente" value="1" style={{ width: "auto" }} /> Mandar o link para o cliente confirmar antes de separar</label>
                <button className="principal">Criar pedido com estes itens</button>
              </form>
            )}
            <form action={cancelarOrcamento} style={{ marginTop: 12 }}><input type="hidden" name="id" value={o.id} /><button className="discreto pequeno">Cancelar orçamento</button></form>
          </section>
        </div>
      )}
    </>
  );
}
