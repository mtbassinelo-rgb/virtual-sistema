import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario, ehGestao, podeEscrever } from "@/lib/auth";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { comUsuario } from "@/lib/db";
import { hojeISO } from "@/lib/formato";
import { Avisos } from "../../avisos";
import { FormPedido } from "./form-pedido";
import { BuscaLista } from "../../busca-lista";
import { LinhasItens } from "./linhas-itens";
import { pode } from "@/lib/permissoes";

export const metadata = { title: "Novo pedido" };

export default async function NovoPedido({ searchParams }: { searchParams: Promise<{ erro?: string; cliente?: string; repetir?: string }> }) {
  const u = await exigirUsuario();
  if (!podeEscrever(u)) redirect("/pedidos");
  const f = await searchParams;
  const { atual: unidade } = await unidadeSistema(u);
  const d = await comUsuario(u.id, async (c) => ({
    clientes: (await c.query(
      `select c.id, c.nome, c.categoria_preco, c.moeda, v.nome as vendedora from app.clientes c
         join app.vendedoras v on v.id = c.vendedora_id where c.mesclado_em is null and c.ativo order by c.nome`)).rows,
    produtos: (await c.query("select id, codigo, nome, unidades_caixa from app.produtos where ativo and not marketplace order by nome")).rows,
    unidades: (await c.query("select id, nome from app.depositos where ativo order by tipo, nome")).rows as { id: string; nome: string }[],
    exigeEstoque: Number((await c.query("select app.param('pedido_exige_estoque') v")).rows[0].v ?? 0) === 1,
    depositos: (await c.query(
      ehGestao(u)
        ? "select id, nome, false as padrao from app.depositos where ativo order by nome"
        : `select d.id, d.nome, vd.padrao from app.depositos d join app.vendedora_depositos vd on vd.deposito_id = d.id
            where vd.vendedora_id = $1 and d.ativo order by vd.padrao desc, d.nome`,
      ehGestao(u) ? [] : [u.vendedora_id])).rows,
    // Repetir um pedido anterior: mesmo cliente e mesmos produtos (quantidade em caixas quando fecha caixa); preço sempre o de hoje
    repetir: f.repetir && /^[0-9a-f-]{36}$/i.test(f.repetir)
      ? (await c.query(`select p.cliente_id, p.data_pedido, i.produto_id, sum(coalesce(i.quantidade_pedida, i.quantidade)) qtd, pr.unidades_caixa
           from app.pedidos p join app.pedido_itens i on i.pedido_id = p.id join app.produtos pr on pr.id = i.produto_id
          where p.id = $1 and pr.ativo and not pr.marketplace
          group by p.cliente_id, p.data_pedido, i.produto_id, pr.unidades_caixa, pr.nome order by pr.nome`, [f.repetir]).catch(() => ({ rows: [] }))).rows as
          { cliente_id: string | null; data_pedido: string; produto_id: string; qtd: string; unidades_caixa: number | null }[]
      : [],
  }));
  const iniciais = d.repetir.map((x) => {
    const q = Number(x.qtd), uc = Number(x.unidades_caixa ?? 0);
    return uc > 1 && q % uc === 0 ? { produto: String(x.produto_id), cx: q / uc } : { produto: String(x.produto_id), qtd: q };
  });
  const clienteInicial = f.cliente ?? (d.repetir[0]?.cliente_id ? String(d.repetir[0].cliente_id) : "");
  const caixa = Object.fromEntries(d.produtos.filter((p) => Number(p.unidades_caixa) > 0).map((p) => [String(p.id), Number(p.unidades_caixa)]));
  const opcoesProdutos = d.produtos.map((p) => ({ v: String(p.id), t: `${p.nome}`,
    d: `${p.codigo}${p.unidades_caixa ? ` · caixa com ${p.unidades_caixa}` : ""}` }));

  return (
    <>
      <section>
        <Link href="/pedidos">← Pedidos</Link>
        <h1 style={{ marginTop: 4 }}>Novo pedido</h1>
        <div className="suave pequeno">Os preços vêm da tabela do cliente (Normal/VIP) na moeda escolhida e ficam congelados no pedido.
          {d.exigeEstoque ? " Só entra o que tem estoque no depósito." : ""}
          {" "}O cliente pediu algo que não temos? <Link href="/procuras">Registre aqui</Link> para o gerente comprar.
          {" "}Ainda não é cliente ou só quer saber o preço? <Link href="/orcamentos/novo">Faça um orçamento</Link>.</div>
      </section>
      <Avisos erro={f.erro} />
      {iniciais.length > 0 && (
        <div className="aviso-caixa info">Repetindo o pedido de {new Date(d.repetir[0].data_pedido).toLocaleDateString("pt-BR", { timeZone: "UTC" })}: {iniciais.length} produto(s) já preenchidos.
          Ajuste as quantidades com o cliente. Os preços são os de hoje (tabela do cliente).</div>
      )}
      {d.depositos.length === 0 && !ehGestao(u) && (
        <div className="aviso-caixa aviso">Você ainda não tem depósito liberado para vender. Peça ao gerente.</div>
      )}
      <FormPedido>
        <label className="largo">Cliente
          <BuscaLista name="cliente_id" required defaultValue={clienteInicial} ariaLabel="Cliente"
            placeholder="Digite o nome do cliente (use % como coringa)"
            opcoes={d.clientes.map((c) => ({ v: String(c.id), t: String(c.nome),
              d: `${c.moeda === "GS" ? "Gs" : "R$"} ${c.categoria_preco === "vip" ? "VIP" : "Normal"}${ehGestao(u) ? ` · ${c.vendedora}` : ""}` }))} />
        </label>
        <label>Moeda do pedido
          <select name="moeda" defaultValue="">
            <option value="">A do cliente</option>
            <option value="GS">Guaranis (Gs)</option>
            <option value="BRL">Reais (R$)</option>
          </select>
        </label>
        <label>Depósito
          <select name="deposito_id" defaultValue={(unidade && d.depositos.some((x) => x.id === unidade.id) ? unidade.id : d.depositos.find((x) => x.padrao)?.id) ?? ""}>
            <option value="">Padrão da vendedora</option>
            {d.depositos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </label>
        <label>Previsão de envio<input name="previsao_envio" type="date" defaultValue={hojeISO(2)} /></label>
        <div className="largo tabela" style={{ overflow: "visible" }}>
          <LinhasItens opcoes={opcoesProdutos} podeBaixar={ehGestao(u) || pode(u, "preco_abaixo")} unidades={d.unidades} iniciais={iniciais} caixa={caixa} />
        </div>
        <fieldset className="largo desconto-pedido">
          <legend>Desconto no pedido</legend>
          <label>Valor do desconto<input name="desconto" inputMode="decimal" placeholder="Ex.: 20.000 ou 15,00" /></label>
          <span className="pequeno suave">{ehGestao(u) || pode(u, "preco_abaixo")
            ? "Sai do total do pedido, distribuído entre os produtos."
            : "Sai da folga de cada produto acima do preço VIP. O máximo é chegar ao VIP em todos; se passar, o sistema avisa o limite."}</span>
        </fieldset>
        <label className="largo">Observações<textarea name="observacoes" /></label>
        <label className="largo linha"><input type="checkbox" name="para_cliente" value="1" />
          Mandar para o cliente conferir e confirmar as caixas por link (WhatsApp) antes de separar</label>
        <button className="principal">Criar pedido</button>
      </FormPedido>
    </>
  );
}
