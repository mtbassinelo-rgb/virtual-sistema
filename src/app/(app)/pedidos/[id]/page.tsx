import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { urlPortal } from "@/lib/portal";
import { exigirUsuario, ehGestao, podeEscrever } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import {
  dinheiro, data, dataHora, hojeISO, linkWhatsApp, STATUS_COMERCIAL, STATUS_PAGAMENTO, COR_PAGAMENTO,
  MODALIDADES, CONFERENCIA, TIPO_ATENDIMENTO, type Moeda,
} from "@/lib/formato";
import { Avisos, Selo } from "../../avisos";
import {
  anexarComprovante, atualizarPedido, avancarEntrega, conferirPagamento, conferirSeparacao, confirmarTotal, decidirPedidoPortal,
  reconhecerBling, recusarPagamento, registrarAtendimento, registrarPagamento, gerarLinkPedido, definirVolumes, decidirDescontoQuantidade,
  trocarItem, pedirRemocao, decidirRemocao,
} from "../acoes";

export const metadata = { title: "Pedido" };

export default async function Pedido({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string; link?: string }>;
}) {
  const u = await exigirUsuario();
  const { id } = await params;
  const avisos = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const d = await comUsuario(u.id, async (c) => {
    const p = (await c.query("select * from app.v_pedidos where id = $1", [id])).rows[0];
    if (!p) return null;
    const cliente = p.cliente_id
      ? (await c.query("select id, nome, whatsapp, telefone, categoria_preco, pais from app.clientes where id = $1", [p.cliente_id])).rows[0]
      : null;
    const itens = (await c.query(
      `select i.id, i.codigo, i.descricao, i.quantidade, i.quantidade_pedida, i.preco_unitario, i.desconto, i.total, d.nome as origem
         from app.pedido_itens i left join app.depositos d on d.id = i.deposito_origem_id
        where i.pedido_id = $1 order by i.codigo, d.nome`, [id])).rows;
    const fluxo = (await c.query(
      `select volumes, separacao_conferida_em, total_confirmado_em, conta_pagamento, app.pode_operar_deposito(deposito_id) as opera,
              chegou_em, local_retirada, (select nome from app.depositos where id = deposito_id) as deposito_nome
         from app.pedidos where id = $1`, [id])).rows[0];
    const indisponiveis = (await c.query(
      "select descricao, quantidade_pedida, quantidade_faltou from app.pedido_itens_indisponiveis where pedido_id = $1 order by descricao", [id])).rows;
    const transf = (await c.query(
      "select numero, status from app.transferencias where pedido_id = $1 order by numero", [id])).rows;
    const bling = p.bling_id
      ? (await c.query("select numero, situacao_nome, total, itens, sincronizado_em, mudou_em from app.bling_pedidos where bling_id = $1", [p.bling_id])).rows[0]
      : null;
    const pagamentos = (await c.query(
      `select g.*, ur.nome as registrado_nome, uc.nome as conferido_nome
         from app.pagamentos g
         left join app.usuarios ur on ur.id = g.registrado_por
         left join app.usuarios uc on uc.id = g.conferido_por
        where g.pedido_id = $1 order by g.registrado_em`, [id])).rows;
    const comprovantes = (await c.query(
      `select c.id, c.pagamento_id, c.nome_original, c.enviado_em from app.comprovantes c
         join app.pagamentos g on g.id = c.pagamento_id where g.pedido_id = $1 order by c.enviado_em`, [id])).rows;
    const atendimentos = (await c.query(
      `select a.*, u.nome as usuario_nome from app.atendimentos a left join app.usuarios u on u.id = a.usuario_id
        where a.pedido_id = $1 or a.id = $2 order by a.em desc`, [id, p.atendimento_id])).rows;
    const depositos = (await c.query(
      ehGestao(u)
        ? "select id, nome from app.depositos where ativo order by nome"
        : `select d.id, d.nome from app.depositos d join app.vendedora_depositos vd on vd.deposito_id = d.id
            where vd.vendedora_id = $1 and d.ativo order by d.nome`,
      ehGestao(u) ? [] : [p.vendedora_id])).rows;
    const historico = (await c.query(
      `select a.em, a.acao, a.tabela, a.antes, a.depois, a.motivo, u.nome
         from app.auditoria a left join app.usuarios u on u.id = a.usuario_id
        where (a.tabela = 'pedidos' and a.registro_id = $1)
           or (a.tabela = 'pagamentos' and a.registro_id in (select id::text from app.pagamentos where pedido_id = $1::uuid))
        order by a.em desc limit 50`, [id])).rows;
    const trocas = (await c.query(
      `select t.id, t.descricao_antes, t.quantidade_antes, t.descricao_depois, t.quantidade, t.preco_depois, t.observacao, t.feito_em, u.nome
         from app.pedido_trocas t left join app.usuarios u on u.id = t.feito_por
        where t.pedido_id = $1 order by t.feito_em`, [id])).rows;
    const remocoes = (await c.query(
      `select r.id, r.item_id, r.descricao, r.quantidade, r.motivo, r.status, r.pedido_em, r.decidido_em, r.motivo_decisao,
              up.nome as pedido_nome, ud.nome as decidido_nome
         from app.pedido_remocoes r left join app.usuarios up on up.id = r.pedido_por left join app.usuarios ud on ud.id = r.decidido_por
        where r.pedido_id = $1 order by r.pedido_em`, [id])).rows;
    const editavelItens = p.origem !== "bling" && !fluxo?.total_confirmado_em
      && ["aguardando_cliente", "aguardando_aprovacao", "em_separacao"].includes(p.status_comercial);
    const produtos = editavelItens
      ? (await c.query("select codigo, nome from app.produtos where ativo and codigo is not null order by nome")).rows as { codigo: string; nome: string }[]
      : [];
    return { p, cliente, itens, fluxo, transf, bling, pagamentos, comprovantes, atendimentos, depositos, historico, indisponiveis,
             trocas, remocoes, editavelItens, produtos };
  });
  if (!d) notFound();
  const { p, cliente } = d;
  const moeda = p.moeda as Moeda;
  const escrever = podeEscrever(u);
  const gestao = ehGestao(u);
  const ehBling = p.origem === "bling";

  const mensagemCobranca =
    `Olá ${cliente?.nome ?? ""}! Tudo bem? Aqui é a ${p.vendedora_nome}, da Virtual Cosméticos. ` +
    (Number(p.saldo) > 0
      ? `Seu pedido${p.bling_numero ? " nº " + p.bling_numero : ""} tem saldo de ${dinheiro(p.saldo, moeda)}` +
        (p.vencimento ? `, com vencimento em ${data(p.vencimento)}` : "") + `. Pode me enviar o comprovante quando pagar?`
      : `Seu pedido${p.bling_numero ? " nº " + p.bling_numero : ""} está ${STATUS_COMERCIAL[p.status_comercial].toLowerCase()}.` +
        (p.previsao_envio ? ` Previsão de envio: ${data(p.previsao_envio)}.` : ""));
  const whats = linkWhatsApp(cliente?.whatsapp ?? cliente?.telefone, mensagemCobranca);
  const fluxo = d.fluxo;
  const msgTotal = fluxo?.total_confirmado_em
    ? `Olá ${cliente?.nome ?? ""}! Aqui é a ${p.vendedora_nome}, da Virtual Cosméticos. Seu pedido foi separado e o total ficou em ` +
      `${dinheiro(p.valor_total, moeda)}. Dados para pagamento:\n${fluxo.conta_pagamento}\nDepois é só enviar o comprovante pela área do cliente ou por aqui. Obrigada!`
    : null;
  const whatsTotal = msgTotal ? linkWhatsApp(cliente?.whatsapp ?? cliente?.telefone, msgTotal) : null;
  const portal = p.origem === "portal";
  const h = await headers();
  const linkCliente = avisos.link && /^[A-Za-z0-9_-]{20,64}$/.test(avisos.link)
    ? `${urlPortal(h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto"))}/loja/pedido/${avisos.link}` : null;
  const msgLink = linkCliente
    ? `Olá ${cliente?.nome ?? ""}! Aqui é a ${p.vendedora_nome}, da Virtual Cosméticos. Montei o seu pedido:\n` +
      d.itens.map((i) => `• ${Number(i.quantidade)}× ${i.descricao}`).join("\n") +
      `\nTotal: ${dinheiro(p.valor_total, moeda)}\nConfira e confirme as caixas por este link: ${linkCliente}`
    : null;
  const whatsLink = msgLink ? linkWhatsApp(cliente?.whatsapp ?? cliente?.telefone, msgLink) : null;
  const itensBling: { codigo?: string; descricao?: string; quantidade?: number; valor?: number }[] =
    d.bling && Array.isArray(d.bling.itens) ? d.bling.itens : [];

  return (
    <>
      <section className="linha entre">
        <div>
          <Link href="/pedidos">← Pedidos</Link>
          <h1 style={{ marginTop: 4 }}>
            {p.bling_numero ? `Pedido ${p.bling_numero}` : "Pedido sem nº do Bling"} · {cliente?.nome ?? "Sem cliente"}
          </h1>
          <div className="linha pequeno suave">
            <span>{data(p.data_pedido)}</span><span>{p.vendedora_nome}</span><span>Canal: {p.canal}</span>
            <span>Origem: {p.origem}</span>
            <Selo cor={COR_PAGAMENTO[p.status_pagamento]}>{STATUS_PAGAMENTO[p.status_pagamento]}</Selo>
            <Selo>{STATUS_COMERCIAL[p.status_comercial]}</Selo>
            {p.envio_atrasado && <Selo cor="erro">envio atrasado</Selo>}
          </div>
        </div>
        <div className="linha">
          {cliente && <Link className="botao" href={`/clientes/${cliente.id}`}>Ficha do cliente</Link>}
          <Link className="botao" href={`/pedidos/${p.id}/resumo`}>Resumo para o cliente</Link>
          {whats && <a className="botao whatsapp" href={whats} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
        </div>
      </section>

      <Avisos ok={avisos.ok} erro={avisos.erro} />

      {p.desconto_qtd_status === "pendente" && (
        <section className="painel" style={{ borderColor: "#e0b04a", background: "#fffaf0" }}>
          <h2 style={{ margin: 0 }}>Desconto por quantidade esperando liberação: {Number(p.desconto_qtd_pct)}%</h2>
          <p className="suave" style={{ margin: 0 }}>O cliente atingiu a faixa de desconto por quantidade no site. O desconto só entra no pedido se o gerente liberar; até lá os preços estão normais.</p>
          {gestao ? (
            <div className="linha">
              <form action={decidirDescontoQuantidade}><input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="liberar" value="1" /><button className="principal">Liberar {Number(p.desconto_qtd_pct)}% de desconto</button></form>
              <form action={decidirDescontoQuantidade}><input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="liberar" value="0" /><button>Não liberar</button></form>
            </div>
          ) : <p className="pequeno" style={{ margin: 0 }}>Peça ao gerente para liberar antes de confirmar o total ao cliente.</p>}
        </section>
      )}
      {p.desconto_qtd_status === "aprovado" && <div className="aviso-caixa ok">Desconto por quantidade de {Number(p.desconto_qtd_pct)}% liberado pelo gerente.</div>}

      {p.status_comercial === "aguardando_cliente" && (
        <section className="painel" style={{ borderColor: "var(--marca)" }}>
          <h2>Aguardando o cliente confirmar</h2>
          <p className="suave">Mande o link ao cliente. Ele confere o pedido, ajusta as caixas e confirma; aí o pedido vai para a separação.
            Cada link novo cancela o anterior.</p>
          {linkCliente && (
            <div className="aviso-caixa ok campos">
              <label className="largo">Link do pedido (copie ou envie pelo WhatsApp)<input readOnly value={linkCliente} /></label>
              {whatsLink
                ? <a className="botao whatsapp" href={whatsLink} target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>
                : <span className="pequeno suave">O cliente não tem WhatsApp cadastrado: copie o link acima.</span>}
              <span className="pequeno suave">Este link só aparece agora. Se perder, gere outro.</span>
            </div>
          )}
          {escrever && (
            <form action={gerarLinkPedido}>
              <input type="hidden" name="pedido_id" value={p.id} />
              <button className={linkCliente ? "" : "principal"}>{linkCliente ? "Gerar outro link" : "Gerar link para o cliente"}</button>
            </form>
          )}
        </section>
      )}

      {escrever && p.status_comercial === "aguardando_aprovacao" && (
        <section className="painel" style={{ borderColor: "var(--marca)" }}>
          <h2>Pedido feito pelo cliente na área de atacado</h2>
          <p className="suave">Confira os itens. Ao aprovar, o pedido vai para a expedição separar
            {d.itens.some((i) => i.origem && i.origem !== d.itens[0]?.origem) ? " e a transferência do CD para a loja já fica preparada" : ""}.</p>
          <form action={decidirPedidoPortal} className="campos">
            <input type="hidden" name="pedido_id" value={p.id} />
            <label>Motivo (se recusar, o cliente vê)<input name="motivo" /></label>
            <div className="linha">
              <button className="principal" name="decisao" value="aprovar">Aprovar e mandar separar</button>
              <button className="perigo" name="decisao" value="recusar">Recusar</button>
            </div>
          </form>
        </section>
      )}

      {p.status_comercial === "em_separacao" && p.origem !== "bling" && !fluxo?.separacao_conferida_em && (gestao || fluxo?.opera) && (
        <section className="painel" id="separar" style={{ borderColor: "var(--info)" }}>
          <h2>Conferir separação</h2>
          <p className="suave pequeno">Informe quanto foi separado de cada item. Se não tem, marque “Não tem”: o item sai do pedido, o total é recalculado e o cliente vê no acompanhamento que ele não estava disponível.</p>
          <form action={conferirSeparacao} className="campos">
            <input type="hidden" name="pedido_id" value={p.id} />
            {d.itens.map((i) => (
              <div key={i.id} className="largo linha separar-item">
                <span style={{ flex: 1, minWidth: 180 }}>{i.descricao} <span className="suave">(pedido {Number(i.quantidade_pedida)})</span></span>
                <input name={`sep_${i.id}`} inputMode="decimal" defaultValue={Number(i.quantidade)} aria-label={`Separado de ${i.descricao}`} style={{ width: 90 }} />
                <label className="linha" style={{ gap: 6 }}><input type="checkbox" name={`falta_${i.id}`} /> Não tem</label>
              </div>
            ))}
            <button className="principal">Separação conferida</button>
          </form>
        </section>
      )}
      {p.status_comercial === "em_separacao" && p.origem !== "bling" && !fluxo?.separacao_conferida_em && !(gestao || fluxo?.opera) && (
        <div className="aviso-caixa">Aguardando a expedição conferir a separação.</div>
      )}

      {d.remocoes.some((r) => r.status === "pendente") && (
        <section className="painel" id="remocoes" style={{ borderColor: "#e0b04a", background: "#fffaf0" }}>
          <h2 style={{ margin: 0 }}>Tirar produto do pedido: aguardando autorização</h2>
          <p className="suave pequeno" style={{ margin: 0 }}>O cliente não aceitou trocar. Ao autorizar, o item sai do pedido, o total é recalculado,
            o cliente vê que ele não estava disponível e o produto vai para a lista de <Link href="/procuras">procurados sem estoque</Link>.</p>
          {d.remocoes.filter((r) => r.status === "pendente").map((r) => (
            <div key={r.id} className="aviso-caixa campos">
              <span className="largo"><b>{Number(r.quantidade)}× {r.descricao}</b> · pedido por {r.pedido_nome ?? "—"} em {dataHora(r.pedido_em)}
                <br /><span className="pequeno">Motivo: {r.motivo}</span></span>
              {gestao ? (
                <form action={decidirRemocao} className="linha largo">
                  <input type="hidden" name="pedido_id" value={p.id} />
                  <input type="hidden" name="remocao_id" value={r.id} />
                  <input name="motivo_decisao" placeholder="Observação (opcional)" style={{ flex: 1, minWidth: 160 }} />
                  <button className="principal" name="decisao" value="aprovar">Autorizar e mandar para procurados</button>
                  <button name="decisao" value="recusar">Recusar</button>
                </form>
              ) : <span className="pequeno suave largo">Aguardando o gerente ou o dono autorizar.</span>}
            </div>
          ))}
        </section>
      )}

      {escrever && d.editavelItens && d.itens.length > 0 && (
        <section className="painel" id="sem-estoque">
          <h2>Produto sem estoque? Trocar ou tirar do pedido</h2>
          <p className="suave pequeno">Fale com o cliente antes. <b>Trocar</b>: escolha o substituto (outro produto ou aroma) e anexe o print da conversa
            em que o cliente aceitou; o preço é o da tabela dele. <b>Tirar do pedido</b>: se o cliente não quiser outro, peça a autorização;
            o gerente ou o dono aprova e o produto vai para a lista de procurados sem estoque (para comprarmos quando juntar volume).</p>
          <datalist id="lista-substitutos">
            {d.produtos.map((x) => <option key={x.codigo} value={`${x.codigo} · ${x.nome}`} />)}
          </datalist>
          {d.itens.map((i) => {
            const pendente = d.remocoes.some((r) => r.status === "pendente" && r.item_id === i.id);
            return (
              <details key={i.id} className="aviso-caixa" style={{ marginBottom: 8 }}>
                <summary><b>{Number(i.quantidade)}× {i.descricao}</b> <span className="suave pequeno">({i.codigo})</span>
                  {pendente && <span className="pequeno"> · remoção aguardando autorização</span>}</summary>
                <form action={trocarItem} className="campos" style={{ marginTop: 8 }}>
                  <input type="hidden" name="pedido_id" value={p.id} />
                  <input type="hidden" name="item_id" value={i.id} />
                  <label className="largo">Trocar por (produto ou aroma)
                    <input name="produto" list="lista-substitutos" required placeholder="Digite o código ou o nome" autoComplete="off" /></label>
                  <label>Quantidade<input name="quantidade" inputMode="decimal" defaultValue={Number(i.quantidade)} required /></label>
                  <label>Print da conversa com o cliente (obrigatório)<input type="file" name="print" accept="image/jpeg,image/png,image/webp,application/pdf" required /></label>
                  <label className="largo">Observação<input name="observacao" placeholder="Ex.: cliente preferiu o aroma morango" /></label>
                  <button className="principal">Trocar produto</button>
                </form>
                {!pendente && (
                  <form action={pedirRemocao} className="linha" style={{ marginTop: 8 }}>
                    <input type="hidden" name="pedido_id" value={p.id} />
                    <input type="hidden" name="item_id" value={i.id} />
                    <input name="motivo" required placeholder="Por que tirar? (ex.: cliente não quis outro aroma)" style={{ flex: 1, minWidth: 200 }} />
                    <button className="perigo">Pedir para tirar do pedido</button>
                  </form>
                )}
              </details>
            );
          })}
        </section>
      )}

      {(d.trocas.length > 0 || d.remocoes.some((r) => r.status !== "pendente")) && (
        <section className="painel">
          <h2>Trocas e remoções</h2>
          <ul className="pequeno">
            {d.trocas.map((t) => (
              <li key={t.id}>{dataHora(t.feito_em)} · {t.nome ?? "—"} trocou <b>{Number(t.quantidade_antes)}× {t.descricao_antes}</b> por{" "}
                <b>{Number(t.quantidade)}× {t.descricao_depois}</b> ({dinheiro(t.preco_depois, moeda)} cada)
                {t.observacao && <> · {t.observacao}</>} · <a href={`/trocas/${t.id}`} target="_blank" rel="noopener noreferrer">ver print</a></li>
            ))}
            {d.remocoes.filter((r) => r.status !== "pendente").map((r) => (
              <li key={r.id}>{dataHora(r.decidido_em)} · remoção de <b>{Number(r.quantidade)}× {r.descricao}</b>{" "}
                {r.status === "aprovada" ? "autorizada" : "recusada"} por {r.decidido_nome ?? "—"} (pedida por {r.pedido_nome ?? "—"}: {r.motivo})
                {r.motivo_decisao && <> · {r.motivo_decisao}</>}</li>
            ))}
          </ul>
        </section>
      )}

      {escrever && (p.status_comercial === "cancelado" || p.status_comercial === "em_separacao") && (
        <div className="aviso-caixa linha entre" style={{ flexWrap: "wrap" }}>
          <span className="pequeno">{p.status_comercial === "cancelado"
            ? "Pedido cancelado: quer levar estes produtos para outra unidade (ex.: CDE)?"
            : "Faltou produto nesta unidade? Peça à outra unidade e avise o cliente que chega em poucos dias."}</span>
          <Link className="botao" href={`/estoque/transferencias/nova?pedido=${p.id}`}>Pedir à outra unidade</Link>
        </div>
      )}
      {escrever && p.status_comercial === "em_separacao" && (fluxo?.separacao_conferida_em || p.origem === "bling") && !fluxo?.total_confirmado_em && (
        <section className="painel" style={{ borderColor: "var(--marca)" }}>
          <h2>Confirmar total para o cliente</h2>
          <p>Total separado: <b className="num">{dinheiro(p.valor_total, moeda)}</b></p>
          <form action={confirmarTotal} className="campos">
            <input type="hidden" name="pedido_id" value={p.id} />
            <label className="largo">Dados para pagamento (banco, conta, titular)
              <textarea name="conta" required placeholder="Ex.: Banco Continental · Cuenta 0000000 · Virtual Cosméticos" />
            </label>
            <button className="principal">Confirmar total</button>
          </form>
        </section>
      )}
      {fluxo?.total_confirmado_em && Number(p.saldo) > 0 && (
        <div className="aviso-caixa linha entre">
          <span>Total confirmado ao cliente em {dataHora(fluxo.total_confirmado_em)}.</span>
          {whatsTotal && <a className="botao whatsapp" href={whatsTotal} target="_blank" rel="noopener noreferrer">Enviar total e conta pelo WhatsApp</a>}
        </div>
      )}
      {d.indisponiveis.length > 0 && (
        <div className="aviso-caixa">
          <b>Itens que a expedição não tinha</b> (o cliente vê no acompanhamento):
          <ul className="lista-simples">{d.indisponiveis.map((x, k) => (
            <li key={k}>{x.descricao}: faltou {Number(x.quantidade_faltou)} de {Number(x.quantidade_pedida)}</li>))}
          </ul>
        </div>
      )}
      {(escrever || fluxo?.opera) && ["em_separacao", "enviado", "aguardando_retirada", "entregue"].includes(p.status_comercial) && (
        <form action={definirVolumes} className="painel linha">
          <input type="hidden" name="pedido_id" value={p.id} />
          <label>Volumes do envio (caixas que saem)
            <input name="volumes" type="number" min={0} max={10000} defaultValue={fluxo?.volumes ?? ""} style={{ width: 110 }} />
          </label>
          <button>Salvar volumes</button>
          <span className="pequeno suave">Usado no resumo semanal de envios e no custo do passeiro.</span>
        </form>
      )}
      {p.origem !== "bling" && (escrever || fluxo?.opera) && ["em_separacao", "enviado", "aguardando_retirada"].includes(p.status_comercial)
        && (fluxo?.separacao_conferida_em) && (
        <section className="painel" style={{ borderColor: "var(--ok)" }}>
          <h2>Entrega</h2>
          <div className="etapas-entrega pequeno">
            {["Separado", "Em transporte", "Aguardando retirada", "Retirado"].map((e, k) => {
              const atual = p.status_comercial === "em_separacao" ? 0 : p.status_comercial === "enviado" ? 1 : 2;
              return <span key={e} className={k <= atual ? "feita" : ""}>{e}</span>;
            })}
          </div>
          {p.status_comercial === "em_separacao" && (
            <form action={avancarEntrega} className="linha">
              <input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="etapa" value="transporte" />
              <button className="principal">Despachar: em transporte</button>
              {Number(p.saldo) > 0 && <span className="pequeno suave">Atenção: ainda há saldo a pagar de {dinheiro(p.saldo, moeda)}.</span>}
            </form>
          )}
          {p.status_comercial === "enviado" && (
            <form action={avancarEntrega} className="linha" style={{ alignItems: "end" }}>
              <input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="etapa" value="retirada" />
              <label style={{ flex: 1, minWidth: 220 }}>Onde o cliente retira
                <input name="local" required defaultValue={fluxo?.local_retirada ?? fluxo?.deposito_nome ?? ""} placeholder="Ex.: Loja Ciudad del Este, Transportadora X em Asunción" />
              </label>
              <button className="principal">Chegou: aguardando retirada</button>
            </form>
          )}
          {p.status_comercial === "aguardando_retirada" && (
            <>
              <p style={{ margin: 0 }}>Aguardando retirada em <b>{fluxo?.local_retirada}</b>{fluxo?.chegou_em ? ` desde ${dataHora(fluxo.chegou_em)}` : ""}.</p>
              {(() => {
                const z = cliente ? linkWhatsApp(cliente.whatsapp ?? cliente.telefone,
                  `Olá ${cliente.nome}! Aqui é a ${p.vendedora_nome}, da Virtual Cosméticos. Seu pedido${p.bling_numero ? " nº " + p.bling_numero : ""} já está disponível para retirada em ${fluxo?.local_retirada}.`) : null;
                return z ? <a className="botao whatsapp" href={z} target="_blank" rel="noopener noreferrer">Avisar o cliente pelo WhatsApp</a> : null;
              })()}
              <form action={avancarEntrega}>
                <input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="etapa" value="entregue" />
                <button className="principal">Cliente retirou</button>
              </form>
            </>
          )}
        </section>
      )}
      {d.transf.length > 0 && (
        <div className="aviso-caixa">
          Transferência ligada a este pedido: {d.transf.map((t) => `nº ${t.numero} (${t.status})`).join(", ")}. <Link href="/estoque#transferencias">Ver no estoque</Link>
        </div>
      )}
      {portal && <p className="pequeno suave">Pedido feito pelo cliente na área de atacado.</p>}

      {p.bling_mudou && (
        <div className="aviso-caixa aviso linha entre">
          <span>Este pedido <b>mudou no Bling</b> desde a última revisão
            {p.divergencia_valor && <> (Bling: {dinheiro(p.bling_total, moeda)}, sistema: {dinheiro(p.valor_total, moeda)})</>}.</span>
          {escrever && (
            <form action={reconhecerBling}><input type="hidden" name="pedido_id" value={p.id} /><button>Marcar como revisado</button></form>
          )}
        </div>
      )}

      <div className="indicadores">
        <div className="indicador"><span className="rotulo">Total</span><span className="valor num">{dinheiro(p.valor_total, moeda)}</span></div>
        <div className="indicador"><span className="rotulo">Recebido (conferido)</span><span className="valor num">{dinheiro(p.recebido, moeda)}</span></div>
        <div className="indicador"><span className="rotulo">A conferir</span><span className="valor num">{dinheiro(p.a_conferir, moeda)}</span></div>
        <div className="indicador"><span className="rotulo">Saldo pendente</span><span className="valor num">{dinheiro(p.saldo, moeda)}</span></div>
        <div className="indicador"><span className="rotulo">Vencimento</span><span className="valor">{data(p.vencimento)}</span>
          {p.credito_concedido && <span className="pequeno suave">crédito concedido</span>}</div>
        <div className="indicador"><span className="rotulo">Previsão de envio</span><span className="valor">{data(p.previsao_envio)}</span></div>
      </div>

      <div className="duas-colunas">
        <div className="coluna">
          <section className="painel">
            <h2>Itens</h2>
            {d.itens.length > 0 ? (
              <div className="tabela"><table>
                <thead><tr><th>Código</th><th>Produto</th><th>Qtd</th><th>Preço</th><th>Total</th></tr></thead>
                <tbody>{d.itens.map((i, k) => (
                  <tr key={k}><td className="num">{i.codigo}</td><td>{i.descricao}{i.origem && <div className="pequeno suave">Sai de: {i.origem}</div>}</td>
                    <td className="num">{Number(i.quantidade)}{Number(i.quantidade_pedida) !== Number(i.quantidade) && <div className="pequeno suave">pedido: {Number(i.quantidade_pedida)}</div>}</td>
                    <td className="num">{dinheiro(i.preco_unitario, moeda)}</td><td className="num">{dinheiro(i.total, moeda)}</td></tr>))}
                </tbody></table></div>
            ) : itensBling.length > 0 ? (
              <div className="tabela"><table>
                <thead><tr><th>Código</th><th>Produto</th><th>Qtd</th><th>Valor</th></tr></thead>
                <tbody>{itensBling.map((i, k) => (
                  <tr key={k}><td className="num">{i.codigo}</td><td>{i.descricao ?? "—"}</td><td className="num">{i.quantidade}</td>
                    <td className="num">{dinheiro(i.valor ?? null, moeda)}</td></tr>))}
                </tbody></table></div>
            ) : <p className="suave">Itens não informados (pedido vindo da planilha).</p>}
            {ehBling && <p className="pequeno suave">Itens e valores deste pedido vêm do Bling e só mudam lá.</p>}
          </section>

          <section className="painel" id="pagamentos">
            <h2>Pagamentos</h2>
            {d.pagamentos.length === 0 && <p className="suave">Nenhum pagamento registrado.</p>}
            {d.pagamentos.map((g) => (
              <div key={g.id} className="painel" style={{ background: "var(--afundado)" }}>
                <div className="linha entre">
                  <b className="num">{dinheiro(g.valor, moeda)}</b>
                  <Selo cor={g.status_conferencia === "conferido" ? "ok" : g.status_conferencia === "recusado" ? "erro" : "aviso"}>
                    {CONFERENCIA[g.status_conferencia]}
                  </Selo>
                </div>
                <div className="pequeno suave">
                  {data(g.data)} · {MODALIDADES[g.modalidade]}{g.banco ? ` · ${g.banco}` : ""} · registrado por {g.registrado_nome ?? "—"}
                  {g.observacao ? ` · ${g.observacao}` : ""}
                </div>
                {g.status_conferencia !== "pendente" && (
                  <div className="pequeno">
                    {g.status_conferencia === "conferido"
                      ? `Conferido por ${g.conferido_nome} em ${dataHora(g.conferido_em)} com o pedido ${g.conferencia_bling_numero} do Bling.`
                      : `Recusado por ${g.conferido_nome} em ${dataHora(g.conferido_em)}: ${g.motivo_recusa}`}
                  </div>
                )}
                <div className="linha pequeno">
                  {d.comprovantes.filter((c) => c.pagamento_id === g.id).map((c) => (
                    <a key={c.id} href={`/comprovantes/${c.id}`} target="_blank" rel="noopener noreferrer">📎 {c.nome_original ?? "comprovante"}</a>
                  ))}
                  {d.comprovantes.every((c) => c.pagamento_id !== g.id) && <span className="suave">Sem comprovante</span>}
                </div>
                {escrever && g.status_conferencia === "pendente" && (
                  <form action={anexarComprovante} className="linha">
                    <input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="pagamento_id" value={g.id} />
                    <input type="file" name="comprovante" accept="image/*,application/pdf" style={{ maxWidth: 260 }} />
                    <button>Anexar comprovante</button>
                  </form>
                )}
                {gestao && g.status_conferencia === "pendente" && (
                  <div className="duas-colunas" style={{ gap: 10 }}>
                    <form action={conferirPagamento} className="campos">
                      <input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="pagamento_id" value={g.id} />
                      <label>Nº do pedido no Bling
                        <input name="bling_numero" inputMode="numeric" required defaultValue={p.bling_numero ?? ""} />
                      </label>
                      <button className="principal">Conferir</button>
                    </form>
                    <form action={recusarPagamento} className="campos">
                      <input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="pagamento_id" value={g.id} />
                      <label>Motivo da recusa<input name="motivo" required placeholder="Ex.: não localizado no banco" /></label>
                      <button className="perigo">Recusar</button>
                    </form>
                  </div>
                )}
              </div>
            ))}
            {escrever && p.status_comercial !== "cancelado" && (
              <details open={d.pagamentos.length === 0}>
                <summary>Registrar pagamento</summary>
                <form action={registrarPagamento} className="campos" style={{ marginTop: 10 }}>
                  <input type="hidden" name="pedido_id" value={p.id} />
                  <label>Valor ({moeda === "GS" ? "Gs" : "R$"})<input name="valor" inputMode="decimal" required /></label>
                  <label>Data<input name="data" type="date" required defaultValue={hojeISO()} /></label>
                  <label>Modalidade
                    <select name="modalidade" defaultValue="transferencia">
                      {Object.entries(MODALIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                  <label>Banco / conta<input name="banco" placeholder="Ex.: Continental, Ueno" /></label>
                  <label className="largo">Comprovante (foto ou PDF)
                    <input name="comprovante" type="file" accept="image/*,application/pdf" />
                  </label>
                  <label className="largo">Observação<input name="observacao" /></label>
                  <button className="principal">Registrar</button>
                </form>
                <p className="pequeno suave">O pagamento só conta como recebido depois que o gerente conferir com o nº do pedido no Bling.</p>
              </details>
            )}
          </section>
        </div>

        <div className="coluna">
          <section className="painel">
            <h2>Dados comerciais</h2>
            {escrever ? (
              <form action={atualizarPedido} className="campos">
                <input type="hidden" name="pedido_id" value={p.id} />
                <label>Status comercial
                  <select name="status_comercial" defaultValue={p.status_comercial}>
                    {Object.entries(STATUS_COMERCIAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label>Previsão de envio<input name="previsao_envio" type="date" defaultValue={p.previsao_envio ?? ""} /></label>
                <label>Depósito
                  <select name="deposito_id" defaultValue={p.deposito_id ?? ""} disabled={p.status_comercial !== "em_separacao"}>
                    <option value="">—</option>
                    {d.depositos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                  </select>
                </label>
                <label>Vencimento<input name="vencimento" type="date" defaultValue={p.vencimento ?? ""} /></label>
                <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" name="credito_concedido" defaultChecked={p.credito_concedido} style={{ width: "auto" }} /> Crédito concedido
                </label>
                <label className="largo">Observações<textarea name="observacoes" defaultValue={p.observacoes ?? ""} /></label>
                <label className="largo">Motivo da alteração (vai para o histórico)<input name="motivo" /></label>
                <button className="principal">Salvar</button>
              </form>
            ) : (
              <p>{p.observacoes ?? <span className="suave">Sem observações.</span>}</p>
            )}
            {d.bling && (
              <p className="pequeno suave">
                Bling: pedido {d.bling.numero}, situação {d.bling.situacao_nome ?? "—"}, total {dinheiro(d.bling.total, moeda)}.
                Sincronizado em {dataHora(d.bling.sincronizado_em)}.
              </p>
            )}
          </section>

          {cliente && (
            <section className="painel">
              <h2>Atendimento</h2>
              {escrever && (
                <form action={registrarAtendimento} className="campos">
                  <input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="cliente_id" value={cliente.id} />
                  <label>Tipo
                    <select name="tipo" defaultValue="whatsapp">
                      {Object.entries(TIPO_ATENDIMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                  <label>Resultado<input name="resultado" placeholder="Ex.: vai pagar sexta" /></label>
                  <label className="largo">O que foi conversado<textarea name="nota" /></label>
                  <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <input type="checkbox" name="vincular" style={{ width: "auto" }} /> É o atendimento que gerou o pedido
                  </label>
                  <button>Registrar</button>
                </form>
              )}
              {d.atendimentos.length === 0 ? <p className="suave">Nenhum atendimento ligado a este pedido.</p> : (
                <ul className="lista-simples">
                  {d.atendimentos.map((a) => (
                    <li key={a.id}>
                      <b>{TIPO_ATENDIMENTO[a.tipo]}</b> · {dataHora(a.em)} · {a.usuario_nome}
                      {a.id === p.atendimento_id && <> <Selo cor="marca">originou o pedido</Selo></>}
                      {a.resultado && <div>{a.resultado}</div>}
                      {a.nota && <div className="suave">{a.nota}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {d.historico.length > 0 && (
            <section className="painel">
              <h2>Histórico de alterações</h2>
              <ul className="lista-simples pequeno">
                {d.historico.map((h, k) => (
                  <li key={k}>
                    {dataHora(h.em)} · {h.nome ?? "Sistema"} · {h.tabela === "pagamentos" ? "pagamento" : "pedido"} ·{" "}
                    {h.acao === "INSERT" ? "criado" : h.acao === "UPDATE" ? "alterado" : "removido"}
                    {h.acao === "UPDATE" && h.depois && (
                      <span className="suave"> ({Object.keys(h.depois).join(", ")})</span>
                    )}
                    {h.motivo && <div className="suave">Motivo: {h.motivo}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
