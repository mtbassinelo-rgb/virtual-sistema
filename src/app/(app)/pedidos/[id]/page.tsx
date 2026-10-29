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
  anexarComprovante, atualizarPedido, cancelarPedido, avancarEntrega, conferirPagamento, confirmarTotal, decidirPedidoPortal,
  reconhecerBling, recusarPagamento, registrarAtendimento, registrarPagamento, gerarLinkPedido, definirVolumes, decidirDescontoQuantidade,
  decidirRemocao,
} from "../acoes";
import { ItensPedido, type ItemPedido, type Sugestao } from "./itens-pedido";
import { FormEntrega } from "./entrega";

export const metadata = { title: "Pedido" };

/** Para o estoquista: quando a caixa do fornecedor tem menos de 12, quantas caixas físicas mandar. */
function caixasFisicas(qtd: number, cx: number | null): string {
  if (!cx || cx >= 12 || qtd <= 0) return "";
  const n = Math.floor(qtd / cx), r = qtd - n * cx;
  return `enviar ${n ? `${n} cx de ${cx}` : ""}${n && r ? " + " : ""}${r ? `${r} un` : ""}`;
}

const palavras = (t: string) => t.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
  .replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1);

/** Outras fragrâncias/variações do mesmo produto: mesma marca e nome parecido (troca com um clique). */
function variacoes(item: { codigo: string | null; nome: string | null; descricao: string; marca: string | null },
                   produtos: { codigo: string; nome: string; marca: string | null; estoque: number }[]): Sugestao[] {
  const a = new Set(palavras(item.nome ?? item.descricao));
  if (a.size === 0) return [];
  return produtos
    .filter((x) => x.codigo !== item.codigo && (!item.marca || !x.marca || x.marca === item.marca))
    .map((x) => {
      const b = new Set(palavras(x.nome));
      const comum = [...b].filter((w) => a.has(w)).length;
      return { x, nota: comum / Math.max(a.size, b.size) };
    })
    .filter((r) => r.nota >= 0.5)
    .sort((r1, r2) => r2.nota - r1.nota || Number(r2.x.estoque > 0) - Number(r1.x.estoque > 0))
    .slice(0, 8)
    .map(({ x }) => ({ codigo: x.codigo, nome: x.nome, estoque: Number(x.estoque) }));
}

/** O que falta fazer neste pedido, em uma frase (para a vendedora e a expedição). */
function proximoPasso(p: { status_comercial: string; origem: string; saldo: string; a_conferir: string },
                      f: { separacao_conferida_em: string | null; total_confirmado_em: string | null } | undefined): string | null {
  switch (p.status_comercial) {
    case "aguardando_cliente": return "Mandar o link para o cliente conferir e confirmar as caixas.";
    case "aguardando_aprovacao": return "Vendedora: confira e ajuste os itens com o cliente e mande para a separação.";
    case "em_separacao":
      if (p.origem !== "bling" && !f?.separacao_conferida_em) return "Expedição: conferir a separação na lista de itens. Faltou algo? Troque a fragrância com o cliente.";
      if (p.origem !== "bling" && !f?.total_confirmado_em) return "Confirmar o total e mandar a conta para o cliente pelo WhatsApp.";
      if (Number(p.saldo) > 0 && Number(p.a_conferir) > 0) return "O cliente informou o pagamento: o gerente confirma o recebimento.";
      if (Number(p.saldo) > 0) return "Aguardando o pagamento do cliente (registre o comprovante quando chegar).";
      return "Pago: despachar o pedido.";
    case "enviado": return "Em transporte: avisar quando chegar para retirada.";
    case "aguardando_retirada": return "Aguardando o cliente retirar.";
    default: return null;
  }
}

const PASSOS = ["Pedido", "Confirmado", "Separado", "Total enviado", "Pago", "Enviado", "Entregue"];

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
      `select i.id, i.codigo, i.descricao, i.quantidade, i.quantidade_pedida, i.preco_unitario, i.desconto, i.total, d.nome as origem,
              pr.unidades_caixa_fornecedor as cx_forn, pr.nome, pr.marca
         from app.pedido_itens i left join app.depositos d on d.id = i.deposito_origem_id left join app.produtos pr on pr.id = i.produto_id
        where i.pedido_id = $1 order by i.codigo, d.nome`, [id])).rows;
    const fluxo = (await c.query(
      `select volumes, separacao_conferida_em, total_confirmado_em, conta_pagamento, app.pode_operar_deposito(deposito_id) as opera,
              chegou_em, local_retirada, (select nome from app.depositos where id = deposito_id) as deposito_nome,
              entrega_tipo, entrega_meio, entrega_dados, entrega_definida_em, app.nome_usuario(entrega_definida_por) as entrega_definida_nome,
              despachado_em, app.nome_usuario(despachado_por) as despachado_nome, envio_confirmado_em, app.nome_usuario(envio_confirmado_por) as envio_confirmado_nome, envio_guia
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
      `select t.id, t.arquivo is not null as tem_print, t.descricao_antes, t.quantidade_antes, t.descricao_depois, t.quantidade, t.preco_depois, t.observacao, t.feito_em, u.nome
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
      ? (await c.query(
          `select pr.codigo, pr.nome, pr.marca, coalesce(s.quantidade, 0)::float estoque
             from app.produtos pr left join app.estoque_saldos s on s.produto_id = pr.id and s.deposito_id = $1
            where pr.ativo and not pr.marketplace and pr.codigo is not null order by pr.nome`, [p.deposito_id])).rows as
          { codigo: string; nome: string; marca: string | null; estoque: number }[]
      : [];
    // Parâmetros → vendedora_ajusta_separacao: vendedora diminui/tira itens também na separação
    const ajustaSeparacao = Number((await c.query("select app.param('vendedora_ajusta_separacao') v")).rows[0]?.v ?? 0) === 1;
    // Parâmetros → vendedora_cancela_pedido: vendedora cancela o próprio pedido antes de sair
    const cancelaVendedora = Number((await c.query("select app.param('vendedora_cancela_pedido') v")).rows[0]?.v ?? 0) === 1;
    return { p, cliente, itens, fluxo, transf, bling, pagamentos, comprovantes, atendimentos, depositos, historico, indisponiveis,
             trocas, remocoes, editavelItens, produtos, ajustaSeparacao, cancelaVendedora };
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
      d.itens.map((i) => `• ${Number(i.quantidade)}× ${i.descricao} · ${dinheiro(i.total, moeda)} _(${dinheiro(i.preco_unitario, moeda)} un.)_`).join("\n") +
      `\nTotal: ${dinheiro(p.valor_total, moeda)}\nConfira e confirme as caixas por este link: ${linkCliente}`
    : null;
  const whatsLink = msgLink ? linkWhatsApp(cliente?.whatsapp ?? cliente?.telefone, msgLink) : null;
  const separar = p.status_comercial === "em_separacao" && p.origem !== "bling" && !fluxo?.separacao_conferida_em && Boolean(gestao || fluxo?.opera);
  const naSeparacao = p.status_comercial === "em_separacao";
  // Cancelar: gerente em qualquer etapa; vendedora antes do pedido sair e sem pagamento (o banco confere de novo)
  const podeCancelar = p.status_comercial !== "cancelado" && !ehBling && !(p.origem === "planilha" && p.numero_externo)
    && (gestao || (escrever && d.cancelaVendedora && d.pagamentos.every((g) => g.status_conferencia === "recusado")
        && ["aguardando_cliente", "aguardando_aprovacao", "em_separacao"].includes(p.status_comercial)));
  const editar = escrever && d.editavelItens
    && (["aguardando_cliente", "aguardando_aprovacao"].includes(p.status_comercial) || (naSeparacao && (gestao || d.ajustaSeparacao)));
  const trocar = escrever && d.editavelItens;
  const itensVista: ItemPedido[] = d.itens.map((i) => ({
    id: i.id, codigo: i.codigo, descricao: i.descricao, quantidade: Number(i.quantidade), pedida: Number(i.quantidade_pedida),
    preco: dinheiro(i.preco_unitario, moeda), total: dinheiro(i.total, moeda), origem: i.origem,
    caixas: caixasFisicas(Number(i.quantidade), i.cx_forn),
    sugestoes: trocar ? variacoes(i, d.produtos) : [],
    remocaoPendente: d.remocoes.some((r) => r.status === "pendente" && r.item_id === i.id),
  }));
  const passo = proximoPasso(p, fluxo);
  const pendentes = d.pagamentos.filter((g) => g.status_conferencia === "pendente");
  const resolvidos = d.pagamentos.filter((g) => g.status_conferencia !== "pendente");
  const feitos = [
    true,
    !["aguardando_cliente", "aguardando_aprovacao"].includes(p.status_comercial),
    Boolean(fluxo?.separacao_conferida_em) || ["enviado", "aguardando_retirada", "entregue"].includes(p.status_comercial),
    Boolean(fluxo?.total_confirmado_em) || ehBling,
    p.status_pagamento === "pago",
    ["enviado", "aguardando_retirada", "entregue"].includes(p.status_comercial),
    p.status_comercial === "entregue",
  ];
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

      {p.status_comercial === "cancelado" ? (
        <div className="aviso-caixa erro"><b>Pedido cancelado.</b></div>
      ) : (
        <section className="painel passos-pedido">
          <ol className="passos">
            {PASSOS.map((nome, k) => (
              <li key={nome} className={feitos[k] ? "feito" : k === feitos.indexOf(false) ? "atual" : ""}>
                <span className="passo-ponto">{feitos[k] ? "✓" : k + 1}</span><span>{nome}</span>
              </li>
            ))}
          </ol>
          {passo && <div className="proximo-passo"><span>Próximo passo</span><b>{passo}</b></div>}
          {p.status_comercial === "em_separacao" && p.origem !== "bling" && !fluxo?.separacao_conferida_em && !(gestao || fluxo?.opera) && (
            <span className="pequeno suave">Aguardando a expedição conferir a separação.</span>
          )}
        </section>
      )}

      <Avisos ok={avisos.ok} erro={avisos.erro} />

      {podeCancelar && (
        <details className="painel cancelar-pedido">
          <summary><b className="perigo-texto">Cancelar pedido</b> <span className="pequeno suave">o cliente desistiu ou o pedido foi feito errado</span></summary>
          <form action={cancelarPedido} className="campos" style={{ marginTop: 10 }}>
            <input type="hidden" name="pedido_id" value={p.id} />
            <label className="largo">Motivo (fica no histórico do pedido)<input name="motivo" required maxLength={300} placeholder="Ex.: cliente desistiu da compra" /></label>
            {["enviado", "aguardando_retirada", "entregue"].includes(p.status_comercial) && (
              <div className="aviso-caixa aviso pequeno largo">O pedido já saiu: ao cancelar, a mercadoria volta ao estoque como devolução.</div>
            )}
            {d.pagamentos.some((g) => g.status_conferencia !== "recusado") && (
              <div className="aviso-caixa aviso pequeno largo">Este pedido tem pagamento registrado: combine a devolução do dinheiro com o cliente.</div>
            )}
            <label className="largo" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="confirmo" required style={{ width: "auto" }} /> Confirmo que quero cancelar este pedido
            </label>
            <button className="perigo">Cancelar pedido</button>
          </form>
        </details>
      )}

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
          <h2>Pedido feito pelo cliente no site</h2>
          <p className="suave">Confira e ajuste os itens abaixo com o cliente (quantidades, tirar ou acrescentar). Depois mande para a separação, sem precisar do gerente. O pedido vai para a expedição separar
            {d.itens.some((i) => i.origem && i.origem !== d.itens[0]?.origem) ? " e a transferência do CD para a loja já fica preparada" : ""}.</p>
          <form action={decidirPedidoPortal} className="campos">
            <input type="hidden" name="pedido_id" value={p.id} />
            <label>Motivo (se recusar, o cliente vê)<input name="motivo" /></label>
            <div className="linha">
              <button className="principal" name="decisao" value="aprovar">Mandar para separação</button>
              <button className="perigo" name="decisao" value="recusar">Recusar</button>
            </div>
          </form>
        </section>
      )}


      <section className="painel" id="itens">
        <div className="linha entre">
          <h2>Itens do pedido <span className="suave pequeno">({d.itens.length || itensBling.length})</span></h2>
          {trocar && <span className="pequeno suave">Falou com o cliente? Use <b>⇄ Trocar</b> para mudar o produto ou a fragrância.</span>}
        </div>
        {separar && (
          <div id="separar" className="aviso-caixa info linha entre">
            <span>Separação: confira na prateleira, confirme a quantidade de cada item e o total de caixas.</span>
            <Link className="botao principal" href={`/estoque/separacao/${p.id}`}>Separar este pedido</Link>
          </div>
        )}
        {d.itens.length > 0 ? (
          <ItensPedido pedidoId={p.id} itens={itensVista} total={dinheiro(p.valor_total, moeda)} separar={false} trocar={trocar} editar={editar}
            soDiminuir={false} separado={Boolean(fluxo?.separacao_conferida_em)}
            produtos={d.produtos.map((x) => `${x.codigo} · ${x.nome}`)} />
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


      {(d.trocas.length > 0 || d.remocoes.some((r) => r.status !== "pendente")) && (
        <section className="painel">
          <h2>Trocas e remoções</h2>
          <ul className="pequeno">
            {d.trocas.map((t) => (
              <li key={t.id}>{dataHora(t.feito_em)} · {t.nome ?? "—"} trocou <b>{Number(t.quantidade_antes)}× {t.descricao_antes}</b> por{" "}
                <b>{Number(t.quantidade)}× {t.descricao_depois}</b> ({dinheiro(t.preco_depois, moeda)} cada)
                {t.observacao && <> · {t.observacao}</>}{t.tem_print && <> · <a href={`/trocas/${t.id}`} target="_blank" rel="noopener noreferrer">ver print</a></>}</li>
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
      {p.origem !== "bling" && ["aguardando_cliente", "aguardando_aprovacao", "em_separacao", "enviado", "aguardando_retirada"].includes(p.status_comercial) && (
        <section className="painel" id="entrega" style={{ borderColor: "var(--ok)" }}>
          <h2>Entrega</h2>
          <div className="etapas-entrega pequeno">
            {(fluxo?.entrega_tipo === "retira" ? ["Separado", "Pronto para retirar", "Retirado"] : ["Separado", "Saiu (passeiro)", ...(cliente?.pais === "PY" ? ["Enviado pela transportadora"] : []), "Cliente recebeu"]).map((e, k) => {
              const atual = p.status_comercial === "em_separacao" ? (fluxo?.separacao_conferida_em ? 0 : -1)
                : p.status_comercial === "aguardando_retirada" ? 1
                : p.status_comercial === "enviado" ? (cliente?.pais === "PY" && fluxo?.entrega_tipo === "envio" && fluxo?.envio_confirmado_em ? 2 : 1) : 99;
              return <span key={e} className={k <= atual ? "feita" : ""}>{e}</span>;
            })}
          </div>
          {fluxo?.entrega_tipo ? (
            <p style={{ margin: 0 }}>
              <b>{fluxo.entrega_tipo === "envio" ? `Envio · ${fluxo.entrega_meio}` : `Retira: ${fluxo.entrega_meio}`}</b>
              {fluxo.entrega_dados && <span className="pequeno" style={{ whiteSpace: "pre-line", display: "block" }}>{fluxo.entrega_dados}</span>}
              <span className="pequeno suave">informado por {fluxo.entrega_definida_nome ?? "—"} em {dataHora(fluxo.entrega_definida_em)}</span>
            </p>
          ) : <p className="suave" style={{ margin: 0 }}>Ainda não informado se é envio ou retirada.</p>}

          {escrever && ["aguardando_cliente", "aguardando_aprovacao", "em_separacao"].includes(p.status_comercial) && cliente && (
            fluxo?.entrega_tipo ? (
              <details><summary className="pequeno">Alterar a entrega</summary>
                <FormEntrega pedidoId={p.id} pais={cliente.pais} atual={{ tipo: fluxo.entrega_tipo, meio: fluxo.entrega_meio, dados: fluxo.entrega_dados }} />
              </details>
            ) : <FormEntrega pedidoId={p.id} pais={cliente.pais} atual={{ tipo: null, meio: null, dados: null }} />
          )}

          {p.status_comercial === "em_separacao" && fluxo?.separacao_conferida_em && (
            <p className="pequeno" style={{ margin: 0 }}>{fluxo?.entrega_tipo
              ? "Aparece para o estoquista em \"Envio de pedidos\": ele dá o ✓ quando o passeiro levar (ou quando ficar pronto para retirar)."
              : "Informe a entrega acima para o estoquista despachar."}
              {Number(p.saldo) > 0 && <> <b>Atenção:</b> ainda há saldo a pagar de {dinheiro(p.saldo, moeda)}.</>}</p>
          )}
          {gestao && p.status_comercial === "em_separacao" && fluxo?.separacao_conferida_em && (
            <form action={avancarEntrega} className="linha">
              <input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="etapa" value="transporte" />
              <button className="discreto pequeno">Gerência: marcar como despachado</button>
            </form>
          )}
          {fluxo?.despachado_em && <p className="pequeno suave" style={{ margin: 0 }}>Saiu em {dataHora(fluxo.despachado_em)} ({fluxo.despachado_nome ?? "estoquista"}).</p>}

          {p.status_comercial === "enviado" && (
            cliente?.pais === "PY" && fluxo?.entrega_tipo === "envio" && !fluxo?.envio_confirmado_em ? (
              <div className="aviso-caixa aviso pequeno">Na loja CDE: aguardando a Yessica despachar pela transportadora e confirmar. Depois disso você finaliza.</div>
            ) : (
              <>
                {fluxo?.envio_confirmado_em && <p className="pequeno" style={{ margin: 0 }}>Enviado pela transportadora em {dataHora(fluxo.envio_confirmado_em)} ({fluxo.envio_confirmado_nome ?? "CDE"}){fluxo.envio_guia ? ` · ${fluxo.envio_guia}` : ""}.</p>}
                {escrever && (
                  <form action={avancarEntrega} className="linha">
                    <input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="etapa" value="entregue" />
                    <button className="principal">✓ Cliente recebeu: finalizar</button>
                  </form>
                )}
              </>
            )
          )}
          {p.status_comercial === "aguardando_retirada" && (
            <>
              <p style={{ margin: 0 }}>Pronto para retirar em <b>{fluxo?.local_retirada}</b>{fluxo?.chegou_em ? ` desde ${dataHora(fluxo.chegou_em)}` : ""}.</p>
              {(() => {
                const z = cliente ? linkWhatsApp(cliente.whatsapp ?? cliente.telefone,
                  `Olá ${cliente.nome}! Aqui é a ${p.vendedora_nome}, da Virtual Cosméticos. Seu pedido${p.bling_numero ? " nº " + p.bling_numero : ""} já está disponível para retirada em ${fluxo?.local_retirada}.`) : null;
                return z ? <a className="botao whatsapp" href={z} target="_blank" rel="noopener noreferrer">Avisar o cliente pelo WhatsApp</a> : null;
              })()}
              {escrever && (
                <form action={avancarEntrega}>
                  <input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="etapa" value="entregue" />
                  <button className="principal">✓ Cliente retirou: finalizar</button>
                </form>
              )}
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

      {p.status_comercial !== "cancelado" && (
        <section className="painel pagamento-caixa" id="pagamentos"
          style={{ borderColor: Number(p.saldo) <= 0 ? "var(--ok)" : pendentes.length ? "#e0b04a" : "var(--marca)" }}>
          <div className="linha entre">
            <h2 style={{ margin: 0 }}>Pagamento</h2>
            <span className="linha pequeno">
              <span>Total <b className="num">{dinheiro(p.valor_total, moeda)}</b></span>
              <span>Recebido <b className="num">{dinheiro(p.recebido, moeda)}</b></span>
              <span>{Number(p.saldo) > 0 ? <>Falta <b className="num" style={{ color: "var(--erro)" }}>{dinheiro(p.saldo, moeda)}</b></> : <Selo cor="ok">Pago</Selo>}</span>
              {p.vencimento && Number(p.saldo) > 0 && <span className="suave">vence {data(p.vencimento)}</span>}
            </span>
          </div>

          {pendentes.map((g) => (
            <div key={g.id} className="pag-pendente">
              <div>
                <b className="num">{dinheiro(g.valor, moeda)}</b> · {MODALIDADES[g.modalidade]}{g.banco ? ` · ${g.banco}` : ""} · {data(g.data)}
                <div className="pequeno suave">Informado por {g.registrado_nome ?? "—"}{g.observacao ? ` · ${g.observacao}` : ""}{" · "}
                  {d.comprovantes.filter((c) => c.pagamento_id === g.id).map((c) => (
                    <a key={c.id} href={`/comprovantes/${c.id}`} target="_blank" rel="noopener noreferrer">📎 ver comprovante </a>
                  ))}
                  {d.comprovantes.every((c) => c.pagamento_id !== g.id) && "sem comprovante"}
                </div>
              </div>
              {gestao ? (
                <div className="linha">
                  <form action={conferirPagamento}>
                    <input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="pagamento_id" value={g.id} />
                    <input type="hidden" name="bling_numero" value={p.bling_numero ?? ""} />
                    <button className="principal" title="Confirmar que o dinheiro caiu">✓ Pago</button>
                  </form>
                  <details className="recusar">
                    <summary className="botao">Não caiu</summary>
                    <form action={recusarPagamento} className="linha" style={{ marginTop: 6 }}>
                      <input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="pagamento_id" value={g.id} />
                      <input name="motivo" required placeholder="Motivo (a vendedora vê)" />
                      <button className="perigo">Recusar</button>
                    </form>
                  </details>
                </div>
              ) : (
                <span className="selo aviso">aguardando o gerente confirmar</span>
              )}
              {escrever && (
                <form action={anexarComprovante} className="linha pequeno">
                  <input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="pagamento_id" value={g.id} />
                  <input type="file" name="comprovante" accept="image/*,application/pdf" style={{ maxWidth: 240 }} />
                  <button>Anexar comprovante</button>
                </form>
              )}
            </div>
          ))}

          {escrever && Number(p.saldo) - Number(p.a_conferir) > 0 && (
            <details open={pendentes.length === 0 && Boolean(fluxo?.total_confirmado_em || ehBling)}>
              <summary className="botao">+ Cliente pagou: registrar pagamento e anexar comprovante</summary>
              <form action={registrarPagamento} className="campos" style={{ marginTop: 10 }}>
                <input type="hidden" name="pedido_id" value={p.id} />
                <label>Valor ({moeda === "GS" ? "Gs" : "R$"})<input name="valor" inputMode="decimal" required
                  defaultValue={String(Number(p.saldo) - Number(p.a_conferir)).replace(".", ",")} /></label>
                <label>Data<input name="data" type="date" required defaultValue={hojeISO()} /></label>
                <label>Como pagou
                  <select name="modalidade" defaultValue="transferencia">
                    {Object.entries(MODALIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label>Banco / conta<input name="banco" placeholder="Ex.: Continental, Ueno" /></label>
                <label className="largo">Comprovante (foto ou PDF)<input name="comprovante" type="file" accept="image/*,application/pdf" /></label>
                <label className="largo">Observação<input name="observacao" /></label>
                <button className="principal">Registrar pagamento</button>
              </form>
              <p className="pequeno suave">{gestao ? "Depois de registrar, é só clicar em Confirmar pago." : "O gerente confirma quando o dinheiro cair; até lá o pedido aparece como \"Confirmar pagamento\"."}</p>
            </details>
          )}

          {resolvidos.length > 0 && (
            <ul className="lista-simples pequeno">
              {resolvidos.map((g) => (
                <li key={g.id}>
                  <Selo cor={g.status_conferencia === "conferido" ? "ok" : "erro"}>{CONFERENCIA[g.status_conferencia]}</Selo>{" "}
                  <b className="num">{dinheiro(g.valor, moeda)}</b> · {MODALIDADES[g.modalidade]} · {data(g.data)}
                  <span className="suave"> · {g.status_conferencia === "conferido"
                    ? `confirmado por ${g.conferido_nome ?? "—"} em ${dataHora(g.conferido_em)}`
                    : `recusado por ${g.conferido_nome ?? "—"}: ${g.motivo_recusa}`}</span>
                  {d.comprovantes.filter((c) => c.pagamento_id === g.id).map((c) => (
                    <span key={c.id}> · <a href={`/comprovantes/${c.id}`} target="_blank" rel="noopener noreferrer">📎 comprovante</a></span>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <details className="painel mais-detalhes">
        <summary><b>Mais detalhes</b> <span className="pequeno suave">dados comerciais, volumes, atendimento, histórico</span></summary>
      <div className="duas-colunas" style={{ marginTop: 12 }}>
        <div className="coluna">
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
      </details>
    </>
  );
}
