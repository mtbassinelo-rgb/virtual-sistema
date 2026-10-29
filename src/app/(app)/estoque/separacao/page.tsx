import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, type Moeda } from "@/lib/formato";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { Avisos, Selo } from "../../avisos";
import { marcarEnvio } from "./acoes";

export const metadata = { title: "Área do estoquista" };

type Envio = { id: string; canal: string; canal_nome: string; numero_externo: string; pacote: string | null; comprador: string | null;
  itens: { codigo: string; descricao: string; quantidade: number; produto_id: string | null }[]; status_plataforma: string | null;
  prazo: string | null; etapa: string; preparado_em: string | null; preparado_por: string | null };

/** "Hoje", "Amanhã", "Atrasado" ou a data, no fuso de São Paulo. */
function quandoPrazo(prazo: string | null): { texto: string; cor: string } {
  if (!prazo) return { texto: "sem prazo", cor: "" };
  const dia = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const p = dia(new Date(prazo)), hoje = dia(new Date()), amanha = dia(new Date(Date.now() + 86400000));
  if (p < hoje) return { texto: "atrasado", cor: "erro" };
  if (p === hoje) return { texto: "enviar hoje", cor: "aviso" };
  if (p === amanha) return { texto: "amanhã", cor: "info" };
  return { texto: new Date(prazo).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }), cor: "" };
}

export default async function Separacao({ searchParams }: { searchParams: Promise<{ ordem?: string; ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const gestao = u.perfil === "dono" || u.perfil === "gerente";
  const f = await searchParams;
  const { atual } = await unidadeSistema(u);
  const d = await comUsuario(u.id, async (c) => {
    const deps = (await c.query("select id, nome from app.depositos where ativo and app.pode_operar_deposito(id) order by tipo, nome")).rows as { id: string; nome: string }[];
    const ids = deps.filter((x) => !atual || x.id === atual.id).map((x) => x.id);
    if (!ids.length) return { deps, pedidos: [], transf: [], hoje: { pedidos: 0, transf: 0 }, faltas: [], envios: [] as Envio[], embaladosHoje: 0 };
    const pedidos = (await c.query(`select p.id, p.data_pedido, p.criado_em, p.bling_numero, p.moeda, p.valor_total, p.previsao_envio, p.canal, p.origem,
        cl.nome cliente, v.nome vendedora, d.nome deposito,
        (select count(*) from app.pedido_itens i where i.pedido_id = p.id)::int itens,
        (select coalesce(sum(i.quantidade), 0) from app.pedido_itens i where i.pedido_id = p.id) pecas
      from app.pedidos p left join app.clientes cl on cl.id = p.cliente_id left join app.vendedoras v on v.id = p.vendedora_id
      join app.depositos d on d.id = p.deposito_id
      where p.status_comercial = 'em_separacao' and p.origem <> 'bling' and p.separacao_conferida_em is null and p.deposito_id = any($1::uuid[])
      order by ${f.ordem === "prazo" ? "p.previsao_envio nulls last," : ""} p.criado_em limit 200`, [ids])).rows;
    const transf = (await c.query(`select t.id, t.numero, t.criada_em, t.observacao, o.nome origem, de.nome destino, app.nome_usuario(t.criada_por) quem,
        (select count(*) from app.transferencia_itens i where i.transferencia_id = t.id)::int itens,
        (select coalesce(sum(coalesce(i.quantidade_solicitada, i.quantidade_enviada)), 0) from app.transferencia_itens i where i.transferencia_id = t.id) pecas
      from app.transferencias t join app.depositos o on o.id = t.origem_id join app.depositos de on de.id = t.destino_id
      where t.status = 'solicitada' and t.origem_id = any($1::uuid[]) order by t.criada_em`, [ids])).rows;
    const hoje = (await c.query(`select
        (select count(*) from app.pedidos where separacao_conferida_em::date = current_date and deposito_id = any($1::uuid[]))::int pedidos,
        (select count(*) from app.transferencias where separada_em::date = current_date and origem_id = any($1::uuid[]))::int transf`, [ids])).rows[0];
    // o que mais faltou nos últimos 30 dias (para repor / avisar compras)
    const faltas = (await c.query(`select coalesce(pr.nome, x.descricao) nome, count(*)::int vezes, sum(x.quantidade_faltou) qtd
        from app.pedido_itens_indisponiveis x join app.pedidos p on p.id = x.pedido_id left join app.produtos pr on pr.id = x.produto_id
       where p.deposito_id = any($1::uuid[]) and x.registrado_em > now() - interval '30 days'
       group by 1 order by 2 desc, 3 desc limit 12`, [ids])).rows;
    // Envios da Shopee / Mercado Livre (pedidos que chegam direto das plataformas)
    const envios = (await c.query(`select e.id, e.canal, k.nome canal_nome, e.numero_externo, e.pacote, e.comprador, e.itens, e.status_plataforma,
        e.prazo, e.etapa, e.preparado_em, app.nome_usuario(e.preparado_por) preparado_por
      from app.marketplace_envios e join app.canais k on k.codigo = e.canal
      where e.deposito_id = any($1::uuid[]) and (e.etapa = 'a_preparar' or (e.etapa = 'preparado' and e.preparado_em > now() - interval '3 days'))
      order by e.etapa, e.prazo nulls last, e.criado_em limit 300`, [ids]).catch(() => ({ rows: [] }))).rows as Envio[];
    const embaladosHoje = (await c.query(`select count(*)::int n from app.marketplace_envios
      where deposito_id = any($1::uuid[]) and preparado_em::date = current_date`, [ids]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n as number;
    return { deps, pedidos, transf, hoje, faltas, envios, embaladosHoje };
  }).catch(() => null);

  if (!d) return <div className="painel">Não foi possível carregar a área do estoquista.</div>;
  if (!d.deps.length) return (
    <div className="painel">Você ainda não está ligado a nenhum estoque. Peça ao gerente para marcar em <b>Equipe e acessos → Acessos e horários →
      Unidades em que mexe no estoque</b> (ex.: CD Principal).</div>);
  const atrasado = (p: { previsao_envio: string | null }) => p.previsao_envio && new Date(p.previsao_envio) < new Date(new Date().toDateString());

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/estoque">Estoque</Link> / Área do estoquista</div>
          <h1>Área do estoquista{atual ? ` · ${atual.nome}` : ""}</h1>
          <p>Fila do que separar em {d.deps.filter((x) => !atual || x.id === atual.id).map((x) => x.nome).join(" e ")}: pedidos de clientes e pedidos de outras unidades.
            Abra, confira na prateleira e confirme a quantidade exata de cada item e o total de caixas. O que faltar, marque "Não tem": a vendedora é avisada e segue com o cliente.</p>
        </div>
      </section>

      <Avisos ok={f.ok} erro={f.erro} />
      <section className="atalhos">
        <Link className="atalho" href="/estoque/inventario"><b>Balanço de estoque</b><span>Contar a prateleira e acertar o saldo</span></Link>
      </section>
      <section className="indicadores">
        <div className="indicador"><span className="rotulo">Envios Shopee / ML a embalar</span><span className="valor">{d.envios.filter((e) => e.etapa === "a_preparar").length}</span>
          <span className="pequeno suave">{d.embaladosHoje} embalado(s) hoje</span></div>
        <div className="indicador"><span className="rotulo">Pedidos de clientes a separar</span><span className="valor">{d.pedidos.length}</span></div>
        <div className="indicador"><span className="rotulo">Pedidos de outra unidade a separar</span><span className="valor">{d.transf.length}</span></div>
        <div className="indicador"><span className="rotulo">Separados hoje</span><span className="valor">{d.hoje.pedidos + d.hoje.transf}</span>
          <span className="pequeno suave">{d.hoje.pedidos} de clientes · {d.hoje.transf} entre unidades</span></div>
      </section>

      <section className="painel" id="envios">
        <h2>Envios de hoje · Shopee e Mercado Livre</h2>
        <p className="pequeno suave" style={{ margin: 0 }}>Pedidos pagos que chegam direto das plataformas. Separe, embale com a etiqueta da plataforma e marque <b>Embalado</b>.
          Quando a transportadora coletar, o envio sai daqui sozinho.</p>
        {d.envios.length === 0 ? <div className="vazio">Nenhum envio de marketplace para preparar.</div> : (
          <div className="envios-lista">
            {d.envios.map((e) => {
              const q = quandoPrazo(e.prazo);
              const feito = e.etapa === "preparado";
              return (
                <div key={e.id} className={`envio-cartao ${feito ? "feito" : ""}`}>
                  <div className="linha entre">
                    <span><Selo cor={e.canal === "shopee" ? "aviso" : "info"}>{e.canal_nome}</Selo> <b>{e.numero_externo}</b>
                      {e.comprador && <span className="pequeno suave"> · {e.comprador}</span>}</span>
                    {feito ? <Selo cor="ok">embalado</Selo> : <Selo cor={q.cor}>{q.texto}</Selo>}
                  </div>
                  <ul className="envio-itens">{e.itens.map((i, k) => (
                    <li key={k}><b>{Number(i.quantidade).toLocaleString("pt-BR")}×</b> {i.descricao}
                      {!i.produto_id && <span className="pequeno" style={{ color: "var(--erro)" }}> (sem cadastro: {i.codigo})</span>}</li>))}
                  </ul>
                  <form action={marcarEnvio} className="linha entre">
                    <input type="hidden" name="envio" value={e.id} /><input type="hidden" name="preparado" value={feito ? "0" : "1"} />
                    <span className="pequeno suave">{feito ? `por ${e.preparado_por ?? "—"} em ${new Date(e.preparado_em!).toLocaleString("pt-BR", { timeStyle: "short", dateStyle: "short", timeZone: "America/Sao_Paulo" })}` : e.status_plataforma ?? ""}</span>
                    <button className={feito ? "" : "principal"}>{feito ? "Desfazer" : "✓ Embalado"}</button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="painel">
        <div className="linha entre" style={{ flexWrap: "wrap" }}>
          <h2>Pedidos de clientes</h2>
          <nav className="filtros">
            <Link href="/estoque/separacao" className={f.ordem !== "prazo" ? "ativo" : ""}>Mais antigos primeiro</Link>
            <Link href="/estoque/separacao?ordem=prazo" className={f.ordem === "prazo" ? "ativo" : ""}>Pela data de envio</Link>
          </nav>
        </div>
        {d.pedidos.length === 0 ? <div className="vazio">Nada para separar. 🎉</div> : (
          <div className="tabela cartoes"><table>
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Vendedora</th><th className="num">Itens</th><th>Enviar até</th>{gestao && <th className="num">Total</th>}<th></th></tr></thead>
            <tbody>{d.pedidos.map((p) => (
              <tr key={p.id}>
                <td data-rot="Pedido em">{new Date(p.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}{p.bling_numero && <div className="pequeno suave">nº {p.bling_numero}</div>}
                  {!atual && d.deps.length > 1 && <div className="pequeno suave">{p.deposito}</div>}</td>
                <td className="titulo">{p.cliente ?? "Cliente avulso"}{p.origem === "portal" && <> <Selo cor="info">site</Selo></>}</td>
                <td data-rot="Vendedora">{p.vendedora}</td>
                <td className="num" data-rot="Itens">{p.itens} · {Number(p.pecas).toLocaleString("pt-BR")} pç</td>
                <td data-rot="Enviar até">{p.previsao_envio ? <span style={atrasado(p) ? { color: "var(--erro)", fontWeight: 700 } : undefined}>{new Date(p.previsao_envio).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</span> : "—"}</td>
                {gestao && <td className="num" data-rot="Total">{dinheiro(p.valor_total, p.moeda as Moeda)}</td>}
                <td className="acao"><span className="linha" style={{ gap: 6, justifyContent: "flex-end" }}>
                  {u.perfil !== "estoquista" && <Link className="botao" href={`/pedidos/${p.id}`}>Ver pedido</Link>}
                  <Link className="botao principal" href={`/estoque/separacao/${p.id}`}>Separar</Link></span></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>

      <section className="painel">
        <h2>Pedidos de outra unidade</h2>
        {d.transf.length === 0 ? <div className="vazio">Nenhuma unidade pediu mercadoria.</div> : (
          <div className="tabela cartoes"><table>
            <thead><tr><th>Nº</th><th>Pedido em</th><th>Para</th><th className="num">Itens</th><th>Quem pediu</th><th></th></tr></thead>
            <tbody>{d.transf.map((t) => (
              <tr key={t.id}>
                <td className="num" data-rot="Nº">#{t.numero}</td>
                <td data-rot="Pedido em">{new Date(t.criada_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                <td className="titulo">Para <b>{t.destino}</b>{t.observacao && <div className="pequeno suave">{t.observacao}</div>}</td>
                <td className="num" data-rot="Itens">{t.itens} · {Number(t.pecas).toLocaleString("pt-BR")} pç</td>
                <td data-rot="Quem pediu">{t.quem}</td>
                <td className="acao"><span className="linha" style={{ gap: 6, justifyContent: "flex-end" }}>
                  <Link className="botao" href={`/estoque/transferencias/${t.id}`}>Ver pedido</Link>
                  <Link className="botao principal" href={`/estoque/transferencias/${t.id}#separar`}>Separar</Link></span></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>

      {d.faltas.length > 0 && (
        <section className="painel">
          <h2>O que mais faltou (30 dias)</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>Produtos marcados como "não tem" na separação: avise compras ou peça a outra unidade.</p>
          <div className="tabela"><table><thead><tr><th>Produto</th><th className="num">Vezes</th><th className="num">Quantidade</th></tr></thead>
            <tbody>{d.faltas.map((x) => <tr key={x.nome}><td>{x.nome}</td><td className="num">{x.vezes}</td><td className="num">{Number(x.qtd).toLocaleString("pt-BR")}</td></tr>)}</tbody></table></div>
        </section>
      )}
    </>
  );
}
