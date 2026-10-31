import Link from "next/link";
import { exigirUsuario, ehGestao, podeEscrever } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { dinheiro, data, type Moeda } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import { criarCliente, decidirCompraUnidade, trocarVendedoraCliente } from "./acoes";
import { aprovarCadastro } from "../site/acoes";

export const metadata = { title: "Clientes" };

export default async function Clientes({ searchParams }: { searchParams: Promise<{ q?: string; vendedora?: string; compra?: string; situacao?: string; unidade?: string; erro?: string; ok?: string; novo?: string; whatsapp?: string; nome?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const par: unknown[] = [];
  const cond = ["c.mesclado_em is null"];
  if (f.q) { par.push(`%${f.q}%`); cond.push(`(c.nome ilike $${par.length} or c.whatsapp ilike $${par.length} or c.telefone ilike $${par.length})`); }
  if (f.vendedora) { par.push(f.vendedora); cond.push(`c.vendedora_id = $${par.length}::uuid`); }
  if (f.compra === "aguardando") cond.push("c.compra_unidade_sugerido_em is not null and not c.compra_unidade and c.categoria_preco = 'normal'");
  if (f.compra === "unidade") cond.push("c.compra_unidade and c.categoria_preco = 'normal'");
  if (f.compra === "caixa") cond.push("not (c.compra_unidade and c.categoria_preco = 'normal')");
  if (f.situacao === "inativos") cond.push("not c.ativo"); else if (f.situacao !== "todos") cond.push("c.ativo");
  // clientes de cada unidade não se misturam: com uma unidade escolhida no topo, só os clientes dela
  const { atual } = await unidadeSistema(u);
  // a vendedora sempre vê todos os clientes dela; gestão pode separar por unidade (ou ver todas)
  const porUnidade = Boolean(atual) && ehGestao(u) && f.unidade !== "todas";
  if (porUnidade && atual) { par.push(atual.id); cond.push(`app.deposito_do_cliente(c.id) = $${par.length}::uuid`); }

  const d = await comUsuario(u.id, async (c) => ({
    clientes: (await c.query(
      `select c.id, c.nome, c.cidade, c.pais, c.categoria_preco, c.moeda, c.vendedora_id, v.nome as vendedora, c.compra_unidade, c.compra_unidade_sugerido_em, c.ativo,
              x.pedidos, x.total, x.ultima, x.saldo
         from app.clientes c join app.vendedoras v on v.id = c.vendedora_id
         left join lateral (
           select count(*) pedidos, sum(valor_total) total, max(data_pedido) ultima, sum(saldo) saldo
             from app.v_pedidos p where p.cliente_id = c.id and p.status_comercial <> 'cancelado') x on true
        where ${cond.join(" and ")}
        order by (c.compra_unidade_sugerido_em is not null and not c.compra_unidade and c.categoria_preco = 'normal') desc, lower(c.nome), c.nome limit 500`, par)).rows,
    vendedoras: (await c.query("select id, nome from app.vendedoras where ativo order by nome")).rows,
    // cadastros do site ("Quero ser cliente") esperando virar cliente
    leads: (await c.query(`select s.id, s.nome, s.contato, s.whatsapp, s.cidade, s.documento, s.criado_em, s.vendedora_id
        from app.cadastros_site s where s.cliente_id is null and s.atendido_em is null order by s.criado_em desc limit 50`).catch(() => ({ rows: [] }))).rows as
      { id: string; nome: string; contato: string | null; whatsapp: string; cidade: string | null; documento: string | null; criado_em: string; vendedora_id: string | null }[],
    aguardando: Number((await c.query(`select count(*) n from app.clientes where mesclado_em is null and compra_unidade_sugerido_em is not null
                                         and not compra_unidade and categoria_preco = 'normal'`)).rows[0].n),
  }));

  // volta para a mesma lista (com os filtros) depois de trocar a vendedora
  const voltaLista = "/clientes?" + new URLSearchParams(Object.entries({ q: f.q, vendedora: f.vendedora, compra: f.compra, situacao: f.situacao })
    .filter((x): x is [string, string] => Boolean(x[1]))).toString();
  return (
    <>
      <section className="linha entre">
        <div><h1>Clientes</h1><div className="suave pequeno">{d.clientes.length} cliente(s)
          {porUnidade && atual && <> · só os da unidade <b>{atual.nome}</b> (<a href={`/clientes?${new URLSearchParams({ ...(f.q ? { q: f.q } : {}), unidade: "todas" })}`}>ver de todas as unidades</a>)</>}</div></div>
        {podeEscrever(u) && <a className="botao principal" href="/clientes?novo=1#cadastrar">+ Cadastrar cliente</a>}
      </section>
      <Avisos erro={f.erro} ok={f.ok} />
      {d.leads.length > 0 && (
        <section className="painel">
          <h2 style={{ margin: 0 }}>Novos cadastros pelo site ({d.leads.length})</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>Pessoas que pediram para ser cliente no site. Escolha a vendedora e aprove: o cliente é criado e entra na lista abaixo.</p>
          <div className="tabela"><table style={{ minWidth: 0 }}>
            <thead><tr><th>Empresa</th><th>Contato</th><th>Cidade</th><th>Documento</th><th>Vendedora</th></tr></thead>
            <tbody>{d.leads.map((l) => (
              <tr key={l.id}>
                <td><b>{l.nome}</b><div className="pequeno suave">{data(l.criado_em)}</div></td>
                <td>{l.contato ?? "—"}<div className="pequeno">+{l.whatsapp}</div></td>
                <td>{l.cidade ?? "—"}</td><td>{l.documento ?? "—"}</td>
                <td>
                  <form action={aprovarCadastro} className="linha" style={{ gap: 6, flexWrap: "wrap" }}>
                    <input type="hidden" name="id" value={l.id} />
                    <select name="vendedora_id" defaultValue={l.vendedora_id ?? ""} required aria-label={`Vendedora de ${l.nome}`}>
                      <option value="" disabled>Vendedora…</option>
                      {d.vendedoras.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
                    </select>
                    <button className="principal">Aprovar e criar cliente</button>
                  </form>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
      {ehGestao(u) && d.aguardando > 0 && f.compra !== "aguardando" && (
        <div className="painel linha entre" style={{ alignItems: "center" }}>
          <span><b>{d.aguardando}</b> cliente(s) aguardando sua aprovação para comprar por unidade.</span>
          <Link className="botao" href="/clientes?compra=aguardando">Ver e aprovar</Link>
        </div>
      )}
      <form className="painel campos" method="get">
        {f.unidade === "todas" && <input type="hidden" name="unidade" value="todas" />}
        <label>Nome ou telefone<input name="q" defaultValue={f.q} /></label>
        <label>Situação
          <select name="situacao" defaultValue={f.situacao ?? ""}>
            <option value="">Ativos</option><option value="inativos">Inativos</option><option value="todos">Todos</option>
          </select>
        </label>
        {ehGestao(u) && (
          <label>Vendedora
            <select name="vendedora" defaultValue={f.vendedora ?? ""}>
              <option value="">Todas</option>
              {d.vendedoras.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
            </select>
          </label>
        )}
        <label>Compra no site
          <select name="compra" defaultValue={f.compra ?? ""}>
            <option value="">Todos</option>
            <option value="aguardando">Aguardando aprovação (unidade)</option>
            <option value="unidade">Unidade liberada</option>
            <option value="caixa">Só caixa fechada</option>
          </select>
        </label>
        <button className="principal">Buscar</button>
      </form>

      {d.clientes.length === 0 ? <div className="painel vazio">Nenhum cliente encontrado.</div> : (
        <div className="tabela"><table>
          <thead><tr><th>Cliente</th><th>Preço</th><th>Compra no site</th>{ehGestao(u) && <th>Vendedora (trocar)</th>}<th>Pedidos</th><th>Total</th><th>Saldo</th><th>Última compra</th></tr></thead>
          <tbody>{d.clientes.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/clientes/${c.id}`}>{c.nome}</Link>{!c.ativo && <> <Selo cor="erro">Inativo</Selo></>}{c.cidade && <div className="pequeno suave">{c.cidade}</div>}</td>
              <td><Selo cor={c.categoria_preco === "vip" ? "marca" : ""}>{c.pais} · {c.categoria_preco === "vip" ? "VIP" : "Normal"}</Selo></td>
              <td>
                {c.categoria_preco === "vip" || (!c.compra_unidade && !c.compra_unidade_sugerido_em) ? <span className="pequeno suave">Só caixa</span>
                  : c.compra_unidade ? <Selo cor="ok">Unidade liberada</Selo>
                  : <div className="linha" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <Selo cor="aviso">Aguardando gerente</Selo>
                      {ehGestao(u) && <>
                        <form action={decidirCompraUnidade}><input type="hidden" name="cliente_id" value={c.id} /><input type="hidden" name="liberar" value="1" /><input type="hidden" name="volta" value="lista" /><button className="principal">Aprovar</button></form>
                        <form action={decidirCompraUnidade}><input type="hidden" name="cliente_id" value={c.id} /><input type="hidden" name="liberar" value="0" /><input type="hidden" name="volta" value="lista" /><button className="discreto">Recusar</button></form>
                      </>}
                    </div>}
              </td>
              {ehGestao(u) && (
                <td>
                  <form action={trocarVendedoraCliente} className="linha" style={{ gap: 6, alignItems: "center", flexWrap: "nowrap" }}>
                    <input type="hidden" name="cliente_id" value={c.id} />
                    <input type="hidden" name="pedidos_abertos" value="1" />
                    <input type="hidden" name="volta" value={voltaLista} />
                    <select name="vendedora_id" defaultValue={c.vendedora_id} aria-label={`Vendedora de ${c.nome}`}>
                      {d.vendedoras.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
                    </select>
                    <button title="Trocar a vendedora deste cliente">Trocar</button>
                  </form>
                </td>
              )}
              <td className="num">{c.pedidos ?? 0}</td>
              <td className="num">{dinheiro(c.total ?? 0, c.moeda as Moeda)}</td>
              <td className="num">{dinheiro(c.saldo ?? 0, c.moeda as Moeda)}</td>
              <td className="num">{data(c.ultima)}</td>
            </tr>))}
          </tbody></table></div>
      )}

      {podeEscrever(u) && (
        <details className="painel" id="cadastrar" open={f.novo === "1" || undefined}>
          <summary>Cadastrar cliente</summary>
          <form action={criarCliente} className="campos" style={{ marginTop: 10 }}>
            {atual && <input type="hidden" name="deposito" value={atual.id} />}
            {atual && <p className="largo pequeno suave" style={{ margin: 0 }}>O cliente fica ligado à unidade <b>{atual.nome}</b> (vê o estoque e os preços dela).</p>}
            <label className="largo">Nome ou empresa<input name="nome" required defaultValue={f.nome ?? ""} autoFocus={f.novo === "1" || undefined} /></label>
            <label>WhatsApp<input name="whatsapp" placeholder="595981000000" defaultValue={(f.whatsapp ?? "").replace(/\D/g, "")} /></label>
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
            <label className="largo" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="pedir_unidade" value="1" style={{ width: "auto" }} />
              {ehGestao(u) ? "Liberar compra por unidade no site (só preço Normal)" : "Pedir ao gerente compra por unidade no site (só preço Normal; VIP é só caixa fechada)"}
            </label>
            <label className="largo">Observações<textarea name="observacoes" /></label>
            <button className="principal">Cadastrar</button>
          </form>
        </details>
      )}
    </>
  );
}
