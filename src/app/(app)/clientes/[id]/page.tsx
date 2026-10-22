import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario, podeEscrever, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import {
  dinheiro, data, dataHora, linkWhatsApp, STATUS_COMERCIAL, STATUS_PAGAMENTO, COR_PAGAMENTO, STATUS_META, TIPO_ATENDIMENTO,
  type Moeda,
} from "@/lib/formato";
import { Avisos, Barra, Selo } from "../../avisos";
import { ativarCliente, atendimentoCliente, cancelarSaldoAnterior, lancarSaldoAnterior, pedirCompraUnidade, trocarVendedoraCliente, bloquearCliente, decidirCompraUnidade, decidirClienteLocal, definirCredito, depositoCliente, recusarSugestaoCredito, salvarCliente, sugerirClienteLocal, sugerirCredito } from "../acoes";
import { AcessoCliente } from "./acesso-cliente";

export const metadata = { title: "Cliente" };

const ABAS = [
  { k: "resumo", t: "Resumo" }, { k: "pedidos", t: "Pedidos e metas" }, { k: "atendimentos", t: "Atendimentos" },
  { k: "loja", t: "Loja e acesso" }, { k: "credito", t: "Crédito" }, { k: "cadastro", t: "Cadastro" },
] as const;
type Aba = (typeof ABAS)[number]["k"];

export default async function Cliente({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string; convite?: string; aba?: string }>;
}) {
  const u = await exigirUsuario();
  const { id } = await params;
  const avisos = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await comUsuario(u.id, async (c) => {
    const cli = (await c.query(
      `select c.*, v.nome as vendedora, v.whatsapp as vendedora_whatsapp from app.clientes c
         join app.vendedoras v on v.id = c.vendedora_id where c.id = $1`, [id])).rows[0];
    if (!cli) return null;
    return {
      cli,
      pedidos: (await c.query(
        `select id, data_pedido, bling_numero, valor_total, saldo, status_comercial, status_pagamento
           from app.v_pedidos where cliente_id = $1 order by data_pedido desc limit 100`, [id])).rows,
      metas: (await c.query("select * from app.v_metas where cliente_id = $1 order by inicio desc", [id])).rows,
      depositos: (await c.query("select id, nome from app.depositos where ativo order by nome")).rows,
      depositoAtual: (await c.query("select d.nome from app.depositos d where d.id = app.deposito_do_cliente($1)", [id])).rows[0]?.nome ?? null,
      temAcesso: Boolean((await c.query("select 1 from app.portal_dados_login(coalesce((select documento from app.clientes where id = $1), '-'))", [id])).rowCount),
      sugeriu: cli.credito_sugerido_por ? (await c.query("select nome from app.usuarios where id = $1", [cli.credito_sugerido_por])).rows[0]?.nome ?? null : null,
      credito: (await c.query(
        `select coalesce(sum(v.saldo) filter (where v.saldo > 0), 0) as aberto,
                coalesce(sum(v.saldo) filter (where v.saldo > 0 and v.vencimento < current_date), 0) as vencido,
                coalesce(sum(v.a_conferir), 0) as conferir
           from app.v_pedidos v join app.pedidos x on x.id = v.id
          where v.cliente_id = $1 and v.status_comercial <> 'cancelado' and x.total_confirmado_em is not null`, [id])).rows[0],
      vendedoras: (await c.query("select id, nome from app.vendedoras where ativo order by nome")).rows as { id: string; nome: string }[],
      top: (await c.query(
        `select coalesce(pr.nome, i.descricao) as nome, sum(i.quantidade) as qtd, sum(i.total) as valor, max(p.data_pedido) as ultima
           from app.pedido_itens i join app.pedidos p on p.id = i.pedido_id left join app.produtos pr on pr.id = i.produto_id
          where p.cliente_id = $1 and p.status_comercial <> 'cancelado' and p.data_pedido >= current_date - 365
          group by 1 order by sum(i.total) desc limit 8`, [id])).rows as { nome: string; qtd: string; valor: string; ultima: string }[],
      saldoAnterior: (await c.query("select moeda, saldo, vencimento from app.v_saldo_anterior where cliente_id = $1 and saldo <> 0", [id])).rows as { moeda: Moeda; saldo: string; vencimento: string | null }[],
      saLanc: (await c.query(`select s.*, app.nome_usuario(s.criado_por) quem from app.saldos_anteriores s
         where s.cliente_id = $1 order by s.data desc, s.criado_em desc limit 50`, [id])).rows,
      atendimentos: (await c.query(
        `select a.*, u.nome as usuario_nome from app.atendimentos a left join app.usuarios u on u.id = a.usuario_id
          where a.cliente_id = $1 order by a.em desc limit 50`, [id])).rows,
    };
  });
  if (!d) notFound();
  const { cli } = d;
  const moeda = cli.moeda as Moeda;
  const ativos = d.pedidos.filter((p) => p.status_comercial !== "cancelado");
  const total = ativos.reduce((s, p) => s + Number(p.valor_total), 0);
  const saldo = ativos.reduce((s, p) => s + Number(p.saldo), 0);
  const metaAtiva = d.metas.find((m) => m.status === "aprovada");
  const msg = metaAtiva && !metaAtiva.meta_batida
    ? `Olá ${cli.nome}! Aqui é a ${cli.vendedora}, da Virtual Cosméticos. Faltam ${dinheiro(metaAtiva.falta, moeda)} em compras até ${data(metaAtiva.fim)} para você ganhar ${dinheiro(metaAtiva.valor_premio, moeda)} em mercadorias!`
    : `Olá ${cli.nome}! Aqui é a ${cli.vendedora}, da Virtual Cosméticos. Tudo bem?`;
  const whats = linkWhatsApp(cli.whatsapp ?? cli.telefone, msg);
  const ro = !podeEscrever(u);
  const gestao = ehGestao(u);
  const aba: Aba = ABAS.find((a) => a.k === avisos.aba)?.k ?? (avisos.convite ? "loja" : "resumo");
  const Aba = ({ k }: { k: Aba }) => <input type="hidden" name="aba" value={k} />;
  const diasSem = ativos[0] ? Math.floor((Date.now() - new Date(ativos[0].data_pedido).getTime()) / 86400000) : null;
  const vencido = Number(d.credito.vencido);
  const fone = cli.whatsapp ?? cli.telefone;

  // O que precisa de atenção neste cliente (cada item leva para a aba certa)
  const pend: { cor: string; texto: React.ReactNode; aba: Aba }[] = [];
  for (const sa of d.saldoAnterior) if (Number(sa.saldo) > 0) pend.push({ cor: "aviso", texto: <>Saldo anterior: <b className="num">{dinheiro(sa.saldo, sa.moeda)}</b></>, aba: "credito" });
  if (vencido > 0) pend.push({ cor: "erro", texto: <>Pagamento vencido: <b className="num">{dinheiro(vencido, moeda)}</b></>, aba: "credito" });
  if (Number(d.credito.conferir) > 0) pend.push({ cor: "aviso", texto: <>Pagamentos a aprovar: <b className="num">{dinheiro(d.credito.conferir, moeda)}</b></>, aba: "credito" });
  if (cli.credito_sugestao_limite != null) pend.push({ cor: "aviso", texto: <>Sugestão de crédito aguardando o gerente</>, aba: "credito" });
  if (cli.compra_unidade_sugerido_em && !cli.compra_unidade && cli.categoria_preco !== "vip") pend.push({ cor: "aviso", texto: <>Compra por unidade aguardando o gerente</>, aba: "loja" });
  if (cli.pais === "PY" && cli.cliente_local_sugerido_em && !cli.cliente_local) pend.push({ cor: "aviso", texto: <>Sugerido como cliente local: aguardando o gerente</>, aba: "loja" });
  if (cli.ativo && cli.portal_ativo && !d.temAcesso) pend.push({ cor: "info", texto: <>Ainda não tem acesso à loja</>, aba: "loja" });
  if (cli.ativo && diasSem != null && diasSem > 45) pend.push({ cor: "info", texto: <>Sem comprar há <b>{diasSem} dias</b></>, aba: "atendimentos" });

  const formAtendimento = !ro && (
    <form action={atendimentoCliente} className="campos">
      <input type="hidden" name="cliente_id" value={cli.id} /><Aba k={aba === "resumo" ? "resumo" : "atendimentos"} />
      <label>Tipo
        <select name="tipo" defaultValue="whatsapp">
          {Object.entries(TIPO_ATENDIMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label>Resultado<input name="resultado" /></label>
      <label className="largo">O que foi conversado<textarea name="nota" /></label>
      <button>Registrar</button>
    </form>
  );
  const listaAtendimentos = (n: number) => d.atendimentos.length === 0 ? <p className="suave">Nenhum atendimento registrado.</p> : (
    <ul className="ficha-lista">
      {d.atendimentos.slice(0, n).map((a) => (
        <li key={a.id}>
          <div className="linha entre"><b>{TIPO_ATENDIMENTO[a.tipo]}</b><span className="pequeno suave">{dataHora(a.em)} · {a.usuario_nome}</span></div>
          {a.resultado && <div>{a.resultado}</div>}
          {a.nota && <div className="pequeno suave">{a.nota}</div>}
        </li>
      ))}
    </ul>
  );
  const tabelaPedidos = (lista: typeof d.pedidos) => (
    <div className="tabela"><table>
      <thead><tr><th>Data</th><th>Nº Bling</th><th>Total</th><th>Saldo</th><th>Pagamento</th><th>Status</th></tr></thead>
      <tbody>{lista.map((p) => (
        <tr key={p.id}>
          <td className="num"><Link href={`/pedidos/${p.id}`}>{data(p.data_pedido)}</Link></td>
          <td className="num">{p.bling_numero ?? "—"}</td>
          <td className="num">{dinheiro(p.valor_total, moeda)}</td>
          <td className="num">{dinheiro(p.saldo, moeda)}</td>
          <td><Selo cor={COR_PAGAMENTO[p.status_pagamento]}>{STATUS_PAGAMENTO[p.status_pagamento]}</Selo></td>
          <td>{STATUS_COMERCIAL[p.status_comercial]}</td>
        </tr>))}
      </tbody></table></div>
  );

  return (
    <>
      <Link href="/clientes">← Clientes</Link>
      <section className="painel ficha-topo">
        <div className="ficha-id">
          <h1>{cli.nome}</h1>
          <div className="linha ficha-selos">
            {!cli.ativo && <Selo cor="erro">Inativo</Selo>}
            <Selo>{cli.pais === "PY" ? "Paraguai · Gs" : "Brasil · R$"}</Selo>
            <Selo cor={cli.categoria_preco === "vip" ? "marca" : ""}>{cli.categoria_preco === "vip" ? "VIP" : "Normal"}</Selo>
            {cli.pais === "PY" && cli.cliente_local && <Selo cor="ok">Cliente local</Selo>}
            {cli.credito_habilitado && <Selo cor="ok">Crédito {cli.prazo_credito_dias}d</Selo>}
            {cli.compra_unidade && cli.categoria_preco !== "vip" && <Selo cor="info">Compra por unidade</Selo>}
            <Selo cor={!cli.portal_ativo ? "erro" : d.temAcesso ? "ok" : "aviso"}>{!cli.portal_ativo ? "Loja bloqueada" : d.temAcesso ? "Acessa a loja" : "Sem acesso à loja"}</Selo>
            {cli.perfil_comercial && <Selo>{cli.perfil_comercial}</Selo>}
          </div>
          <div className="ficha-dados pequeno">
            <span><span className="suave">Vendedora</span> <b>{cli.vendedora}</b></span>
            {fone && <span><span className="suave">WhatsApp</span> {fone}</span>}
            {(cli.cidade || cli.departamento) && <span><span className="suave">Cidade</span> {[cli.cidade, cli.departamento].filter(Boolean).join(" · ")}</span>}
            {cli.documento && <span><span className="suave">Documento</span> {cli.documento}</span>}
            <span><span className="suave">Cliente desde</span> {data(cli.criado_em)}</span>
          </div>
          {!cli.ativo && <div className="pequeno suave">Desativado{cli.inativado_em ? ` em ${new Date(cli.inativado_em).toLocaleDateString("pt-BR")}` : ""}{cli.motivo_inativo ? ` · ${cli.motivo_inativo}` : ""}. Continua no sistema e sendo atualizado; não aparece nas listas do dia a dia.</div>}
        </div>
        <div className="ficha-acoes">
          {!ro && <Link className="botao principal" href={`/pedidos/novo?cliente=${cli.id}`}>Novo pedido</Link>}
          {whats && <a className="botao whatsapp" href={whats} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
          {!ro && <Link className="botao" href={`/metas?cliente=${cli.id}#propor`}>Propor meta</Link>}
        </div>
      </section>
      <Avisos ok={avisos.ok} erro={avisos.erro} />

      <div className="indicadores">
        <div className="indicador"><span className="rotulo">Total comprado</span><span className="valor num">{dinheiro(total, moeda)}</span></div>
        <div className="indicador"><span className="rotulo">Pedidos</span><span className="valor">{ativos.length}</span></div>
        <div className="indicador"><span className="rotulo">Ticket médio</span><span className="valor num">{ativos.length ? dinheiro(total / ativos.length, moeda) : "—"}</span></div>
        <div className={`indicador ${saldo > 0 ? "destaque-aviso" : ""}`}><span className="rotulo">Saldo em aberto</span><span className="valor num">{dinheiro(saldo, moeda)}</span></div>
        <div className="indicador"><span className="rotulo">Última compra</span><span className="valor">{data(ativos[0]?.data_pedido)}</span>{diasSem != null && <span className="pequeno suave">há {diasSem} dia(s)</span>}</div>
      </div>

      {pend.length > 0 && (
        <section className="ficha-pendencias" aria-label="Precisa de atenção">
          <b>Precisa de atenção</b>
          {pend.map((x, k) => <Link key={k} href={`/clientes/${cli.id}?aba=${x.aba}`} className={`ficha-pend ${x.cor}`}>{x.texto} →</Link>)}
        </section>
      )}

      <nav className="abas" aria-label="Ficha do cliente">
        {ABAS.map((a) => (
          <Link key={a.k} href={`/clientes/${cli.id}?aba=${a.k}`} aria-current={a.k === aba ? "page" : undefined}>
            {a.t}{a.k === "pedidos" ? ` (${d.pedidos.length})` : a.k === "atendimentos" ? ` (${d.atendimentos.length})` : ""}
          </Link>
        ))}
      </nav>

      {aba === "resumo" && (<>
        {metaAtiva && (
          <section className="painel">
            <div className="linha entre">
              <h2>Meta em andamento</h2>
              <span className="suave">{data(metaAtiva.inicio)} a {data(metaAtiva.fim)} · {metaAtiva.dias_restantes} dia(s) restantes</span>
            </div>
            <Barra percentual={Number(metaAtiva.percentual)} ok={metaAtiva.meta_batida} />
            <div className="linha entre">
              <span><b className="num">{dinheiro(metaAtiva.vendido, moeda)}</b> de <span className="num">{dinheiro(metaAtiva.valor_meta, moeda)}</span></span>
              <span>Prêmio: <b className="num">{dinheiro(metaAtiva.valor_premio, moeda)}</b> {metaAtiva.descricao_premio ? `(${metaAtiva.descricao_premio})` : ""}</span>
            </div>
          </section>
        )}
        <div className="duas-colunas">
          <div className="coluna">
            <section className="painel">
              <div className="linha entre"><h2>Últimos pedidos</h2>{d.pedidos.length > 5 && <Link href={`/clientes/${cli.id}?aba=pedidos`}>Ver todos ({d.pedidos.length})</Link>}</div>
              {d.pedidos.length === 0 ? <p className="suave">Nenhum pedido ainda.</p> : tabelaPedidos(d.pedidos.slice(0, 5))}
            </section>
            <section className="painel">
              <h2>O que mais compra <span className="pequeno suave" style={{ fontWeight: 400 }}>(últimos 12 meses)</span></h2>
              {d.top.length === 0 ? <p className="suave">Sem compras no período.</p> : (
                <div className="tabela"><table>
                  <thead><tr><th>Produto</th><th>Qtd</th><th>Valor</th><th>Última vez</th></tr></thead>
                  <tbody>{d.top.map((x) => (
                    <tr key={x.nome}><td>{x.nome}</td><td className="num">{Number(x.qtd).toLocaleString("pt-BR")}</td><td className="num">{dinheiro(x.valor, moeda)}</td><td className="num">{data(x.ultima)}</td></tr>
                  ))}</tbody></table></div>
              )}
            </section>
          </div>
          <div className="coluna">
            <section className="painel">
              <div className="linha entre"><h2>Atendimentos</h2>{d.atendimentos.length > 3 && <Link href={`/clientes/${cli.id}?aba=atendimentos`}>Ver todos</Link>}</div>
              {formAtendimento && <details><summary>Registrar atendimento</summary><div style={{ marginTop: 8 }}>{formAtendimento}</div></details>}
              {listaAtendimentos(3)}
            </section>
            {(cli.preferencias || cli.observacoes) && (
              <section className="painel">
                <div className="linha entre"><h2>Anotações</h2><Link href={`/clientes/${cli.id}?aba=cadastro`}>Editar</Link></div>
                {cli.preferencias && <div><div className="pequeno suave">Preferências</div><div style={{ whiteSpace: "pre-wrap" }}>{cli.preferencias}</div></div>}
                {cli.observacoes && <div><div className="pequeno suave">Observações</div><div style={{ whiteSpace: "pre-wrap" }}>{cli.observacoes}</div></div>}
              </section>
            )}
          </div>
        </div>
      </>)}

      {aba === "pedidos" && (<>
        <section className="painel">
          <h2>Histórico de compras</h2>
          {d.pedidos.length === 0 ? <p className="suave">Nenhum pedido ainda.</p> : tabelaPedidos(d.pedidos)}
        </section>
        <section className="painel">
          <div className="linha entre"><h2>Metas</h2>{!ro && <Link href={`/metas?cliente=${cli.id}#propor`}>Propor meta</Link>}</div>
          {d.metas.length === 0 ? <p className="suave">Nenhuma meta.</p> : (
            <ul className="lista-simples">
              {d.metas.map((m) => (
                <li key={m.id}>
                  {data(m.inicio)} a {data(m.fim)}: <span className="num">{dinheiro(m.valor_meta, moeda)}</span> → prêmio{" "}
                  <span className="num">{dinheiro(m.valor_premio, moeda)}</span> <Selo>{STATUS_META[m.status]}</Selo>
                </li>
              ))}
            </ul>
          )}
        </section>
      </>)}

      {aba === "atendimentos" && (
        <section className="painel">
          <h2>Atendimentos</h2>
          {formAtendimento}
          {listaAtendimentos(50)}
        </section>
      )}

      {aba === "loja" && (
        <section className="painel">
          <h2>Área do cliente (atacado)</h2>
          <p className="pequeno suave">
            {!cli.portal_ativo ? "Acesso bloqueado." : d.temAcesso ? <>O cliente entra em <b>distribuidoravirtualcosmeticos.com/loja</b> com o documento e a senha.</> : "Ainda sem acesso: informe o documento e crie o acesso."} Estoque que ele vê: {d.depositoAtual ?? "—"}
            {d.depositoAtual === "Loja Ciudad del Este" ? " (site Virtual Cosméticos CDE: só o estoque da loja, por unidade ou caixa)" : ""}.
          </p>
          {!ro && <AcessoCliente clienteId={cli.id} documento={cli.documento ?? null} temAcesso={d.temAcesso} />}
          {!ro && cli.portal_ativo && d.temAcesso && (
            <div className="linha"><form action={bloquearCliente}><input type="hidden" name="cliente_id" value={cli.id} /><Aba k="loja" /><button className="perigo">Bloquear acesso</button></form></div>
          )}
          {/* Compra por unidade no site: vendedora pede, gerente aprova. Só preço Normal (BR e PY); VIP é sempre caixa fechada. */}
          <div className="ficha-opcao">
            <span className="pequeno">{cli.categoria_preco === "vip"
              ? <>Compra no site: <b>só caixa fechada</b> (cliente VIP).</>
              : cli.compra_unidade ? <>✓ <b>Compra por unidade liberada</b>: no site ele escolhe caixa fechada ou unidade.</>
              : cli.compra_unidade_sugerido_em ? <>Compra por unidade: <b>aguardando o gerente aprovar</b> (pedido em {data(cli.compra_unidade_sugerido_em)}).</>
              : <>Compra no site: <b>só caixa fechada</b>.</>}</span>
            {!ro && cli.categoria_preco !== "vip" && (gestao ? (
              cli.compra_unidade
                ? <form action={decidirCompraUnidade}><input type="hidden" name="cliente_id" value={cli.id} /><Aba k="loja" /><input type="hidden" name="liberar" value="0" /><button className="discreto">Voltar a só caixa</button></form>
                : <>
                    <form action={decidirCompraUnidade}><input type="hidden" name="cliente_id" value={cli.id} /><Aba k="loja" /><input type="hidden" name="liberar" value="1" /><button className="principal">{cli.compra_unidade_sugerido_em ? "Aprovar compra por unidade" : "Liberar compra por unidade"}</button></form>
                    {cli.compra_unidade_sugerido_em && <form action={decidirCompraUnidade}><input type="hidden" name="cliente_id" value={cli.id} /><Aba k="loja" /><input type="hidden" name="liberar" value="0" /><button className="discreto">Recusar</button></form>}
                  </>
            ) : !cli.compra_unidade && !cli.compra_unidade_sugerido_em && (
              <form action={pedirCompraUnidade}><input type="hidden" name="cliente_id" value={cli.id} /><Aba k="loja" /><button>Pedir compra por unidade ao gerente</button></form>
            ))}
          </div>
          {!ro && cli.pais === "PY" && (
            <div className="ficha-opcao">
              <span className="pequeno">{cli.cliente_local
                ? <>✓ <b>Cliente local</b>: pode retirar no CD Foz (Retire em Foz) e paga a tabela de locais nas marcas marcadas.</>
                : cli.cliente_local_sugerido_em ? <>Sugerido como <b>cliente local</b>: aguardando o gerente.</>
                : <>Retire em Foz: <b>não é cliente local</b>.</>}</span>
              {gestao ? (
                cli.cliente_local
                  ? <form action={decidirClienteLocal}><input type="hidden" name="cliente_id" value={cli.id} /><Aba k="loja" /><input type="hidden" name="local" value="0" /><button className="discreto">Deixar de ser local</button></form>
                  : <>
                      <form action={decidirClienteLocal}><input type="hidden" name="cliente_id" value={cli.id} /><Aba k="loja" /><input type="hidden" name="local" value="1" /><button>{cli.cliente_local_sugerido_em ? "Aprovar cliente local" : "Marcar como local"}</button></form>
                      {cli.cliente_local_sugerido_em && <form action={decidirClienteLocal}><input type="hidden" name="cliente_id" value={cli.id} /><Aba k="loja" /><input type="hidden" name="local" value="0" /><button className="discreto">Recusar</button></form>}
                    </>
              ) : !cli.cliente_local && !cli.cliente_local_sugerido_em && (
                <form action={sugerirClienteLocal}><input type="hidden" name="cliente_id" value={cli.id} /><Aba k="loja" /><button>Sugerir como cliente local</button></form>
              )}
            </div>
          )}
          {gestao && (
            <form action={depositoCliente} className="campos">
              <input type="hidden" name="cliente_id" value={cli.id} /><Aba k="loja" />
              <label>Depósito do cliente
                <select name="deposito_id" defaultValue={cli.deposito_id ?? ""}>
                  <option value="">O padrão da vendedora</option>
                  {d.depositos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                </select>
              </label>
              <button>Salvar</button>
            </form>
          )}
        </section>
      )}

      {aba === "credito" && (
        <section className="painel">
          <h2>Saldo anterior (dívida de antes do sistema)</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>O que o cliente já devia antes de comprar pelo sistema. Não conta como venda; aparece para o cliente na área dele e no contas a receber.
            Quando ele pagar, lance o pagamento aqui para abater.</p>
          <div className="indicadores">
            {d.saldoAnterior.length === 0 ? <div className="indicador"><span className="rotulo">Saldo anterior</span><span className="valor">nada</span></div>
              : d.saldoAnterior.map((x) => (
                <div key={x.moeda} className={`indicador ${Number(x.saldo) > 0 ? "destaque-aviso" : ""}`}><span className="rotulo">Saldo anterior ({x.moeda === "GS" ? "Gs" : "R$"})</span>
                  <span className="valor num">{dinheiro(x.saldo, x.moeda)}</span>{x.vencimento && <span className="pequeno suave">vence {data(x.vencimento)}</span>}</div>))}
          </div>
          {!ro && (
            <form action={lancarSaldoAnterior} className="campos">
              <input type="hidden" name="cliente_id" value={cli.id} /><Aba k="credito" />
              <label>O que é<select name="tipo" defaultValue="divida"><option value="divida">Dívida anterior (deve)</option><option value="pagamento">Pagamento (abate)</option></select></label>
              <label>Moeda<select name="moeda" defaultValue={moeda}><option value="GS">Gs</option><option value="BRL">R$</option></select></label>
              <label>Valor<input name="valor" inputMode="decimal" required /></label>
              <label>Data<input type="date" name="data" /></label>
              <label>Vence em<input type="date" name="vencimento" /></label>
              <label className="largo">Descrição<input name="descricao" maxLength={300} placeholder="Ex.: saldo do pedido de 15/09; pagou em efetivo" /></label>
              <button className="principal">Lançar</button>
            </form>
          )}
          {d.saLanc.length > 0 && (
            <div className="tabela"><table>
              <thead><tr><th>Data</th><th>Lançamento</th><th className="num">Valor</th><th>Quem</th><th></th></tr></thead>
              <tbody>{d.saLanc.map((x) => (
                <tr key={x.id} className={x.cancelado_em ? "suave" : ""}>
                  <td>{data(x.data)}</td>
                  <td>{x.tipo === "divida" ? "Dívida" : "Pagamento"}{x.descricao ? ` · ${x.descricao}` : ""}{x.vencimento && x.tipo === "divida" ? <div className="pequeno suave">vence {data(x.vencimento)}</div> : null}
                    {x.cancelado_em && <div className="pequeno">cancelado</div>}</td>
                  <td className="num" style={{ color: x.tipo === "pagamento" ? "var(--ok)" : undefined }}>{x.tipo === "pagamento" ? "− " : ""}{dinheiro(x.valor, x.moeda)}</td>
                  <td>{x.quem}</td>
                  <td>{!x.cancelado_em && !ro && <form action={cancelarSaldoAnterior}><input type="hidden" name="cliente_id" value={cli.id} /><input type="hidden" name="lancamento" value={x.id} /><Aba k="credito" />
                    <button className="discreto pequeno">Cancelar</button></form>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
      )}

      {aba === "credito" && (
        <section className="painel">
          <h2>Linha de crédito</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>
            A vendedora sugere; só o gerente ou o dono libera. Com crédito, o pedido fica a prazo ao confirmar o total (vencimento = hoje + prazo) e o cliente acompanha na área dele o que deve, o que pagou e os vencimentos. Pagamento só vale depois de aprovado pela gerência.
          </p>
          <div className="indicadores">
            <div className="indicador"><span className="rotulo">Em aberto</span><span className="valor num">{dinheiro(d.credito.aberto, moeda)}</span></div>
            <div className={`indicador ${vencido > 0 ? "destaque-erro" : ""}`}><span className="rotulo">Vencido</span><span className="valor num">{dinheiro(vencido, moeda)}</span></div>
            <div className="indicador"><span className="rotulo">Pagamentos a aprovar</span><span className="valor num">{dinheiro(d.credito.conferir, moeda)}</span></div>
            {cli.credito_habilitado && cli.limite_credito != null && <div className="indicador"><span className="rotulo">Disponível</span><span className="valor num">{dinheiro(Math.max(0, Number(cli.limite_credito) - Number(d.credito.aberto)), moeda)}</span></div>}
          </div>
          {cli.credito_habilitado
            ? <p style={{ margin: 0 }}><Selo cor="ok">crédito liberado</Selo> Limite <b className="num">{dinheiro(cli.limite_credito, moeda)}</b> · prazo {cli.prazo_credito_dias} dias</p>
            : <p style={{ margin: 0 }}><Selo>sem crédito</Selo> <span className="pequeno suave">O cliente não vê nada de crédito na área dele.</span></p>}
          {cli.credito_sugestao_limite != null && (
            <div className="aviso-caixa aviso">
              <b>Sugestão da vendedora</b>{d.sugeriu ? ` (${d.sugeriu}, ${dataHora(cli.credito_sugerido_em)})` : ""}: limite <b className="num">{dinheiro(cli.credito_sugestao_limite, moeda)}</b> · prazo {cli.credito_sugestao_prazo} dias
              {cli.credito_sugestao_obs && <div className="pequeno">“{cli.credito_sugestao_obs}”</div>}
              {gestao ? (
                <div className="linha" style={{ marginTop: 8 }}>
                  <form action={definirCredito}>
                    <input type="hidden" name="cliente_id" value={cli.id} /><Aba k="credito" /><input type="hidden" name="credito" value="on" />
                    <input type="hidden" name="limite" value={String(Number(cli.credito_sugestao_limite))} /><input type="hidden" name="prazo" value={cli.credito_sugestao_prazo} />
                    <button className="principal">Aprovar sugestão</button>
                  </form>
                  <form action={recusarSugestaoCredito}><input type="hidden" name="cliente_id" value={cli.id} /><Aba k="credito" /><button>Recusar</button></form>
                </div>
              ) : <div className="pequeno suave">Aguardando o gerente aprovar.</div>}
            </div>
          )}
          {gestao ? (
            <form action={definirCredito} className="campos">
              <input type="hidden" name="cliente_id" value={cli.id} /><Aba k="credito" />
              <label className="largo" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input type="checkbox" name="credito" defaultChecked={cli.credito_habilitado} style={{ width: "auto" }} /> Crédito liberado
              </label>
              <label>Limite ({moeda === "GS" ? "Gs" : "R$"})<input name="limite" inputMode="decimal" defaultValue={cli.limite_credito != null ? String(Number(cli.limite_credito)) : ""} /></label>
              <label>Prazo (dias)<input name="prazo" inputMode="numeric" defaultValue={cli.prazo_credito_dias ?? 30} /></label>
              <button>Salvar crédito (gerência)</button>
            </form>
          ) : !ro && (
            <details>
              <summary>{cli.credito_habilitado ? "Sugerir mudança no crédito" : "Sugerir crédito para este cliente"}</summary>
              <form action={sugerirCredito} className="campos" style={{ marginTop: 8 }}>
                <input type="hidden" name="cliente_id" value={cli.id} /><Aba k="credito" />
                <label>Limite sugerido ({moeda === "GS" ? "Gs" : "R$"})<input name="limite" inputMode="decimal" required /></label>
                <label>Prazo (dias)<input name="prazo" inputMode="numeric" defaultValue={30} required /></label>
                <label className="largo">Por quê? (opcional)<input name="obs" maxLength={500} placeholder="Ex.: cliente desde 2024, sempre pagou em dia" /></label>
                <button className="principal">Enviar sugestão ao gerente</button>
              </form>
            </details>
          )}
        </section>
      )}

      {aba === "cadastro" && (
        <div className="duas-colunas">
          <section className="painel">
            <h2>Cadastro</h2>
            <form action={salvarCliente} className="campos">
              <input type="hidden" name="cliente_id" value={cli.id} /><Aba k="cadastro" />
              <fieldset disabled={ro} style={{ display: "contents" }}>
                <label className="largo">Nome ou empresa<input name="nome" required defaultValue={cli.nome} /></label>
                <label>WhatsApp<input name="whatsapp" defaultValue={cli.whatsapp ?? ""} /></label>
                <label>Telefone<input name="telefone" defaultValue={cli.telefone ?? ""} /></label>
                <label>E-mail (para o cliente redefinir a senha da loja)<input name="email" type="email" defaultValue={cli.email ?? ""} /></label>
                <label>Cidade<input name="cidade" defaultValue={cli.cidade ?? ""} /></label>
                <label>Departamento / Estado<input name="departamento" defaultValue={cli.departamento ?? ""} /></label>
                <label>País
                  <select name="pais" defaultValue={cli.pais}><option value="PY">Paraguai (Gs)</option><option value="BR">Brasil (R$)</option></select>
                </label>
                <label>Preço
                  <select name="categoria_preco" defaultValue={cli.categoria_preco}><option value="normal">Normal</option><option value="vip">VIP</option></select>
                </label>
                <label>Perfil
                  <select name="perfil_comercial" defaultValue={cli.perfil_comercial ?? ""}>
                    <option value="">—</option>
                    {["Salão", "Profissional da beleza", "Loja", "Revendedor(a)", "Consumidor final", "Outro"].map((x) => <option key={x}>{x}</option>)}
                  </select>
                </label>
                <label className="largo">Preferências<textarea name="preferencias" defaultValue={cli.preferencias ?? ""} /></label>
                <label className="largo">Observações<textarea name="observacoes" defaultValue={cli.observacoes ?? ""} /></label>
                <button className="principal">Salvar cadastro</button>
              </fieldset>
            </form>
          </section>
          {gestao && (
            <section className="painel">
              <h2>Gestão</h2>
              <form action={trocarVendedoraCliente} className="campos">
                <input type="hidden" name="cliente_id" value={cli.id} /><Aba k="cadastro" />
                <label className="largo">Trocar vendedora
                  <select name="vendedora_id" defaultValue={cli.vendedora_id} required>
                    {d.vendedoras.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
                  </select>
                </label>
                <label className="largo" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" name="pedidos_abertos" value="1" defaultChecked style={{ width: "auto" }} /> levar os pedidos em andamento
                </label>
                <button className="principal">Trocar</button>
              </form>
              <hr className="ficha-sep" />
              <form action={ativarCliente} className="campos">
                <input type="hidden" name="cliente_id" value={cli.id} /><Aba k="cadastro" />
                <input type="hidden" name="ativo" value={cli.ativo ? "0" : "1"} />
                <p className="pequeno suave largo" style={{ margin: 0 }}>{cli.ativo ? "Desativado, o cliente sai das listas do dia a dia, mas continua no sistema e sendo atualizado." : "O cliente está desativado. Ative para voltar às listas."}</p>
                {cli.ativo && <label className="largo">Motivo (opcional)<input name="motivo" maxLength={300} /></label>}
                <button className={cli.ativo ? "discreto" : "principal"}>{cli.ativo ? "Desativar cliente" : "Ativar cliente"}</button>
              </form>
            </section>
          )}
        </div>
      )}
    </>
  );
}
