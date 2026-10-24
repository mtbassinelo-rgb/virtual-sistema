import Link from "next/link";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, data, dataHora, linkWhatsApp, MODALIDADES, telefone, type Moeda } from "@/lib/formato";
import { Selo } from "./avisos";
import { apagarPedidosSite, marcarPedidoSiteAtendido } from "./acoes-site";
import { carregarFila, FilaPedidos } from "./pedidos/fila";

type Recompra = { cliente_id: string; nome: string; whatsapp: string | null; vendedora: string; atraso_dias: number; dias_desde: number; alto_valor: boolean; moeda: Moeda; valor_medio: string | null };
type Carrinho = { cliente_id: string; cliente: string; whatsapp: string | null; vendedora: string; itens: number; atualizado_em: string };
type Espera = { contato: string; texto: string | null; em: string };

export const metadata = { title: "Hoje" };

export default async function Hoje() {
  const u = await exigirUsuario();
  const gestao = ehGestao(u);

  const d = await comUsuario(u.id, async (c) => {
    const aConferir = gestao
      ? (await c.query(`
          select g.id, g.valor, g.data, g.modalidade, p.id as pedido_id, p.moeda, p.bling_numero,
                 p.cliente_nome, p.vendedora_nome
            from app.pagamentos g join app.v_pedidos p on p.id = g.pedido_id
           where g.status_conferencia = 'pendente'
           order by g.registrado_em limit 30`)).rows
      : [];
    const metasPropostas = gestao
      ? (await c.query(`select count(*)::int n from app.metas_cliente where status = 'proposta'`)).rows[0].n
      : 0;
    const recusados = (await c.query(`
        select g.id, g.valor, g.motivo_recusa, p.id as pedido_id, p.moeda, p.cliente_nome
          from app.pagamentos g join app.v_pedidos p on p.id = g.pedido_id
         where g.status_conferencia = 'recusado' and g.conferido_em > now() - interval '7 days'
         order by g.conferido_em desc limit 20`)).rows;
    const envioAtrasado = (await c.query(`
        select id, cliente_nome, previsao_envio, valor_total, moeda, vendedora_nome
          from app.v_pedidos where envio_atrasado order by previsao_envio limit 30`)).rows;
    const pagAtrasado = (await c.query(`
        select id, cliente_nome, vencimento, saldo, moeda, vendedora_nome
          from app.v_pedidos where status_pagamento = 'atrasado' order by vencimento limit 30`)).rows;
    const metasPerto = (await c.query(`
        select id, cliente_nome, falta, dias_restantes, moeda, percentual
          from app.v_metas where status = 'aprovada' and not meta_batida and dias_restantes <= 10
          order by dias_restantes limit 20`)).rows;
    const transferencias = (await c.query(`
        select t.id, t.numero, o.nome origem, d.nome destino, t.enviada_em
          from app.transferencias t join app.depositos o on o.id = t.origem_id join app.depositos d on d.id = t.destino_id
         where t.status = 'enviada' and app.pode_operar_deposito(t.destino_id)
         order by t.enviada_em`)).rows;
    const portal = (await c.query(`
        select id, cliente_nome, valor_total, moeda, data_pedido, vendedora_nome from app.v_pedidos
         where status_comercial = 'aguardando_aprovacao' order by criado_em`)).rows;
    const separar = (await c.query(`
        select v.id, v.cliente_nome, v.data_pedido, d.nome as deposito from app.v_pedidos v
          join app.pedidos p on p.id = v.id join app.depositos d on d.id = p.deposito_id
         where v.status_comercial = 'em_separacao' and v.origem <> 'bling' and p.separacao_conferida_em is null
           and (app.pode_gerir() or app.pode_operar_deposito(p.deposito_id)) order by v.data_pedido`)).rows;
    const confirmar = (await c.query(`
        select v.id, v.cliente_nome, v.valor_total, v.moeda from app.v_pedidos v join app.pedidos p on p.id = v.id
         where v.status_comercial = 'em_separacao' and p.separacao_conferida_em is not null and p.total_confirmado_em is null
         order by p.separacao_conferida_em`)).rows;
    const pendencias = gestao ? (await c.query(`select count(*)::int n from app.estoque_pendencias where resolvida_em is null`)).rows[0].n : 0;
    const site = (await c.query(`
        select s.* from app.pedidos_site s
         where s.atendido_em is null
           and (app.pode_gerir() or s.pais = (select pais from app.vendedoras where id = app.minha_vendedora()))
         order by s.criado_em desc limit 30`)).rows;
    const cadastros = Number((await c.query("select count(*) n from app.cadastros_site where atendido_em is null")).rows[0].n);
    const sugestoesCredito = gestao ? (await c.query(`select c.id, c.nome, c.moeda, c.credito_sugestao_limite, c.credito_sugestao_prazo, u.nome as quem
        from app.clientes c left join app.usuarios u on u.id = c.credito_sugerido_por
       where c.credito_sugestao_limite is not null order by c.credito_sugerido_em`)).rows : [];
    // Destaques do mês para gerente e administrativo: quem vendeu mais e menos, produto que mais e menos lucrou, contas
    const destaques = gestao ? {
      vendedoras: (await c.query(`select vendedora_nome nome, moeda, sum(receita) receita from app.v_itens_lucro
          where data_pedido >= date_trunc('month', current_date) group by 1, 2 order by 2, 3 desc`)).rows,
      produtos: (await c.query(`select produto nome, moeda, sum(quantidade) qtd, sum(lucro) lucro from app.v_itens_lucro
          where data_pedido >= date_trunc('month', current_date) and lucro is not null group by 1, 2 order by 2, 4 desc`)).rows,
      procuras: (await c.query(`select coalesce(sum(novos), 0)::int novos, count(*) filter (where novos > 0)::int produtos
          from app.v_procuras_resumo`)).rows[0] as { novos: number; produtos: number },
      contas: (await c.query(`select moeda, count(*) filter (where situacao = 'vencida')::int vencidas,
          coalesce(sum(valor) filter (where situacao = 'vencida'), 0) valor_vencidas,
          count(*) filter (where situacao in ('vence_hoje','vence_7_dias'))::int semana,
          coalesce(sum(valor) filter (where situacao in ('vence_hoje','vence_7_dias')), 0) valor_semana
          from app.v_despesas where pago_em is null group by moeda order by moeda desc`)).rows,
    } : null;
    // Pedidos em aberto com item sem estoque (o cliente não vê "esgotado": a vendedora confere e avisa)
    const semEstoque = (await c.query(`select p.id, coalesce(cl.nome, 'Cliente') cliente, v.nome vendedora, p.data_pedido,
         string_agg(regexp_replace(i.descricao, ' · SEM ESTOQUE.*$', '') || ' (' || trim(to_char(i.quantidade, 'FM999990')) || ')', '; ' order by i.descricao) itens
        from app.pedidos p join app.pedido_itens i on i.pedido_id = p.id
        left join app.clientes cl on cl.id = p.cliente_id join app.vendedoras v on v.id = p.vendedora_id
       where i.descricao ilike '%SEM ESTOQUE%' and p.status_comercial::text in ('aguardando_cliente','aguardando_aprovacao','em_separacao')
       group by p.id, cl.nome, v.nome, p.data_pedido order by p.data_pedido desc limit 30`).catch(() => ({ rows: [] }))).rows as
      { id: string; cliente: string; vendedora: string; data_pedido: string; itens: string }[];
    const fila = await carregarFila(c);
    const meu = gestao ? "" : "and v.vendedora_id = app.minha_vendedora()";
    const mes = (await c.query(`select v.moeda, coalesce(sum(v.valor_total), 0) vendido, count(*)::int n
        from app.v_pedidos v where v.status_comercial <> 'cancelado' and v.data_pedido >= date_trunc('month', current_date) ${meu}
          and not exists (select 1 from app.canais k where k.codigo = v.canal and k.marketplace)
       group by 1 order by 1 desc`)).rows as { moeda: Moeda; vendido: string; n: number }[];
    const receber = (await c.query(`select v.moeda, coalesce(sum(v.saldo), 0) saldo, count(*)::int n from app.v_pedidos v
        where v.saldo > 0 and v.status_comercial <> 'cancelado' ${meu} group by 1 order by 1 desc`)).rows as { moeda: Moeda; saldo: string; n: number }[];
    const comissao = gestao ? [] : (await c.query(`select moeda, comissao from app.comissoes(date_trunc('month', current_date)::date)
        where vendedora_id = app.minha_vendedora()`).catch(() => ({ rows: [] }))).rows as { moeda: Moeda; comissao: string | null }[];
    const recompra = (await c.query(`select r.* from app.recompra_clientes() r
        where r.atraso_dias > 0 and exists (select 1 from app.clientes cl where cl.id = r.cliente_id and cl.ativo)
          ${gestao ? "" : "and r.vendedora_id = app.minha_vendedora()"}
        order by r.alto_valor desc, r.atraso_dias desc limit 6`).catch(() => ({ rows: [] }))).rows as Recompra[];
    const carrinhos = (await c.query(`select * from app.carrinhos_parados() where avisado_em is null order by atualizado_em desc limit 5`)
      .catch(() => ({ rows: [] }))).rows as Carrinho[];
    const esperando = (await c.query(`select contato, texto, em from (
          select distinct on (m.conexao_id, m.contato) m.contato, m.texto, m.em, m.enviada
            from app.whatsapp_mensagens m where m.em > now() - interval '3 days'
           order by m.conexao_id, m.contato, m.em desc) x
        where not x.enviada order by em limit 50`).catch(() => ({ rows: [] }))).rows as Espera[];
    return { fila, mes, receber, comissao, recompra, carrinhos, esperando, semEstoque, destaques, sugestoesCredito, cadastros, site, aConferir, metasPropostas, recusados, envioAtrasado, pagAtrasado, metasPerto, transferencias, portal, separar, confirmar, pendencias };
  });

  return (
    <>
      <section className="linha entre">
        <div>
          <h1>Bom trabalho, {u.nome.split(" ")[0]}</h1>
          <div className="suave">{gestao ? "O que precisa de atenção hoje." : "Seu painel: pedidos, clientes para chamar e conversas esperando."}</div>
        </div>
        <Link className="botao principal" href="/pedidos/novo">+ Novo pedido</Link>
      </section>

      <div className="kpis">
        {d.mes.length === 0 && <div className="kpi marca"><span className="rotulo">{gestao ? "Vendido no mês" : "Você vendeu no mês"}</span><span className="valor">—</span></div>}
        {d.mes.map((m) => (
          <div key={m.moeda} className="kpi marca"><span className="rotulo">{gestao ? "Vendido no mês" : "Você vendeu no mês"} ({m.moeda === "GS" ? "Gs" : "R$"})</span>
            <span className="valor num">{dinheiro(m.vendido, m.moeda)}</span><span className="pequeno">{m.n} pedido(s)</span></div>
        ))}
        {d.comissao.filter((x) => x.comissao !== null).map((x) => (
          <Link key={x.moeda} href="/comissoes" className="kpi"><span className="rotulo">Sua comissão no mês</span>
            <span className="valor num">{dinheiro(x.comissao, x.moeda)}</span><span className="pequeno suave">ver detalhes →</span></Link>
        ))}
        {d.receber.map((r) => (
          <Link key={r.moeda} href="/pedidos?pagamento=aguardando" className="kpi"><span className="rotulo">A receber de clientes ({r.moeda === "GS" ? "Gs" : "R$"})</span>
            <span className="valor num">{dinheiro(r.saldo, r.moeda)}</span><span className="pequeno suave">{r.n} pedido(s) com saldo</span></Link>
        ))}
        <Link href="/whatsapp?f=aguardando&o=espera" className="kpi"><span className="rotulo">WhatsApp esperando resposta</span>
          <span className="valor">{d.esperando.length}</span><span className="pequeno suave">últimos 3 dias</span></Link>
      </div>

      <FilaPedidos itens={d.fila} titulo={gestao ? "Pedidos em andamento" : "Seus pedidos em andamento"} />

      <div className="crm">
        <section className="painel">
          <div className="linha entre"><h2>Chamar hoje (recompra)</h2><Link className="pequeno" href="/clientes/recompra">ver todos →</Link></div>
          {d.recompra.length === 0 ? <p className="suave pequeno">Nenhum cliente passou do ritmo de compra. 👏</p> : (
            <ul className="crm-lista">{d.recompra.map((r) => {
              const z = linkWhatsApp(r.whatsapp, `Olá ${r.nome}! Tudo bem? Aqui é da Virtual Cosméticos. Já está na hora de repor o estoque? Posso te mandar as novidades e promoções da semana?`);
              return (
                <li key={r.cliente_id}>
                  <Link href={`/clientes/${r.cliente_id}`} className="crm-quem">{r.nome}{r.alto_valor && " ⭐"}
                    <small>{r.dias_desde} dias sem comprar · {r.atraso_dias} de atraso{gestao ? ` · ${r.vendedora}` : ""}</small></Link>
                  {z && <a className="botao whatsapp mini" href={z} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
                </li>);
            })}</ul>
          )}
        </section>
        <section className="painel">
          <div className="linha entre"><h2>Esperando resposta</h2><Link className="pequeno" href="/whatsapp?f=aguardando&o=espera">abrir WhatsApp →</Link></div>
          {d.esperando.length === 0 ? <p className="suave pequeno">Ninguém esperando. Tudo respondido.</p> : (
            <ul className="crm-lista">{d.esperando.slice(0, 6).map((m, k) => (
              <li key={k}>
                <span className="crm-quem">{telefone(m.contato)}<small>{(m.texto ?? "(mídia)").slice(0, 60)}</small></span>
                <span className="pequeno suave num">{dataHora(m.em)}</span>
              </li>))}</ul>
          )}
        </section>
        <section className="painel">
          <div className="linha entre"><h2>Carrinhos parados</h2><Link className="pequeno" href="/clientes/carrinhos">ver todos →</Link></div>
          {d.carrinhos.length === 0 ? <p className="suave pequeno">Nenhum carrinho esquecido no site.</p> : (
            <ul className="crm-lista">{d.carrinhos.map((x) => {
              const z = linkWhatsApp(x.whatsapp, `Olá ${x.cliente}! Vi que você montou um carrinho no nosso site. Quer que eu finalize o pedido para você?`);
              return (
                <li key={x.cliente_id}>
                  <Link href={`/clientes/${x.cliente_id}`} className="crm-quem">{x.cliente}<small>{x.itens} item(ns) · {data(x.atualizado_em)}{gestao ? ` · ${x.vendedora}` : ""}</small></Link>
                  {z && <a className="botao whatsapp mini" href={z} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
                </li>);
            })}</ul>
          )}
        </section>
      </div>

      <nav className="atalhos" aria-label="Atalhos">
        {gestao && <Link className="atalho" href="/abertura"><b>Abertura da loja</b><span>Preços, estoque e fotos que faltam</span></Link>}
        <Link className="atalho" href="/clientes"><b>Clientes</b><span>Cadastro, crédito e acesso à loja</span></Link>
        {gestao && <Link className="atalho" href="/produtos/precos-rapido"><b>Editar preços</b><span>Preencher e ajustar preços na tabela</span></Link>}
        <Link className="atalho" href="/produtos"><b>Produtos</b><span>Buscar, ativar, fotos e caixas</span></Link>
        <Link className="atalho" href="/relatorios"><b>Relatórios</b><span>Vendas, mais vendidos e estoque</span></Link>
        <Link className="atalho" href="/estoque"><b>Estoque</b><span>Saldo por depósito e ajustes</span></Link>
      </nav>

      {d.destaques && <Destaques d={d.destaques} />}

      <div className="indicadores">
        {gestao && (
          <div className="indicador">
            <span className="rotulo">Pagamentos a conferir</span>
            <span className="valor">{d.aConferir.length}</span>
          </div>
        )}
        {gestao && (
          <Link href="/metas?status=proposta" className="indicador" style={{ textDecoration: "none", color: "inherit" }}>
            <span className="rotulo">Metas para aprovar</span>
            <span className="valor">{d.metasPropostas}</span>
          </Link>
        )}
        <div className="indicador">
          <span className="rotulo">Envios atrasados</span>
          <span className="valor">{d.envioAtrasado.length}</span>
        </div>
        <div className="indicador">
          <span className="rotulo">Pagamentos atrasados</span>
          <span className="valor">{d.pagAtrasado.length}</span>
        </div>
        <div className="indicador">
          <span className="rotulo">Transferências a receber</span>
          <span className="valor">{d.transferencias.length}</span>
        </div>
      </div>

      {d.semEstoque.length > 0 && (
        <section className="painel">
          <h2 style={{ margin: 0 }}>Pedidos com produto esgotado ({d.semEstoque.length})</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>O cliente não vê que está esgotado. Confira com o estoque/fornecedor e avise o cliente: prazo de chegada ou troca do produto.</p>
          <div className="tabela"><table style={{ minWidth: 0 }}>
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Vendedora</th><th>Sem estoque</th></tr></thead>
            <tbody>{d.semEstoque.map((x) => (
              <tr key={x.id}><td><Link href={`/pedidos/${x.id}`}>{new Date(x.data_pedido).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</Link></td>
                <td>{x.cliente}</td><td>{x.vendedora}</td><td className="pequeno">{x.itens}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
      {d.cadastros > 0 && (
        <a href="/site#cadastros" className="aviso-caixa aviso" style={{ textDecoration: "none", color: "inherit" }}>
          <b>{d.cadastros} {d.cadastros === 1 ? "novo cadastro" : "novos cadastros"} pelo site</b> (Quero ser cliente) aguardando contato.
        </a>
      )}

      {d.site.length > 0 && (
        <section className="painel">
          <h2>Pedidos do site (ainda não são clientes)</h2>
          <p className="pequeno suave">A pessoa montou o pedido no site e foi enviada para o WhatsApp da empresa. Responda com os preços e, se fechar, cadastre como cliente.</p>
          {gestao && d.site.length > 1 && (
            <form action={apagarPedidosSite} className="linha" style={{ gap: 8 }}>
              {d.site.map((s) => <input key={s.id} type="hidden" name="id" value={s.id} />)}
              <button className="perigo pequeno">Apagar todos os {d.site.length} desta lista (eram testes)</button>
            </form>
          )}
          <div className="tabela"><table>
            <thead><tr><th>Quando</th><th>Quem</th><th>Itens</th><th></th></tr></thead>
            <tbody>{d.site.map((s) => {
              const itens = s.itens as { nome: string; quantidade: number }[];
              const zap = linkWhatsApp(s.whatsapp, `Olá, ${s.nome}! Aqui é da Virtual Cosméticos, recebemos o seu pedido pelo site.`);
              return (
                <tr key={s.id}>
                  <td className="num">{dataHora(s.criado_em)}</td>
                  <td>
                    <b>{s.nome}</b> <Selo>{s.pais === "PY" ? "Paraguai" : "Brasil"}</Selo>
                    <div className="pequeno suave">{s.cidade ?? ""} {zap && <a href={zap} target="_blank" rel="noopener noreferrer">{telefone(s.whatsapp)}</a>}</div>
                    {s.observacao && <div className="pequeno">{s.observacao}</div>}
                  </td>
                  <td className="pequeno">{itens.map((i, k) => <div key={k}>{Number(i.quantidade)}× {i.nome}</div>)}</td>
                  <td><div className="linha" style={{ gap: 6, flexWrap: "wrap" }}>
                    <form action={marcarPedidoSiteAtendido}><input type="hidden" name="id" value={s.id} /><button>Atendido</button></form>
                    {gestao && <form action={apagarPedidosSite}><input type="hidden" name="id" value={s.id} /><button className="discreto pequeno" title="Pedido de teste: some da lista">Apagar (teste)</button></form>}
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </section>
      )}

            </div>
          </div>
        </section>
      )}

      {gestao && d.pendencias > 0 && (
        <div className="aviso-caixa aviso linha entre">
          <span>{d.pendencias} pendência(s) de estoque de pedidos de marketplace (falta de estoque ou código sem cadastro).</span>
          <Link href="/estoque#pendencias">Ver pendências</Link>
        </div>
      )}

      {gestao && d.sugestoesCredito.length > 0 && (
        <section className="painel">
          <h2>Crédito sugerido pelas vendedoras</h2>
          <ul className="lista-simples">{d.sugestoesCredito.map((x) => (
            <li key={x.id}><Link href={`/clientes/${x.id}`}>{x.nome}</Link>: limite {dinheiro(x.credito_sugestao_limite, x.moeda)} · {x.credito_sugestao_prazo} dias <span className="suave">({x.quem ?? "vendedora"})</span></li>))}
          </ul>
        </section>
      )}

      {gestao && (
        <section className="painel">
          <h2>Pagamentos a conferir</h2>
          {d.aConferir.length === 0 ? (
            <p className="suave">Nenhum pagamento esperando conferência.</p>
          ) : (
            <div className="tabela">
              <table>
                <thead>
                  <tr><th>Registrado</th><th>Cliente</th><th>Vendedora</th><th>Valor</th><th>Modalidade</th><th>Nº Bling</th><th></th></tr>
                </thead>
                <tbody>
                  {d.aConferir.map((g) => (
                    <tr key={g.id}>
                      <td className="num">{data(g.data)}</td>
                      <td>{g.cliente_nome ?? "—"}</td>
                      <td>{g.vendedora_nome}</td>
                      <td className="num">{dinheiro(g.valor, g.moeda as Moeda)}</td>
                      <td>{MODALIDADES[g.modalidade]}</td>
                      <td className="num">{g.bling_numero ?? <Selo cor="aviso">sem nº</Selo>}</td>
                      <td><Link href={`/pedidos/${g.pedido_id}#pagamentos`}>Conferir</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {d.recusados.length > 0 && (
        <section className="painel">
          <h2>Pagamentos recusados (últimos 7 dias)</h2>
          <ul className="lista-simples">
            {d.recusados.map((g) => (
              <li key={g.id}>
                <Link href={`/pedidos/${g.pedido_id}`}>{g.cliente_nome ?? "Pedido"}</Link>{" "}
                <span className="num">{dinheiro(g.valor, g.moeda as Moeda)}</span>: {g.motivo_recusa}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="duas-colunas">
        <section className="painel">
          <h2>Envios atrasados</h2>
          {d.envioAtrasado.length === 0 ? <p className="suave">Nenhum envio atrasado.</p> : (
            <ul className="lista-simples">
              {d.envioAtrasado.map((p) => (
                <li key={p.id}>
                  <Link href={`/pedidos/${p.id}`}>{p.cliente_nome ?? "Pedido"}</Link>: previsto para {data(p.previsao_envio)}
                  {gestao && <span className="suave"> · {p.vendedora_nome}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="painel">
          <h2>Pagamentos atrasados</h2>
          {d.pagAtrasado.length === 0 ? <p className="suave">Nenhum pagamento atrasado.</p> : (
            <ul className="lista-simples">
              {d.pagAtrasado.map((p) => (
                <li key={p.id}>
                  <Link href={`/pedidos/${p.id}`}>{p.cliente_nome ?? "Pedido"}</Link>:{" "}
                  <span className="num">{dinheiro(p.saldo, p.moeda as Moeda)}</span> vencido em {data(p.vencimento)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="duas-colunas">
        <section className="painel">
          <h2>Metas perto do prazo</h2>
          {d.metasPerto.length === 0 ? <p className="suave">Nenhuma meta terminando nos próximos 10 dias.</p> : (
            <ul className="lista-simples">
              {d.metasPerto.map((m) => (
                <li key={m.id}>
                  <Link href="/metas">{m.cliente_nome}</Link>: faltam{" "}
                  <span className="num">{dinheiro(m.falta, m.moeda as Moeda)}</span> em {m.dias_restantes} dia(s)
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="painel">
          <h2>Transferências para receber</h2>
          {d.transferencias.length === 0 ? <p className="suave">Nada em trânsito para os seus depósitos.</p> : (
            <ul className="lista-simples">
              {d.transferencias.map((t) => (
                <li key={t.id}>
                  <Link href="/estoque#transferencias">Nº {t.numero}</Link>: {t.origem} → {t.destino}, enviada em {data(t.enviada_em)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

type Destaque = { procuras: { novos: number; produtos: number }; vendedoras: { nome: string; moeda: Moeda; receita: string }[]; produtos: { nome: string; moeda: Moeda; qtd: string; lucro: string }[];
  contas: { moeda: Moeda; vencidas: number; valor_vencidas: string; semana: number; valor_semana: string }[] };

/** Painel do mês para a gestão: mais e menos vendido, maior e menor lucro e contas a vencer. */
function Destaques({ d }: { d: Destaque }) {
  const moedas = [...new Set([...d.vendedoras, ...d.produtos].map((x) => x.moeda))];
  const contas = d.contas.filter((c) => c.vencidas > 0 || c.semana > 0);
  if (moedas.length === 0 && contas.length === 0 && d.procuras.novos === 0) return null;
  return (
    <section className="painel">
      <div className="linha entre">
        <h2>Destaques do mês</h2>
        <Link href="/relatorios?aba=lucro">Ver relatório completo →</Link>
      </div>
      <div className="indicadores">
        {moedas.map((m) => {
          const v = d.vendedoras.filter((x) => x.moeda === m);
          const p = d.produtos.filter((x) => x.moeda === m);
          const sufixo = m === "GS" ? " (Gs)" : " (R$)";
          return [
            v.length > 0 && <div key={m + "vm"} className="indicador"><span className="rotulo">Vendeu mais{sufixo}</span><span className="valor">{v[0].nome}</span><span className="pequeno suave">{dinheiro(v[0].receita, m)}</span></div>,
            v.length > 1 && <div key={m + "vn"} className="indicador"><span className="rotulo">Vendeu menos{sufixo}</span><span className="valor">{v[v.length - 1].nome}</span><span className="pequeno suave">{dinheiro(v[v.length - 1].receita, m)}</span></div>,
            p.length > 0 && <div key={m + "pm"} className="indicador"><span className="rotulo">Produto que mais lucrou{sufixo}</span><span className="valor" style={{ fontSize: "1rem" }}>{p[0].nome}</span><span className="pequeno suave">{dinheiro(p[0].lucro, m)} · {Number(p[0].qtd).toLocaleString("pt-BR")} un</span></div>,
            p.length > 1 && <div key={m + "pn"} className="indicador"><span className="rotulo">Produto que menos lucrou{sufixo}</span><span className="valor" style={{ fontSize: "1rem" }}>{p[p.length - 1].nome}</span><span className="pequeno suave">{dinheiro(p[p.length - 1].lucro, m)} · {Number(p[p.length - 1].qtd).toLocaleString("pt-BR")} un</span></div>,
          ];
        })}
        {d.procuras.novos > 0 && (
          <Link href="/procuras" className="indicador" style={{ textDecoration: "none", color: "inherit" }}>
            <span className="rotulo">Clientes pediram sem estoque</span>
            <span className="valor">{d.procuras.novos}</span>
            <span className="pequeno suave">{d.procuras.produtos} produto(s) · para as próximas compras</span>
          </Link>
        )}
        {contas.map((c) => (
          <Link key={c.moeda} href="/despesas?ver=semana" className="indicador" style={{ textDecoration: "none", color: "inherit" }}>
            <span className="rotulo">Contas a pagar ({c.moeda === "GS" ? "Gs" : "R$"})</span>
            <span className="valor">{c.vencidas > 0 ? `${c.vencidas} vencida${c.vencidas > 1 ? "s" : ""}` : `${c.semana} em 7 dias`}</span>
            <span className="pequeno suave">{c.vencidas > 0 ? dinheiro(c.valor_vencidas, c.moeda) + " vencido" : ""}{c.vencidas > 0 && c.semana > 0 ? " · " : ""}{c.semana > 0 ? dinheiro(c.valor_semana, c.moeda) + " na semana" : ""}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
