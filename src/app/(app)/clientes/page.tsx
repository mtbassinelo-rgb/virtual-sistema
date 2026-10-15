import Link from "next/link";
import { exigirUsuario, ehGestao, podeEscrever } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, data, type Moeda } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import { criarCliente } from "./acoes";

export const metadata = { title: "Clientes" };

export default async function Clientes({ searchParams }: { searchParams: Promise<{ q?: string; vendedora?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const par: unknown[] = [];
  const cond = ["c.mesclado_em is null"];
  if (f.q) { par.push(`%${f.q}%`); cond.push(`(c.nome ilike $${par.length} or c.whatsapp ilike $${par.length} or c.telefone ilike $${par.length})`); }
  if (f.vendedora) { par.push(f.vendedora); cond.push(`c.vendedora_id = $${par.length}::uuid`); }

  const d = await comUsuario(u.id, async (c) => ({
    clientes: (await c.query(
      `select c.id, c.nome, c.cidade, c.pais, c.categoria_preco, c.moeda, v.nome as vendedora,
              x.pedidos, x.total, x.ultima, x.saldo
         from app.clientes c join app.vendedoras v on v.id = c.vendedora_id
         left join lateral (
           select count(*) pedidos, sum(valor_total) total, max(data_pedido) ultima, sum(saldo) saldo
             from app.v_pedidos p where p.cliente_id = c.id and p.status_comercial <> 'cancelado') x on true
        where ${cond.join(" and ")}
        order by x.total desc nulls last, c.nome limit 500`, par)).rows,
    vendedoras: (await c.query("select id, nome from app.vendedoras where ativo order by nome")).rows,
  }));

  return (
    <>
      <section className="linha entre">
        <div><h1>Clientes</h1><div className="suave pequeno">{d.clientes.length} cliente(s)</div></div>
      </section>
      <Avisos erro={f.erro} />
      <form className="painel campos" method="get">
        <label>Nome ou telefone<input name="q" defaultValue={f.q} /></label>
        {ehGestao(u) && (
          <label>Vendedora
            <select name="vendedora" defaultValue={f.vendedora ?? ""}>
              <option value="">Todas</option>
              {d.vendedoras.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
            </select>
          </label>
        )}
        <button className="principal">Buscar</button>
      </form>

      {d.clientes.length === 0 ? <div className="painel vazio">Nenhum cliente encontrado.</div> : (
        <div className="tabela"><table>
          <thead><tr><th>Cliente</th><th>Preço</th>{ehGestao(u) && <th>Vendedora</th>}<th>Pedidos</th><th>Total</th><th>Saldo</th><th>Última compra</th></tr></thead>
          <tbody>{d.clientes.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/clientes/${c.id}`}>{c.nome}</Link>{c.cidade && <div className="pequeno suave">{c.cidade}</div>}</td>
              <td><Selo cor={c.categoria_preco === "vip" ? "marca" : ""}>{c.pais} · {c.categoria_preco === "vip" ? "VIP" : "Normal"}</Selo></td>
              {ehGestao(u) && <td>{c.vendedora}</td>}
              <td className="num">{c.pedidos ?? 0}</td>
              <td className="num">{dinheiro(c.total ?? 0, c.moeda as Moeda)}</td>
              <td className="num">{dinheiro(c.saldo ?? 0, c.moeda as Moeda)}</td>
              <td className="num">{data(c.ultima)}</td>
            </tr>))}
          </tbody></table></div>
      )}

      {podeEscrever(u) && (
        <details className="painel">
          <summary>Cadastrar cliente</summary>
          <form action={criarCliente} className="campos" style={{ marginTop: 10 }}>
            <label className="largo">Nome ou empresa<input name="nome" required /></label>
            <label>WhatsApp<input name="whatsapp" placeholder="595981000000" /></label>
            <label>Telefone<input name="telefone" /></label>
            <label>Cidade<input name="cidade" /></label>
            <label>Departamento / Estado<input name="departamento" /></label>
            <label>País
              <select name="pais" defaultValue="">
                <option value="">O da vendedora</option><option value="PY">Paraguai (Gs)</option><option value="BR">Brasil (R$)</option>
              </select>
            </label>
            <label>Preço
              <select name="categoria_preco" defaultValue="normal"><option value="normal">Normal</option><option value="vip">VIP</option></select>
            </label>
            <label>Perfil
              <select name="perfil_comercial" defaultValue="">
                <option value="">—</option>
                {["Salão", "Profissional da beleza", "Loja", "Revendedor(a)", "Consumidor final", "Outro"].map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
            {ehGestao(u) && (
              <label>Vendedora responsável
                <select name="vendedora_id" required defaultValue="">
                  <option value="">Escolha…</option>
                  {d.vendedoras.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
                </select>
              </label>
            )}
            <label className="largo">Observações<textarea name="observacoes" /></label>
            <button className="principal">Cadastrar</button>
          </form>
        </details>
      )}
    </>
  );
}
