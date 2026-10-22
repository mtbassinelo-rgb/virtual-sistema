import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, dinheiro } from "@/lib/formato";
import { Avisos, Selo } from "../../avisos";
import { importarXml, lancarNota } from "./acoes";

export const metadata = { title: "Notas a chegar" };

export default async function Notas({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono lança notas.</div>;
  const f = await searchParams;
  const d = await comUsuario(u.id, async (c) => ({
    notas: (await c.query(`select c.id, c.data, c.nfe, c.marca, c.status, c.frete, c.valor_produtos, c.unidades, c.recebida_em, f.nome fornecedor,
        (select count(*) from app.compra_itens i where i.compra_id = c.id)::int itens,
        (select count(*) from app.compra_itens i where i.compra_id = c.id and i.produto_id is null)::int sem_produto
      from app.compras c join app.fornecedores f on f.id = c.fornecedor_id
      where exists (select 1 from app.compra_itens i where i.compra_id = c.id)
      order by (c.status = 'a_caminho') desc, c.data desc limit 200`)).rows,
    fornecedores: (await c.query("select id, nome from app.fornecedores where ativo order by nome")).rows as { id: string; nome: string }[],
    marcas: (await c.query("select distinct marca from app.produtos where marca is not null order by marca")).rows.map((r) => r.marca as string),
  }));
  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/estoque">Estoque</Link> / Notas a chegar</div>
          <h1>Notas a chegar</h1>
          <p>Lance a nota do fornecedor quando o pedido sai. O estoque só sobe quando o gerente confirmar a chegada. Nenhum produto novo é criado: cada item é ligado a um produto que já existe.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <section className="painel">
        <h2>Importar XML da NF-e</h2>
        <p className="pequeno suave" style={{ margin: 0 }}>Envie o arquivo .xml que o fornecedor manda por e-mail (pode mandar vários de uma vez). O sistema lê o fornecedor (CNPJ), os itens,
          o frete, o desconto e as parcelas; liga cada item ao produto pelo código de barras, pelo código já usado com esse fornecedor ou pelo nome;
          e lança as parcelas no contas a pagar. O estoque só sobe quando você confirmar a chegada.</p>
        <form action={importarXml} className="linha" style={{ flexWrap: "wrap", alignItems: "end", gap: 10 }}>
          <label>Arquivo(s) XML<input type="file" name="xml" accept=".xml,text/xml,application/xml" multiple required /></label>
          <label>Marca<select name="marca" defaultValue=""><option value="">Descobrir sozinho</option>
            {d.marcas.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          <label>Câmbio (Gs/R$)<input name="cambio" inputMode="decimal" style={{ width: 90 }} /></label>
          <label className="linha" style={{ alignItems: "center", gap: 6 }}><input type="checkbox" name="gerar_contas" value="1" defaultChecked style={{ width: "auto" }} /> Lançar no contas a pagar</label>
          <label>Prazo se não tiver parcela (dias)<input name="prazo" type="number" min={0} max={180} defaultValue={30} style={{ width: 80 }} /></label>
          <button className="principal">Importar</button>
        </form>
      </section>

      <section className="painel">
        <h2>Lançar nota colando o texto</h2>
        <form action={lancarNota} style={{ display: "grid", gap: 10 }}>
          <div className="linha" style={{ flexWrap: "wrap", alignItems: "end" }}>
            <label>Fornecedor<select name="fornecedor" required defaultValue=""><option value="" disabled>Escolha</option>
              {d.fornecedores.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
            <label>Marca<select name="marca" required defaultValue=""><option value="" disabled>Escolha</option>
              {d.marcas.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
            <label>Data<input type="date" name="data" required /></label>
            <label>Nº nota / pedido<input name="nfe" style={{ width: 110 }} placeholder="lê do texto" /></label>
            <label>Frete total (R$)<input name="frete" inputMode="decimal" required style={{ width: 100 }} /></label>
            <label>Desconto da nota (%)<input name="desconto" inputMode="decimal" style={{ width: 90 }} placeholder="lê do texto" /></label>
            <label>Câmbio (Gs/R$)<input name="cambio" inputMode="decimal" style={{ width: 90 }} /></label>
          </div>
          <label>Itens da nota (cole o texto do PDF: uma linha por item, com código, produto e os números)
            <textarea name="itens" rows={8} required placeholder={"05   PIMENTA NEGRA   0,000  0,000  1.200,000  2,60  100  31,20  3120,00\n066  SPRAY MEU LISO MINHA VIDA  0,000  0,000  120,000  5,00  10  60,00  600,00"} style={{ fontFamily: "monospace" }} />
          </label>
          <div><button className="principal">Lançar como a caminho</button></div>
        </form>
      </section>

      <section className="painel">
        <h2>Notas</h2>
        {d.notas.length === 0 ? <div className="vazio">Nenhuma nota lançada.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Data</th><th>Nota</th><th>Fornecedor</th><th>Marca</th><th>Situação</th><th>Itens</th><th>Produtos</th><th>Valor</th><th>Frete</th><th>Frete/produto</th></tr></thead>
            <tbody>{d.notas.map((n) => (
              <tr key={n.id}>
                <td>{data(n.data)}</td><td><Link href={`/estoque/notas/${n.id}`}>{n.nfe ?? "ver"}</Link></td><td>{n.fornecedor}</td><td>{n.marca}</td>
                <td>{n.status === "a_caminho" ? <Selo cor="aviso">A caminho</Selo> : <Selo cor="ok">Recebida</Selo>}</td>
                <td className="num">{n.itens}{n.sem_produto > 0 && <div className="pequeno suave">{n.sem_produto} sem produto</div>}</td>
                <td className="num">{Number(n.unidades ?? 0).toLocaleString("pt-BR")}</td>
                <td className="num">{dinheiro(n.valor_produtos, "BRL")}</td><td className="num">{dinheiro(n.frete, "BRL")}</td>
                <td className="num">{n.unidades ? dinheiro(Number(n.frete) / Number(n.unidades), "BRL") : "—"}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
