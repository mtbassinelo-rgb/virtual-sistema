import Link from "next/link";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, data, dataHora, MODALIDADES, type Moeda } from "@/lib/formato";
import { contarAprovacoes, FILAS, totalAprovacoes } from "@/lib/aprovacoes";
import { Avisos, Selo } from "../avisos";
import { conferirPagamento, recusarPagamento, decidirDescontoQuantidade, decidirRemocao } from "../pedidos/acoes";
import { decidirCompraUnidade, decidirClienteLocal, definirCredito, recusarSugestaoCredito } from "../clientes/acoes";
import { decidirMeta } from "../metas/acoes";
import { aprovarTransferencia } from "../estoque/transferencias/acoes";
import { confirmarRecebimento } from "../caixa/acoes";

export const metadata = { title: "Aprovações" };

const V = <input type="hidden" name="volta" value="/aprovacoes" />;
const moedaTxt = (m: string) => (m === "GS" ? "Gs" : "R$");

/**
 * Caixa de entrada da gerência: tudo que espera uma decisão, numa tela só, com os botões de decidir ali mesmo.
 * Cada decisão usa a mesma ação (e as mesmas regras do banco) da tela de origem e volta para cá.
 */
export default async function Aprovacoes({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const f = await searchParams;
  const u = await exigirUsuario();
  const decide = ehGestao(u);

  const d = await comUsuario(u.id, async (c) => {
    const n = await contarAprovacoes(c);
    const q = async <T,>(sql: string, ativo: boolean): Promise<T[]> => (ativo ? ((await c.query(sql).catch(() => ({ rows: [] }))).rows as T[]) : []);
    return {
      n,
      pagamentos: await q<{ id: string; valor: string; data: string; modalidade: string; banco: string | null; observacao: string | null; pedido_id: string; moeda: Moeda;
        bling_numero: string | null; cliente_nome: string | null; vendedora_nome: string; valor_total: string; saldo: string; comprovante: string | null; registrado_em: string }>(`
        select g.id, g.valor, g.data, g.modalidade, g.banco, g.observacao, g.registrado_em, p.id pedido_id, p.moeda, p.bling_numero, p.cliente_nome, p.vendedora_nome,
               p.valor_total, p.saldo, (select k.id from app.comprovantes k where k.pagamento_id = g.id order by k.enviado_em desc limit 1) comprovante
          from app.pagamentos g join app.v_pedidos p on p.id = g.pedido_id
         where g.status_conferencia = 'pendente' and p.status_comercial <> 'cancelado'
         order by g.registrado_em limit 100`, n.pagamentos > 0),
      caixa: await q<{ id: number; em: string; valor: string; moeda: Moeda; modalidade: string; referencia: string | null; conta: string | null; unidade: string; quem: string | null; cliente: string; pedido_id: string | null }>(`
        select m.id, m.em, m.valor, m.moeda, m.modalidade, m.referencia, cb.nome conta, d.nome unidade, app.nome_usuario(m.usuario_id) quem,
               coalesce(cl.nome, 'Cliente avulso') cliente, m.pedido_id
          from app.caixa_movimentos m join app.caixas cx on cx.id = m.caixa_id join app.depositos d on d.id = cx.deposito_id
          left join app.contas_bancarias cb on cb.id = m.conta_bancaria_id left join app.pedidos p on p.id = m.pedido_id left join app.clientes cl on cl.id = p.cliente_id
         where m.confirmacao = 'pendente' order by m.em limit 100`, n.caixa > 0),
      descontos: await q<{ id: string; cliente_nome: string | null; vendedora_nome: string; valor_total: string; moeda: Moeda; pct: string; data_pedido: string }>(`
        select id, cliente_nome, vendedora_nome, valor_total, moeda, desconto_qtd_pct pct, data_pedido from app.v_pedidos
         where desconto_qtd_status = 'pendente' and status_comercial <> 'cancelado' order by criado_em limit 100`, n.descontos > 0),
      remocoes: await q<{ id: string; pedido_id: string; descricao: string; quantidade: string; motivo: string; pedido_em: string; quem: string | null; cliente: string | null }>(`
        select r.id, r.pedido_id, r.descricao, r.quantidade, r.motivo, r.pedido_em, app.nome_usuario(r.pedido_por) quem, v.cliente_nome cliente
          from app.pedido_remocoes r join app.v_pedidos v on v.id = r.pedido_id
         where r.status = 'pendente' order by r.pedido_em limit 100`, n.remocoes > 0),
      site: await q<{ id: string; cliente_nome: string | null; vendedora_nome: string; valor_total: string; moeda: Moeda; criado_em: string }>(`
        select id, cliente_nome, vendedora_nome, valor_total, moeda, criado_em from app.v_pedidos
         where status_comercial = 'aguardando_aprovacao' order by criado_em limit 100`, n.site > 0),
      transferencias: await q<{ id: string; numero: number; origem: string; destino: string; separada_em: string | null; itens: number }>(`
        select t.id, t.numero, o.nome origem, de.nome destino, t.separada_em,
               (select count(*) from app.transferencia_itens i where i.transferencia_id = t.id)::int itens
          from app.transferencias t join app.depositos o on o.id = t.origem_id join app.depositos de on de.id = t.destino_id
         where t.status = 'separada' order by t.separada_em nulls last limit 100`, n.transferencias > 0),
      unidade: await q<{ id: string; nome: string; vendedora: string; cidade: string | null; em: string }>(`
        select c.id, c.nome, v.nome vendedora, c.cidade, c.compra_unidade_sugerido_em em
          from app.clientes c join app.vendedoras v on v.id = c.vendedora_id
         where c.mesclado_em is null and c.compra_unidade_sugerido_em is not null and not c.compra_unidade and c.categoria_preco = 'normal'
         order by c.compra_unidade_sugerido_em limit 100`, n.unidade > 0),
      local: await q<{ id: string; nome: string; vendedora: string; cidade: string | null; quem: string | null; em: string }>(`
        select c.id, c.nome, v.nome vendedora, c.cidade, app.nome_usuario(c.cliente_local_sugerido_por) quem, c.cliente_local_sugerido_em em
          from app.clientes c join app.vendedoras v on v.id = c.vendedora_id
         where c.mesclado_em is null and c.cliente_local_sugerido_em is not null and not c.cliente_local
         order by c.cliente_local_sugerido_em limit 100`, n.local > 0),
      credito: await q<{ id: string; nome: string; moeda: Moeda; limite: string; prazo: number; obs: string | null; quem: string | null; limite_atual: string | null }>(`
        select c.id, c.nome, c.moeda, c.credito_sugestao_limite limite, c.credito_sugestao_prazo prazo, c.credito_sugestao_obs obs,
               app.nome_usuario(c.credito_sugerido_por) quem, case when c.credito_habilitado then c.limite_credito end limite_atual
          from app.clientes c where c.mesclado_em is null and c.credito_sugestao_limite is not null order by c.credito_sugerido_em limit 100`, n.credito > 0),
      metas: await q<{ id: string; cliente_nome: string; vendedora_nome: string; moeda: Moeda; valor_meta: string; valor_premio: string; tipo_premio: string; descricao_premio: string | null; inicio: string; fim: string }>(`
        select id, cliente_nome, vendedora_nome, moeda, valor_meta, valor_premio, tipo_premio, descricao_premio, inicio, fim
          from app.v_metas where status = 'proposta' order by proposta_em limit 100`, n.metas > 0),
    };
  });

  const total = totalAprovacoes(d.n);
  const filas = FILAS.filter((x) => d.n[x.id] > 0);

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Aprovações</h1>
          <p>Tudo que espera a sua decisão, numa tela só. Decida aqui mesmo: a tela volta para cá e o item sai da lista.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      {total === 0 ? (
        <div className="aviso-caixa ok">Nada esperando aprovação agora. 👏</div>
      ) : (
        <nav className="chips-filas" aria-label="Filas com pendência">
          {filas.map((x) => (
            <a key={x.id} href={`#${x.id}`} className="chip">{x.titulo} <b className="contador">{d.n[x.id]}</b></a>
          ))}
        </nav>
      )}

      {d.pagamentos.length > 0 && (
        <section className="painel" id="pagamentos">
          <h2>Pagamentos a conferir ({d.n.pagamentos})</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>Confira no extrato. O nº do Bling é opcional: se o pedido já tem, vem preenchido.</p>
          <div className="cartoes-aprovar">
            {d.pagamentos.map((g) => (
              <div key={g.id} className="cartao-aprovar">
                <div className="linha entre">
                  <Link href={`/pedidos/${g.pedido_id}#pagamentos`}><b>{g.cliente_nome ?? "Cliente avulso"}</b></Link>
                  <b className="num">{dinheiro(g.valor, g.moeda)}</b>
                </div>
                <div className="pequeno suave">
                  {MODALIDADES[g.modalidade] ?? g.modalidade}{g.banco ? ` · ${g.banco}` : ""} · pago em {data(g.data)} · {g.vendedora_nome}
                  <br />Pedido de {dinheiro(g.valor_total, g.moeda)} · saldo {dinheiro(g.saldo, g.moeda)}
                  {g.observacao && <><br />“{g.observacao}”</>}
                </div>
                {g.comprovante ? <a className="pequeno" href={`/comprovantes/${g.comprovante}`} target="_blank" rel="noopener noreferrer">📎 Ver comprovante</a>
                  : <span className="pequeno suave">Sem comprovante anexado</span>}
                {decide && (
                  <div className="acoes-aprovar">
                    <form action={conferirPagamento} className="linha" style={{ gap: 6 }}>
                      <input type="hidden" name="pagamento_id" value={g.id} /><input type="hidden" name="pedido_id" value={g.pedido_id} />{V}
                      <input name="bling_numero" defaultValue={g.bling_numero ?? ""} placeholder="Nº Bling" inputMode="numeric" aria-label="Nº do pedido no Bling" style={{ width: 96 }} />
                      <button className="principal">✓ Caiu</button>
                    </form>
                    <form action={recusarPagamento} className="linha" style={{ gap: 6 }}>
                      <input type="hidden" name="pagamento_id" value={g.id} /><input type="hidden" name="pedido_id" value={g.pedido_id} />{V}
                      <input name="motivo" placeholder="Motivo" required aria-label="Motivo da recusa" style={{ width: 120 }} />
                      <button className="perigo">Não caiu</button>
                    </form>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {d.caixa.length > 0 && (
        <section className="painel" id="caixa">
          <h2>Transferências recebidas no caixa ({d.n.caixa})</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>Recebimentos por transferência lançados no caixa das unidades. Confira no extrato da conta de destino.</p>
          <div className="cartoes-aprovar">
            {d.caixa.map((x) => (
              <div key={x.id} className="cartao-aprovar">
                <div className="linha entre">
                  <span>{x.pedido_id ? <Link href={`/pedidos/${x.pedido_id}`}><b>{x.cliente}</b></Link> : <b>{x.cliente}</b>}</span>
                  <b className="num">{dinheiro(x.valor, x.moeda)}</b>
                </div>
                <div className="pequeno suave">{x.unidade} · {dataHora(x.em)} · {x.quem ?? "—"}<br />
                  Conta: {x.conta ?? <span className="texto-erro">sem conta</span>}{x.referencia ? ` · ${x.referencia}` : ""}</div>
                {decide && (
                  <div className="acoes-aprovar">
                    <form action={confirmarRecebimento}><input type="hidden" name="mov" value={x.id} /><input type="hidden" name="ok" value="1" /><button className="principal">✓ Caiu</button></form>
                    <form action={confirmarRecebimento} className="linha" style={{ gap: 6 }}><input type="hidden" name="mov" value={x.id} /><input type="hidden" name="ok" value="0" />
                      <input name="motivo" placeholder="Motivo" required aria-label="Motivo da recusa" style={{ width: 120 }} /><button className="perigo">Não caiu</button></form>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {d.descontos.length > 0 && (
        <section className="painel" id="descontos">
          <h2>Desconto por quantidade ({d.n.descontos})</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>Pedidos do site que atingiram o desconto por quantidade.</p>
          <div className="cartoes-aprovar">
            {d.descontos.map((p) => (
              <div key={p.id} className="cartao-aprovar">
                <div className="linha entre"><Link href={`/pedidos/${p.id}`}><b>{p.cliente_nome ?? "Cliente"}</b></Link><Selo cor="aviso">{Number(p.pct)}%</Selo></div>
                <div className="pequeno suave">{dinheiro(p.valor_total, p.moeda)} · {data(p.data_pedido)} · {p.vendedora_nome}</div>
                {decide && (
                  <div className="acoes-aprovar">
                    <form action={decidirDescontoQuantidade}><input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="liberar" value="1" />{V}<button className="principal">Liberar {Number(p.pct)}%</button></form>
                    <form action={decidirDescontoQuantidade}><input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="liberar" value="0" />{V}<button>Não liberar</button></form>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {d.remocoes.length > 0 && (
        <section className="painel" id="remocoes">
          <h2>Tirar produto do pedido ({d.n.remocoes})</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>Produto sem estoque que o cliente não quis trocar. Ao autorizar, sai do pedido e vai para os procurados sem estoque.</p>
          <div className="cartoes-aprovar">
            {d.remocoes.map((r) => (
              <div key={r.id} className="cartao-aprovar">
                <div><b>{Number(r.quantidade)}× {r.descricao}</b></div>
                <div className="pequeno suave"><Link href={`/pedidos/${r.pedido_id}`}>{r.cliente ?? "Pedido"}</Link> · pedido por {r.quem ?? "—"} em {dataHora(r.pedido_em)}<br />Motivo: {r.motivo}</div>
                {decide && (
                  <form action={decidirRemocao} className="acoes-aprovar">
                    <input type="hidden" name="pedido_id" value={r.pedido_id} /><input type="hidden" name="remocao_id" value={r.id} />{V}
                    <input name="motivo_decisao" placeholder="Observação (opcional)" aria-label="Observação" style={{ flex: 1, minWidth: 140 }} />
                    <button className="principal" name="decisao" value="aprovar">Autorizar</button>
                    <button name="decisao" value="recusar">Recusar</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {d.site.length > 0 && (
        <section className="painel" id="site">
          <h2>Pedidos do site para conferir ({d.n.site})</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>O cliente fez o pedido na loja. A vendedora (ou você) confere os itens e manda para a separação.</p>
          <ul className="crm-lista">{d.site.map((p) => (
            <li key={p.id}>
              <Link href={`/pedidos/${p.id}`} className="crm-quem">{p.cliente_nome ?? "Cliente"}<small>{dinheiro(p.valor_total, p.moeda)} · {dataHora(p.criado_em)} · {p.vendedora_nome}</small></Link>
              <Link className="botao mini" href={`/pedidos/${p.id}`}>Conferir →</Link>
            </li>))}</ul>
        </section>
      )}

      {d.transferencias.length > 0 && (
        <section className="painel" id="transferencias">
          <h2>Envios entre unidades para aprovar ({d.n.transferencias})</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>Já separados. Ao aprovar, a mercadoria sai do estoque de origem e fica a caminho.</p>
          <div className="cartoes-aprovar">
            {d.transferencias.map((t) => (
              <div key={t.id} className="cartao-aprovar">
                <div className="linha entre"><Link href={`/estoque/transferencias/${t.id}`}><b>#{t.numero}</b> · {t.origem} → {t.destino}</Link><span className="pequeno suave">{t.itens} produto(s)</span></div>
                {t.separada_em && <div className="pequeno suave">Separada em {dataHora(t.separada_em)}</div>}
                {decide && (
                  <div className="acoes-aprovar">
                    <form action={aprovarTransferencia}><input type="hidden" name="id" value={t.id} />{V}<button className="principal">Aprovar envio</button></form>
                    <Link className="botao" href={`/estoque/transferencias/${t.id}`}>Ver itens</Link>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {d.unidade.length > 0 && (
        <section className="painel" id="unidade">
          <h2>Compra por unidade ({d.n.unidade})</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>A vendedora pediu para o cliente (preço Normal) comprar por unidade, sem caixa fechada.</p>
          <div className="cartoes-aprovar">
            {d.unidade.map((x) => (
              <div key={x.id} className="cartao-aprovar">
                <div><Link href={`/clientes/${x.id}`}><b>{x.nome}</b></Link></div>
                <div className="pequeno suave">{x.cidade ? `${x.cidade} · ` : ""}{x.vendedora} · {dataHora(x.em)}</div>
                {decide && (
                  <div className="acoes-aprovar">
                    <form action={decidirCompraUnidade}><input type="hidden" name="cliente_id" value={x.id} /><input type="hidden" name="liberar" value="1" />{V}<button className="principal">Liberar unidade</button></form>
                    <form action={decidirCompraUnidade}><input type="hidden" name="cliente_id" value={x.id} /><input type="hidden" name="liberar" value="0" />{V}<button>Só caixa fechada</button></form>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {d.local.length > 0 && (
        <section className="painel" id="local">
          <h2>Cliente local: Retire em Foz ({d.n.local})</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>Cliente da região sugerido pela vendedora: pode retirar em Foz com o desconto por caixa.</p>
          <div className="cartoes-aprovar">
            {d.local.map((x) => (
              <div key={x.id} className="cartao-aprovar">
                <div><Link href={`/clientes/${x.id}`}><b>{x.nome}</b></Link></div>
                <div className="pequeno suave">{x.cidade ? `${x.cidade} · ` : ""}{x.vendedora}{x.quem ? ` · sugerido por ${x.quem}` : ""} · {dataHora(x.em)}</div>
                {decide && (
                  <div className="acoes-aprovar">
                    <form action={decidirClienteLocal}><input type="hidden" name="cliente_id" value={x.id} /><input type="hidden" name="local" value="1" />{V}<button className="principal">É local</button></form>
                    <form action={decidirClienteLocal}><input type="hidden" name="cliente_id" value={x.id} /><input type="hidden" name="local" value="0" />{V}<button>Não é local</button></form>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {d.credito.length > 0 && (
        <section className="painel" id="credito">
          <h2>Crédito sugerido pelas vendedoras ({d.n.credito})</h2>
          <div className="cartoes-aprovar">
            {d.credito.map((x) => (
              <div key={x.id} className="cartao-aprovar">
                <div className="linha entre"><Link href={`/clientes/${x.id}?aba=credito`}><b>{x.nome}</b></Link><b className="num">{dinheiro(x.limite, x.moeda)}</b></div>
                <div className="pequeno suave">Prazo {x.prazo} dias{x.quem ? ` · ${x.quem}` : ""}{x.limite_atual ? ` · limite atual ${dinheiro(x.limite_atual, x.moeda)}` : " · hoje sem crédito"}
                  {x.obs && <><br />“{x.obs}”</>}</div>
                {decide && (
                  <div className="acoes-aprovar">
                    <form action={definirCredito}>
                      <input type="hidden" name="cliente_id" value={x.id} /><input type="hidden" name="credito" value="on" />{V}
                      <input type="hidden" name="limite" value={String(Number(x.limite))} /><input type="hidden" name="prazo" value={x.prazo} />
                      <button className="principal">Aprovar</button>
                    </form>
                    <form action={recusarSugestaoCredito}><input type="hidden" name="cliente_id" value={x.id} />{V}<button>Recusar</button></form>
                    <Link className="botao" href={`/clientes/${x.id}?aba=credito`}>Outro valor</Link>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {d.metas.length > 0 && (
        <section className="painel" id="metas">
          <h2>Metas propostas ({d.n.metas})</h2>
          <div className="cartoes-aprovar">
            {d.metas.map((m) => (
              <div key={m.id} className="cartao-aprovar">
                <div><b>{m.cliente_nome}</b> <span className="pequeno suave">· {m.vendedora_nome}</span></div>
                <div className="pequeno">Comprar <b className="num">{dinheiro(m.valor_meta, m.moeda)}</b> de {data(m.inicio)} a {data(m.fim)} →
                  prêmio <b className="num">{dinheiro(m.valor_premio, m.moeda)}</b>{m.descricao_premio ? ` (${m.descricao_premio})` : ""}</div>
                {decide && (
                  <form action={decidirMeta} className="acoes-aprovar">
                    <input type="hidden" name="meta_id" value={m.id} />{V}
                    <input name="motivo" placeholder="Motivo (se recusar)" aria-label="Motivo" style={{ flex: 1, minWidth: 140 }} />
                    <button className="principal" name="decisao" value="aprovar">Aprovar</button>
                    <button className="perigo" name="decisao" value="recusar">Recusar</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {(d.n.cadastros > 0 || d.n.produtos > 0 || d.n.fotos > 0) && (
        <section className="painel">
          <h2>Também esperando você</h2>
          <ul className="crm-lista">
            {d.n.cadastros > 0 && <li id="cadastros"><span className="crm-quem">Cadastros do site<small>“Quero ser cliente”: escolha a vendedora e aprove</small></span><Link className="botao mini" href="/site#cadastros">{d.n.cadastros} → abrir</Link></li>}
            {d.n.produtos > 0 && <li id="produtos"><span className="crm-quem">Novos produtos<small>Fotografados pela equipe com quantidade e preço</small></span><Link className="botao mini" href="/produtos/pendentes">{d.n.produtos} → abrir</Link></li>}
            {d.n.fotos > 0 && <li id="fotos"><span className="crm-quem">Fotos do catálogo<small>Fotos esperando conferência</small></span><Link className="botao mini" href="/produtos/fotos">{d.n.fotos} → abrir</Link></li>}
          </ul>
        </section>
      )}

      <p className="pequeno suave">Pagamentos de {moedaTxt("GS")} e {moedaTxt("BRL")} aparecem juntos, cada um na sua moeda. As mesmas decisões continuam disponíveis dentro de cada pedido e cliente.</p>
    </>
  );
}
