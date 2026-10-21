import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario, podeEscrever, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import {
  dinheiro, data, dataHora, linkWhatsApp, STATUS_COMERCIAL, STATUS_PAGAMENTO, COR_PAGAMENTO, STATUS_META, TIPO_ATENDIMENTO,
  type Moeda,
} from "@/lib/formato";
import { Avisos, Barra, Selo } from "../../avisos";
import { atendimentoCliente, pedirCompraUnidade, bloquearCliente, decidirCompraUnidade, decidirClienteLocal, definirCredito, depositoCliente, recusarSugestaoCredito, salvarCliente, sugerirClienteLocal, sugerirCredito } from "../acoes";
import { AcessoCliente } from "./acesso-cliente";

export const metadata = { title: "Cliente" };

export default async function Cliente({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string; convite?: string }>;
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
  return (
    <>
      <section className="linha entre">
        <div>
          <Link href="/clientes">← Clientes</Link>
          <h1 style={{ marginTop: 4 }}>{cli.nome}</h1>
          <div className="linha pequeno suave">
            <span>{cli.vendedora}</span>
            <Selo cor={cli.categoria_preco === "vip" ? "marca" : ""}>{cli.pais === "PY" ? "Paraguai · Gs" : "Brasil · R$"} · {cli.categoria_preco === "vip" ? "VIP" : "Normal"}</Selo>
            {cli.perfil_comercial && <span>{cli.perfil_comercial}</span>}
          </div>
        </div>
        <div className="linha">
          {!ro && <Link className="botao" href={`/pedidos/novo?cliente=${cli.id}`}>Novo pedido</Link>}
          {!ro && <Link className="botao" href={`/metas?cliente=${cli.id}#propor`}>Propor meta</Link>}
          {whats && <a className="botao whatsapp" href={whats} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
        </div>
      </section>
      <Avisos ok={avisos.ok} erro={avisos.erro} />
      <div className="indicadores">
        <div className="indicador"><span className="rotulo">Total comprado</span><span className="valor num">{dinheiro(total, moeda)}</span></div>
        <div className="indicador"><span className="rotulo">Pedidos</span><span className="valor">{ativos.length}</span></div>
        <div className="indicador"><span className="rotulo">Ticket médio</span><span className="valor num">{ativos.length ? dinheiro(total / ativos.length, moeda) : "—"}</span></div>
        <div className="indicador"><span className="rotulo">Saldo em aberto</span><span className="valor num">{dinheiro(saldo, moeda)}</span></div>
        <div className="indicador"><span className="rotulo">Última compra</span><span className="valor">{data(ativos[0]?.data_pedido)}</span></div>
      </div>

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
            <h2>Histórico de compras</h2>
            {d.pedidos.length === 0 ? <p className="suave">Nenhum pedido ainda.</p> : (
              <div className="tabela"><table>
                <thead><tr><th>Data</th><th>Nº Bling</th><th>Total</th><th>Saldo</th><th>Pagamento</th><th>Status</th></tr></thead>
                <tbody>{d.pedidos.map((p) => (
                  <tr key={p.id}>
                    <td className="num"><Link href={`/pedidos/${p.id}`}>{data(p.data_pedido)}</Link></td>
                    <td className="num">{p.bling_numero ?? "—"}</td>
                    <td className="num">{dinheiro(p.valor_total, moeda)}</td>
                    <td className="num">{dinheiro(p.saldo, moeda)}</td>
                    <td><Selo cor={COR_PAGAMENTO[p.status_pagamento]}>{STATUS_PAGAMENTO[p.status_pagamento]}</Selo></td>
                    <td>{STATUS_COMERCIAL[p.status_comercial]}</td>
                  </tr>))}
                </tbody></table></div>
            )}
          </section>
          <section className="painel">
            <h2>Metas</h2>
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
          <section className="painel">
            <h2>Atendimentos</h2>
            {!ro && (
              <form action={atendimentoCliente} className="campos">
                <input type="hidden" name="cliente_id" value={cli.id} />
                <label>Tipo
                  <select name="tipo" defaultValue="whatsapp">
                    {Object.entries(TIPO_ATENDIMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label>Resultado<input name="resultado" /></label>
                <label className="largo">O que foi conversado<textarea name="nota" /></label>
                <button>Registrar</button>
              </form>
            )}
            {d.atendimentos.length === 0 ? <p className="suave">Nenhum atendimento registrado.</p> : (
              <ul className="lista-simples">
                {d.atendimentos.map((a) => (
                  <li key={a.id}>
                    <b>{TIPO_ATENDIMENTO[a.tipo]}</b> · {dataHora(a.em)} · {a.usuario_nome}
                    {a.resultado && <div>{a.resultado}</div>}
                    {a.nota && <div className="suave">{a.nota}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="coluna">
        <section className="painel">
          <h2>Área do cliente (atacado)</h2>
          <p className="pequeno suave">
            {!cli.portal_ativo ? "Acesso bloqueado." : d.temAcesso ? <>O cliente entra em <b>distribuidoravirtualcosmeticos.com/loja</b> com o documento e a senha.</> : "Ainda sem acesso: informe o documento e crie o acesso."} Estoque que ele vê: {d.depositoAtual ?? "—"}
            {d.depositoAtual === "Loja Ciudad del Este" ? " (site Virtual Cosméticos CDE: só o estoque da loja, por unidade ou caixa)" : ""}.
          </p>
          {!ro && <AcessoCliente clienteId={cli.id} documento={cli.documento ?? null} temAcesso={d.temAcesso} />}
          {!ro && (
            <div className="linha">
              {cli.portal_ativo && d.temAcesso && <form action={bloquearCliente}><input type="hidden" name="cliente_id" value={cli.id} /><button className="perigo">Bloquear acesso</button></form>}
            </div>
          )}
          {/* Compra por unidade no site: vendedora pede, gerente aprova. Só preço Normal (BR e PY); VIP é sempre caixa fechada. */}
          <div className="linha" style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="pequeno">{cli.categoria_preco === "vip"
              ? <>Compra no site: <b>só caixa fechada</b> (cliente VIP).</>
              : cli.compra_unidade ? <>✓ <b>Compra por unidade liberada</b>: no site ele escolhe caixa fechada ou unidade.</>
              : cli.compra_unidade_sugerido_em ? <>Compra por unidade: <b>aguardando o gerente aprovar</b> (pedido em {data(cli.compra_unidade_sugerido_em)}).</>
              : <>Compra no site: <b>só caixa fechada</b>.</>}</span>
            {!ro && cli.categoria_preco !== "vip" && (gestao ? (
              cli.compra_unidade
                ? <form action={decidirCompraUnidade}><input type="hidden" name="cliente_id" value={cli.id} /><input type="hidden" name="liberar" value="0" /><button className="discreto">Voltar a só caixa</button></form>
                : <>
                    <form action={decidirCompraUnidade}><input type="hidden" name="cliente_id" value={cli.id} /><input type="hidden" name="liberar" value="1" /><button className="principal">{cli.compra_unidade_sugerido_em ? "Aprovar compra por unidade" : "Liberar compra por unidade"}</button></form>
                    {cli.compra_unidade_sugerido_em && <form action={decidirCompraUnidade}><input type="hidden" name="cliente_id" value={cli.id} /><input type="hidden" name="liberar" value="0" /><button className="discreto">Recusar</button></form>}
                  </>
            ) : !cli.compra_unidade && !cli.compra_unidade_sugerido_em && (
              <form action={pedirCompraUnidade}><input type="hidden" name="cliente_id" value={cli.id} /><button>Pedir compra por unidade ao gerente</button></form>
            ))}
          </div>
          {!ro && cli.pais === "PY" && (
            <div className="linha" style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="pequeno">{cli.cliente_local
                ? <>✓ <b>Cliente local</b>: pode retirar no CD Foz (Retire em Foz).</>
                : cli.cliente_local_sugerido_em ? <>Sugerido como <b>cliente local</b>: aguardando o gerente.</>
                : <>Retire em Foz: <b>não é cliente local</b>.</>}</span>
              {ehGestao(u) ? (
                cli.cliente_local
                  ? <form action={decidirClienteLocal}><input type="hidden" name="cliente_id" value={cli.id} /><input type="hidden" name="local" value="0" /><button className="discreto">Deixar de ser local</button></form>
                  : <>
                      <form action={decidirClienteLocal}><input type="hidden" name="cliente_id" value={cli.id} /><input type="hidden" name="local" value="1" /><button>{cli.cliente_local_sugerido_em ? "Aprovar cliente local" : "Marcar como local"}</button></form>
                      {cli.cliente_local_sugerido_em && <form action={decidirClienteLocal}><input type="hidden" name="cliente_id" value={cli.id} /><input type="hidden" name="local" value="0" /><button className="discreto">Recusar</button></form>}
                    </>
              ) : !cli.cliente_local && !cli.cliente_local_sugerido_em && (
                <form action={sugerirClienteLocal}><input type="hidden" name="cliente_id" value={cli.id} /><button>Sugerir como cliente local</button></form>
              )}
            </div>
          )}
          {ehGestao(u) && (
            <form action={depositoCliente} className="campos">
              <input type="hidden" name="cliente_id" value={cli.id} />
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
        <section className="painel">
          <h2>Linha de crédito</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>
            A vendedora sugere; só o gerente ou o dono libera. Com crédito, o pedido fica a prazo ao confirmar o total (vencimento = hoje + prazo) e o cliente acompanha na área dele o que deve, o que pagou e os vencimentos. Pagamento só vale depois de aprovado pela gerência.
          </p>
          <div className="linha pequeno">
            <span>Em aberto: <b className="num">{dinheiro(d.credito.aberto, moeda)}</b></span>
            {Number(d.credito.vencido) > 0 && <span style={{ color: "var(--erro)" }}>Vencido: <b className="num">{dinheiro(d.credito.vencido, moeda)}</b></span>}
            {Number(d.credito.conferir) > 0 && <span>Pagamentos a aprovar: <b className="num">{dinheiro(d.credito.conferir, moeda)}</b></span>}
            {cli.credito_habilitado && cli.limite_credito != null && <span>Disponível: <b className="num">{dinheiro(Math.max(0, Number(cli.limite_credito) - Number(d.credito.aberto)), moeda)}</b></span>}
          </div>
          {cli.credito_habilitado
            ? <p style={{ margin: 0 }}><Selo cor="ok">crédito liberado</Selo> Limite <b className="num">{dinheiro(cli.limite_credito, moeda)}</b> · prazo {cli.prazo_credito_dias} dias</p>
            : <p style={{ margin: 0 }}><Selo>sem crédito</Selo> <span className="pequeno suave">O cliente não vê nada de crédito na área dele.</span></p>}
          {cli.credito_sugestao_limite != null && (
            <div className="aviso-caixa">
              <b>Sugestão da vendedora</b>{d.sugeriu ? ` (${d.sugeriu}, ${dataHora(cli.credito_sugerido_em)})` : ""}: limite <b className="num">{dinheiro(cli.credito_sugestao_limite, moeda)}</b> · prazo {cli.credito_sugestao_prazo} dias
              {cli.credito_sugestao_obs && <div className="pequeno">“{cli.credito_sugestao_obs}”</div>}
              {gestao ? (
                <div className="linha" style={{ marginTop: 8 }}>
                  <form action={definirCredito}>
                    <input type="hidden" name="cliente_id" value={cli.id} /><input type="hidden" name="credito" value="on" />
                    <input type="hidden" name="limite" value={String(Number(cli.credito_sugestao_limite))} /><input type="hidden" name="prazo" value={cli.credito_sugestao_prazo} />
                    <button className="principal">Aprovar sugestão</button>
                  </form>
                  <form action={recusarSugestaoCredito}><input type="hidden" name="cliente_id" value={cli.id} /><button>Recusar</button></form>
                </div>
              ) : <div className="pequeno suave">Aguardando o gerente aprovar.</div>}
            </div>
          )}
          {gestao ? (
            <form action={definirCredito} className="campos">
              <input type="hidden" name="cliente_id" value={cli.id} />
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
                <input type="hidden" name="cliente_id" value={cli.id} />
                <label>Limite sugerido ({moeda === "GS" ? "Gs" : "R$"})<input name="limite" inputMode="decimal" required /></label>
                <label>Prazo (dias)<input name="prazo" inputMode="numeric" defaultValue={30} required /></label>
                <label className="largo">Por quê? (opcional)<input name="obs" maxLength={500} placeholder="Ex.: cliente desde 2024, sempre pagou em dia" /></label>
                <button className="principal">Enviar sugestão ao gerente</button>
              </form>
            </details>
          )}
        </section>
        <section className="painel">
          <h2>Cadastro</h2>
          <form action={salvarCliente} className="campos">
            <input type="hidden" name="cliente_id" value={cli.id} />
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
        </div>
      </div>
    </>
  );
}
