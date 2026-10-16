import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario, podeEscrever, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import {
  dinheiro, data, dataHora, linkWhatsApp, STATUS_COMERCIAL, STATUS_PAGAMENTO, COR_PAGAMENTO, STATUS_META, TIPO_ATENDIMENTO,
  type Moeda,
} from "@/lib/formato";
import { Avisos, Barra, Selo } from "../../avisos";
import { atendimentoCliente, bloquearCliente, convidarCliente, depositoCliente, salvarCliente } from "../acoes";

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
  const msgConvite = avisos.convite
    ? `Olá ${cli.nome}! Aqui é a ${cli.vendedora}, da Virtual Cosméticos. Agora você pode ver o catálogo com os seus preços e fazer pedidos por este link (é pessoal, não compartilhe): ${avisos.convite}`
    : null;
  const whatsConvite = msgConvite ? linkWhatsApp(cli.whatsapp ?? cli.telefone, msgConvite) : null;

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
      {avisos.convite && (
        <div className="aviso-caixa ok">
          <div><b>Link de acesso criado.</b> Vale por 7 dias e só pode ser usado uma vez. Envie para o cliente:</div>
          <div className="linha" style={{ marginTop: 8 }}>
            {whatsConvite && <a className="botao whatsapp" href={whatsConvite} target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>}
            <input readOnly value={avisos.convite} aria-label="Link de acesso" style={{ flex: 1, minWidth: 220 }} />
          </div>
        </div>
      )}

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
            {cli.portal_ativo ? "O cliente pode entrar pelo link enviado pela vendedora." : "Acesso bloqueado."} Estoque que ele vê: {d.depositoAtual ?? "—"}
            {d.depositoAtual === "Loja Ciudad del Este" ? " (pode pedir do CD de Foz, 1 a 3 dias)" : ""}.
          </p>
          {!ro && (
            <div className="linha">
              <form action={convidarCliente}><input type="hidden" name="cliente_id" value={cli.id} /><button className="principal">Gerar link de acesso</button></form>
              {cli.portal_ativo && <form action={bloquearCliente}><input type="hidden" name="cliente_id" value={cli.id} /><button className="perigo">Bloquear acesso</button></form>}
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
          <h2>Cadastro</h2>
          <form action={salvarCliente} className="campos">
            <input type="hidden" name="cliente_id" value={cli.id} />
            <fieldset disabled={ro} style={{ display: "contents" }}>
              <label className="largo">Nome ou empresa<input name="nome" required defaultValue={cli.nome} /></label>
              <label>WhatsApp<input name="whatsapp" defaultValue={cli.whatsapp ?? ""} /></label>
              <label>Telefone<input name="telefone" defaultValue={cli.telefone ?? ""} /></label>
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
