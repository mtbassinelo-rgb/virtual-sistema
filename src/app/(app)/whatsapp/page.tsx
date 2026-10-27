import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, dataHora, dinheiro, hojeISO, type Moeda } from "@/lib/formato";
import { pode } from "@/lib/permissoes";
import { contatoLegivel, resumoMsg } from "@/lib/whatsapp";
import { Selo } from "../avisos";
import { AtualizarSozinho } from "./atualizar-sozinho";
import { FiltroCalendario } from "./filtro-calendario";

export const metadata = { title: "WhatsApp" };

type Conv = {
  conexao_id: string; contato: string; enviadas: number; recebidas: number; contato_nome: string | null; primeira_em: string;
  conexao: string; pais: string; ultima_enviada: boolean; ultimo_tipo: string; ultimo_texto: string | null; ultima_em: string;
  cliente_id: string | null; cliente: string | null; moeda: Moeda; vendedora_cliente: string | null;
  pedidos: number; valor: string; ultima_compra: string | null;
  quem_iniciou: boolean | null; chamadas_nossas: number; chamadas_cliente: number;
};
type Tempo = { conexao_id: string | null; mediana_min: number | null; respondidas: number };
type Dia = { dia: string; enviadas: number; recebidas: number };
type Conexao = { id: string; nome: string; estado: string; pais: string };

const PERIODOS: Record<string, { t: string; dias: number }> = {
  hoje: { t: "Hoje", dias: 0 }, "7": { t: "7 dias", dias: 6 }, "30": { t: "30 dias", dias: 29 }, "90": { t: "90 dias", dias: 89 },
};
const FILTROS: Record<string, string> = {
  todas: "Todas", aguardando: "Esperando resposta", ativo: "Vendedora chamou (ativo)", receptivo: "Cliente chamou (receptivo)",
  sem_retorno: "Vendedora chamou e não teve retorno", clientes: "Clientes", leads: "Não cadastrados (leads)", com_pedido: "Com pedido no período", novos: "Contatos novos",
};
const ORDENS: Record<string, string> = {
  recente: "Mais recente", espera: "Esperando há mais tempo", msgs: "Mais mensagens", valor: "Maior valor em pedidos", nome: "Nome (A–Z)",
};

const minutos = (m: number | null | undefined) => {
  if (m === null || m === undefined || !Number.isFinite(m)) return "—";
  if (m < 1) return "< 1 min";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
  return `${Math.round(m / 1440)} dia(s)`;
};

export default async function WhatsApp({ searchParams }: {
  searchParams: Promise<{ p?: string; de?: string; ate?: string; w?: string; f?: string; o?: string; q?: string }>;
}) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const gestao = ehGestao(u);
  const valida = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const per = valida(f.de) || valida(f.ate) ? "custom" : f.p && PERIODOS[f.p] ? f.p : "7";
  const de = per === "custom" ? valida(f.de) ?? hojeISO(-6) : hojeISO(-PERIODOS[per].dias);
  const ate = per === "custom" ? valida(f.ate) ?? hojeISO() : hojeISO();
  const filtro = f.f && FILTROS[f.f] ? f.f : "todas";
  const ordem = f.o && ORDENS[f.o] ? f.o : "recente";
  const busca = (f.q ?? "").trim().toLowerCase();

  const { conexoes, convs, tempos, dias } = await comUsuario(u.id, async (c) => {
    const conexoes = (await c.query("select id, nome, estado, pais from app.whatsapp_conexoes where ativo order by nome")).rows as Conexao[];
    const w = f.w && conexoes.some((x) => x.id === f.w) ? f.w : null;
    const conds = [de, ate, w];
    const periodo = `per as (select ($1::date)::timestamp at time zone 'America/Asuncion' as ini, ($2::date + 1)::timestamp at time zone 'America/Asuncion' as fim)`;

    const convs = (await c.query(`
      with ${periodo},
      conv as materialized (
        select m.conexao_id, m.contato, count(*) filter (where m.enviada)::int as enviadas, count(*) filter (where not m.enviada)::int as recebidas
          from app.whatsapp_mensagens m, per
         where m.em >= per.ini and m.em < per.fim and ($3::uuid is null or m.conexao_id = $3)
         group by 1, 2),
      cham as materialized (
        select x.conexao_id, x.contato, x.enviada, x.em
          from (select y.conexao_id, y.contato, y.enviada, y.em, lag(y.em) over (partition by y.conexao_id, y.contato order by y.em) as ant
                  from app.whatsapp_mensagens y join conv using (conexao_id, contato), per
                 where y.em >= per.ini - interval '7 days' and y.em < per.fim) x, per
         where (x.ant is null or x.em - x.ant > interval '12 hours') and x.em < per.fim),
      quem as materialized (
        select ch.conexao_id, ch.contato, (array_agg(ch.enviada order by ch.em desc))[1] as quem_iniciou,
               count(*) filter (where ch.enviada and ch.em >= per.ini)::int as chamadas_nossas,
               count(*) filter (where not ch.enviada and ch.em >= per.ini)::int as chamadas_cliente
          from cham ch, per group by 1, 2),
      ult as materialized (
        select conv.conexao_id, conv.contato, l.enviada, l.tipo, l.texto, l.em
          from conv cross join lateral (select m.enviada, m.tipo, m.texto, m.em from app.whatsapp_mensagens m
                                         where m.conexao_id = conv.conexao_id and m.contato = conv.contato
                                         order by m.em desc limit 1) l)
      select conv.*, k.nome as contato_nome, k.primeira_em, w.nome as conexao, w.pais,
             u.enviada as ultima_enviada, u.tipo as ultimo_tipo, u.texto as ultimo_texto, u.em as ultima_em,
             cli.id as cliente_id, cli.nome as cliente, coalesce(cli.moeda, case when w.pais = 'PY' then 'GS' else 'BRL' end::app.moeda) as moeda,
             q.quem_iniciou, coalesce(q.chamadas_nossas, 0) as chamadas_nossas, coalesce(q.chamadas_cliente, 0) as chamadas_cliente,
             vd.nome as vendedora_cliente, coalesce(ped.pedidos, 0) as pedidos, coalesce(ped.valor, 0) as valor, ped.ultima_compra
        from conv
        join app.whatsapp_contatos k using (conexao_id, contato)
        join app.whatsapp_conexoes w on w.id = conv.conexao_id
        join ult u using (conexao_id, contato)
        left join quem q using (conexao_id, contato)
        left join lateral (
          select c.id, c.nome, c.moeda, c.vendedora_id from app.clientes c
           where conv.contato not like 'lid:%' and c.mesclado_em is null
             and (app.zap8(c.whatsapp) = app.zap8(conv.contato) or app.zap8(c.telefone) = app.zap8(conv.contato))
           order by c.ativo desc, c.criado_em limit 1) cli on true
        left join app.vendedoras vd on vd.id = cli.vendedora_id
        left join lateral (
          select count(*) filter (where p.data_pedido between $1::date and $2::date)::int as pedidos,
                 coalesce(sum(p.valor_total) filter (where p.data_pedido between $1::date and $2::date), 0) as valor,
                 max(p.data_pedido) as ultima_compra
            from app.pedidos p
           where p.cliente_id = cli.id and p.status_comercial <> 'cancelado'
             and p.moeda = coalesce(cli.moeda, case when w.pais = 'PY' then 'GS' else 'BRL' end::app.moeda)) ped on true`, conds)).rows as Conv[];

    // Tempo de resposta: do primeiro "oi" do cliente (depois de uma resposta nossa ou no começo da conversa) até a nossa resposta
    const tempos = (await c.query(`
      with ${periodo},
      m as (
        select x.conexao_id, x.contato, x.enviada, x.em, lag(x.enviada) over (partition by x.conexao_id, x.contato order by x.em) as ant
          from app.whatsapp_mensagens x, per
         where x.em >= per.ini - interval '3 days' and x.em < per.fim and ($3::uuid is null or x.conexao_id = $3)),
      ini as (select m.* from m, per where not m.enviada and m.ant is distinct from false and m.em >= per.ini),
      resp as (
        select i.conexao_id, extract(epoch from (
                 select min(y.em) from app.whatsapp_mensagens y
                  where y.conexao_id = i.conexao_id and y.contato = i.contato and y.enviada and y.em > i.em) - i.em) / 60 as espera
          from ini i)
      select conexao_id, percentile_cont(0.5) within group (order by espera) filter (where espera is not null) as mediana_min,
             count(espera)::int as respondidas
        from resp group by rollup (conexao_id)`, conds)).rows as Tempo[];

    const dias = (await c.query(`
      with ${periodo}
      select to_char((m.em at time zone 'America/Asuncion')::date, 'YYYY-MM-DD') as dia,
             count(*) filter (where m.enviada)::int as enviadas, count(*) filter (where not m.enviada)::int as recebidas
        from app.whatsapp_mensagens m, per
       where m.em >= per.ini and m.em < per.fim and ($3::uuid is null or m.conexao_id = $3)
       group by 1 order by 1`, conds)).rows as Dia[];
    return { conexoes, convs, tempos, dias };
  });

  const agora = Date.now();
  const esperaMin = (c: Conv) => (c.ultima_enviada ? 0 : (agora - new Date(c.ultima_em).getTime()) / 60000);
  const inicioPeriodo = new Date(`${de}T00:00:00-03:00`).getTime();
  const semRetorno = (c: Conv) => c.quem_iniciou === true && c.recebidas === 0;
  const somaN = (l: Conv[], k: "chamadas_nossas" | "chamadas_cliente") => l.reduce((s, c) => s + c[k], 0);
  const ehNovo = (c: Conv) => new Date(c.primeira_em).getTime() >= inicioPeriodo;

  const lista = convs
    .filter((c) => filtro === "todas" || (filtro === "aguardando" && !c.ultima_enviada)
      || (filtro === "ativo" && c.quem_iniciou === true) || (filtro === "receptivo" && c.quem_iniciou === false) || (filtro === "sem_retorno" && semRetorno(c)) || (filtro === "clientes" && c.cliente_id)
      || (filtro === "leads" && !c.cliente_id) || (filtro === "com_pedido" && c.pedidos > 0) || (filtro === "novos" && ehNovo(c)))
    .filter((c) => !busca || [c.cliente, c.contato_nome, c.contato, c.ultimo_texto].some((t) => (t ?? "").toLowerCase().includes(busca)))
    .sort((a, b) => {
      if (ordem === "espera") return esperaMin(b) - esperaMin(a);
      if (ordem === "msgs") return b.enviadas + b.recebidas - (a.enviadas + a.recebidas);
      if (ordem === "valor") return Number(b.valor) - Number(a.valor);
      if (ordem === "nome") return (a.cliente ?? a.contato_nome ?? "~").localeCompare(b.cliente ?? b.contato_nome ?? "~");
      return new Date(b.ultima_em).getTime() - new Date(a.ultima_em).getTime();
    });

  const soma = (l: Conv[], k: "enviadas" | "recebidas") => l.reduce((s, c) => s + c[k], 0);
  const valorPor = (l: Conv[]) => {
    const r: Record<string, number> = {};
    l.forEach((c) => { if (Number(c.valor) > 0) r[c.moeda] = (r[c.moeda] ?? 0) + Number(c.valor); });
    return Object.entries(r);
  };
  const geral = tempos.find((t) => t.conexao_id === null);
  const aguardando = convs.filter((c) => !c.ultima_enviada);
  const valores = valorPor(convs);
  const maxDia = Math.max(1, ...dias.map((d) => d.enviadas + d.recebidas));

  const url = (p: Record<string, string | undefined>) => {
    const s = new URLSearchParams();
    Object.entries({ p: per === "custom" ? undefined : per, de: per === "custom" ? de : undefined, ate: per === "custom" ? ate : undefined,
      w: f.w, f: filtro === "todas" ? undefined : filtro, o: ordem === "recente" ? undefined : ordem, q: f.q, ...p })
      .forEach(([k, v]) => { if (v) s.set(k, v); });
    return `/whatsapp?${s}`;
  };

  return (
    <>
      <AtualizarSozinho segundos={60} />
      <section className="cabecalho-pagina">
        <div>
          <h1>WhatsApp</h1>
          <p>Mensagens enviadas e recebidas, tempo de resposta, quem está esperando e quanto cada conversa virou em pedidos.
            {gestao ? " A conversa é casada com o cliente pelo número cadastrado." : ""}</p>
        </div>
        <div className="linha" style={{ gap: 6 }}>
          <a className="botao" href={`/whatsapp/exportar?de=${de}&ate=${ate}${f.w ? `&w=${f.w}` : ""}`} title="Todas as mensagens do período escolhido, uma por linha (abre no Excel)">
            Baixar conversas ({data(de)} a {data(ate)})</a>
          {pode(u, "whatsapp_conexoes") && <Link className="botao" href="/whatsapp/conexoes">Conexões (QR Code)</Link>}
        </div>
      </section>

      {conexoes.length === 0 ? (
        <section className="painel vazio">
          Nenhum número conectado ainda.{" "}
          {pode(u, "whatsapp_conexoes") ? <Link href="/whatsapp/conexoes">Conectar o primeiro número →</Link> : "Peça ao gerente para conectar."}
        </section>
      ) : (
        <>
          <FiltroCalendario caminho="/whatsapp" de={de} ate={ate} manter={{ w: f.w, f: filtro === "todas" ? undefined : filtro, o: ordem === "recente" ? undefined : ordem, q: f.q }} />
          {conexoes.length > 1 && (
            <nav className="filtros" aria-label="Número">
              <span className="pequeno suave" style={{ alignSelf: "center" }}>Número:</span>
              <a href={url({ w: undefined })} className={!f.w ? "ativo" : ""}>Todos</a>
              {conexoes.map((w) => <a key={w.id} href={url({ w: w.id })} className={f.w === w.id ? "ativo" : ""}>{w.nome}</a>)}
            </nav>
          )}
          {conexoes.filter((w) => w.estado !== "conectado").map((w) => (
            <div key={w.id} className="aviso-caixa erro" role="alert">
              {w.nome}: desconectado. As mensagens deste número não estão chegando.{" "}
              {pode(u, "whatsapp_conexoes") && <Link href="/whatsapp/conexoes">Reconectar</Link>}
            </div>
          ))}

          <section className="indicadores">
            <div className="indicador"><span className="rotulo">Enviadas</span><span className="valor">{soma(convs, "enviadas").toLocaleString("pt-BR")}</span>
              <span className="pequeno suave">{data(de)} a {data(ate)}</span></div>
            <div className="indicador"><span className="rotulo">Recebidas</span><span className="valor">{soma(convs, "recebidas").toLocaleString("pt-BR")}</span></div>
            <div className="indicador"><span className="rotulo">Conversas</span><span className="valor">{convs.length}</span>
              <span className="pequeno suave">{convs.filter(ehNovo).length} contato(s) novo(s)</span></div>
            <a className="indicador" href={url({ f: "ativo" })} style={{ textDecoration: "none", color: "inherit" }}>
              <span className="rotulo">Vendedora chamou</span><span className="valor">{somaN(convs, "chamadas_nossas")}</span>
              <span className="pequeno suave">Contatos puxados por ela · {convs.filter(semRetorno).length} sem retorno</span></a>
            <a className="indicador" href={url({ f: "receptivo" })} style={{ textDecoration: "none", color: "inherit" }}>
              <span className="rotulo">Cliente chamou</span><span className="valor">{somaN(convs, "chamadas_cliente")}</span>
              <span className="pequeno suave">Contatos que chegaram sozinhos</span></a>
            <a className="indicador" href={url({ f: "aguardando", o: "espera" })} style={{ textDecoration: "none", color: "inherit" }}>
              <span className="rotulo">Esperando resposta</span><span className="valor">{aguardando.length}</span>
              <span className="pequeno suave">Última mensagem foi do cliente</span></a>
            <div className="indicador"><span className="rotulo">Tempo de resposta</span><span className="valor">{minutos(geral?.mediana_min)}</span>
              <span className="pequeno suave">Mediana · {geral?.respondidas ?? 0} resposta(s)</span></div>
            <a className="indicador" href={url({ f: "com_pedido", o: "valor" })} style={{ textDecoration: "none", color: "inherit" }}>
              <span className="rotulo">Movimento em pedidos</span>
              <span className="valor">{valores.length ? valores.map(([m, v]) => dinheiro(v, m as Moeda)).join(" + ") : "—"}</span>
              <span className="pequeno suave">{convs.filter((c) => c.pedidos > 0).length} conversa(s) com pedido · {convs.filter((c) => c.cliente_id).length} cliente(s), {convs.filter((c) => !c.cliente_id).length} lead(s)</span></a>
          </section>

          {conexoes.length > 1 && !f.w && (
            <section className="painel">
              <h2>Por número</h2>
              <div className="tabela"><table style={{ minWidth: 0 }}>
                <thead><tr><th>Número</th><th>Enviadas</th><th>Recebidas</th><th>Conversas</th><th>Ela chamou</th><th>Cliente chamou</th><th>Esperando</th><th>Tempo de resposta</th><th>Pedidos</th></tr></thead>
                <tbody>{conexoes.map((w) => {
                  const l = convs.filter((c) => c.conexao_id === w.id);
                  const t = tempos.find((x) => x.conexao_id === w.id);
                  return (
                    <tr key={w.id}><td><Link href={url({ w: w.id })}>{w.nome}</Link></td>
                      <td className="num">{soma(l, "enviadas")}</td><td className="num">{soma(l, "recebidas")}</td><td className="num">{l.length}</td>
                      <td className="num">{somaN(l, "chamadas_nossas")}</td><td className="num">{somaN(l, "chamadas_cliente")}</td>
                      <td className="num">{l.filter((c) => !c.ultima_enviada).length}</td><td className="num">{minutos(t?.mediana_min)}</td>
                      <td className="num">{valorPor(l).map(([m, v]) => dinheiro(v, m as Moeda)).join(" + ") || "—"}</td></tr>);
                })}</tbody>
              </table></div>
            </section>
          )}

          {dias.length > 1 && (
            <section className="painel">
              <h2>Mensagens por dia</h2>
              <div className="grafico-barras">{dias.map((d) => (
                <div key={d.dia} className="lin">
                  <span>{data(d.dia)}</span>
                  <div className="barra"><span style={{ width: `${((d.enviadas + d.recebidas) / maxDia) * 100}%` }} /></div>
                  <span className="num pequeno">{d.enviadas} env · {d.recebidas} rec</span>
                </div>))}
              </div>
            </section>
          )}

          <form className="painel filtros" method="get">
            <input type="hidden" name="de" value={de} /><input type="hidden" name="ate" value={ate} />
            {f.w && <input type="hidden" name="w" value={f.w} />}
            <label className="filtro-busca">Buscar (nome, número ou mensagem)<input name="q" defaultValue={f.q ?? ""} /></label>
            <label>Mostrar<select name="f" defaultValue={filtro}>{Object.entries(FILTROS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Ordenar por<select name="o" defaultValue={ordem}>{Object.entries(ORDENS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <div className="filtro-botoes"><button className="principal">Filtrar</button><a className="botao" href="/whatsapp">Limpar</a></div>
          </form>

          <section className="painel">
            <div className="linha entre">
              <h2>{FILTROS[filtro]}: {lista.length}</h2>
              <span className="pequeno suave">Atualiza sozinho a cada minuto</span>
            </div>
            {lista.length === 0 ? <div className="vazio">Nenhuma conversa neste período e filtro.</div> : (
              <div className="tabela"><table>
                <thead><tr><th>Contato</th>{conexoes.length > 1 && <th>Número</th>}<th>Última mensagem</th><th>Env.</th><th>Rec.</th><th>Pedidos no período</th><th>Última compra</th></tr></thead>
                <tbody>{lista.slice(0, 300).map((c) => {
                  const espera = esperaMin(c);
                  const link = `/whatsapp/conversa?w=${c.conexao_id}&c=${encodeURIComponent(c.contato)}`;
                  return (
                    <tr key={c.conexao_id + c.contato}>
                      <td>
                        <Link href={link}>{c.cliente ?? c.contato_nome ?? contatoLegivel(c.contato)}</Link>
                        <div className="pequeno suave">{contatoLegivel(c.contato)}{c.cliente && c.contato_nome && c.contato_nome !== c.cliente ? ` · "${c.contato_nome}"` : ""}</div>
                        {c.cliente_id ? <Selo cor="ok">Cliente{gestao && c.vendedora_cliente ? ` · ${c.vendedora_cliente}` : ""}</Selo> : <Selo cor="info">Lead</Selo>}{" "}
                        {ehNovo(c) && <Selo cor="marca">Novo</Selo>}{" "}
                        {c.quem_iniciou === true && <Selo cor={semRetorno(c) ? "aviso" : undefined}>{semRetorno(c) ? "Ela chamou · sem retorno" : "Ela chamou"}</Selo>}
                        {c.quem_iniciou === false && <Selo>Cliente chamou</Selo>}
                      </td>
                      {conexoes.length > 1 && <td className="pequeno">{c.conexao}</td>}
                      <td style={{ whiteSpace: "normal", minWidth: 220, maxWidth: 360 }}>
                        <div className="pequeno">{c.ultima_enviada ? "Nós: " : ""}{resumoMsg(c.ultimo_tipo, c.ultimo_texto).slice(0, 140)}</div>
                        <div className="pequeno suave">{dataHora(c.ultima_em)}{" "}
                          {!c.ultima_enviada && <Selo cor={espera > 240 ? "erro" : "aviso"}>esperando {minutos(espera)}</Selo>}</div>
                      </td>
                      <td className="num">{c.enviadas}</td>
                      <td className="num">{c.recebidas}</td>
                      <td className="num">{c.pedidos ? <>{dinheiro(c.valor, c.moeda)}<div className="pequeno suave">{c.pedidos} pedido(s)</div></> : "—"}</td>
                      <td className="pequeno">{c.ultima_compra ? data(c.ultima_compra) : c.cliente_id ? "nunca" : "—"}</td>
                    </tr>);
                })}</tbody>
              </table></div>
            )}
            <p className="pequeno suave" style={{ margin: 0 }}>Tempo de resposta = mediana entre a primeira mensagem do cliente e a nossa resposta (no período).
              Pedidos no período = pedidos do cliente (sem cancelados) com data dentro do período. Leads são números que ainda não estão no cadastro de clientes.
              Quem chamou = quem mandou a primeira mensagem depois de 12 h ou mais sem conversa (vendedora = ativo, cliente = receptivo).</p>
          </section>
        </>
      )}
    </>
  );
}
