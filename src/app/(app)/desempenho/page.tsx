import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, dataHora, dinheiro, hojeISO, type Moeda } from "@/lib/formato";
import { contatoLegivel } from "@/lib/whatsapp";
import { Avisos, Barra, Selo } from "../avisos";
import { atribuirConversa } from "../whatsapp/acoes";
import { FiltroCalendario } from "../whatsapp/filtro-calendario";

export const metadata = { title: "Desempenho das vendedoras" };

type Conv = {
  conexao_id: string; contato: string; vendedora_id: string | null; atribuicao: string | null; cliente_id: string | null; cliente_novo: boolean;
  contato_novo: boolean; enviadas: number; recebidas: number; chamadas_nossas: number; chamadas_cliente: number; quem_iniciou: boolean | null;
  respondeu: boolean; sem_resposta: boolean; espera_atual_min: string | null; tempos: string[]; pedidos: number; valor: string; moeda: Moeda;
  primeira_msg: string; ultima_msg: string; nome: string | null; conexao: string;
};
type Ativ = { vendedora_id: string | null; dia: string; primeira: string; ultima: string; enviadas: number };
type Hora = { vendedora_id: string | null; hora: number; enviadas: number; recebidas: number };
type Carteira = { vendedora_id: string; clientes: number };

const PERIODOS: Record<string, { t: string; dias: number }> = {
  hoje: { t: "Hoje", dias: 0 }, "7": { t: "7 dias", dias: 6 }, "30": { t: "30 dias", dias: 29 }, "90": { t: "90 dias", dias: 89 },
};
const ORDENS: Record<string, string> = {
  valor: "Maior valor vendido", fechamento: "Maior % de fechamento", resposta: "Resposta mais rápida", ativo: "Mais contatos puxados",
  conversas: "Mais conversas", espera: "Mais clientes esperando", nome: "Nome (A–Z)",
};

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
const fmtPct = (v: number | null) => (v === null ? "—" : `${v}%`);
const mediana = (l: number[]) => {
  if (!l.length) return null;
  const s = [...l].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const minutos = (m: number | null | undefined) => {
  if (m === null || m === undefined || !Number.isFinite(m)) return "—";
  if (m < 1) return "< 1 min";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
  return `${Math.round(m / 60)} h`;
};
const hora = (h: string | null) => (h ? h.slice(0, 5) : "—");

type Resumo = {
  id: string; nome: string; conversas: number; novos: number; enviadas: number; recebidas: number;
  ativo: number; ativoConv: number; ativoRetorno: number; receptivo: number; receptivoConv: number;
  tempos: number[]; esperando: number; maiorEspera: number | null; comPedido: number; comPedidoAtivo: number; comPedidoReceptivo: number;
  pedidos: number; valores: Record<string, number>; leads: number; leadsCadastrados: number; leadsComPedido: number;
  dias: number; mediaPrimeira: string | null; mediaUltima: string | null; carteira: number; carteiraContatada: number;
};

function resumir(id: string, nome: string, cs: Conv[], ativ: Ativ[], carteira: number): Resumo {
  const tempos = cs.flatMap((c) => c.tempos.map(Number));
  const ativo = cs.filter((c) => c.quem_iniciou === true), receptivo = cs.filter((c) => c.quem_iniciou === false);
  const leads = cs.filter((c) => c.contato_novo && (!c.cliente_id || c.cliente_novo));
  const valores: Record<string, number> = {};
  cs.forEach((c) => { if (Number(c.valor) > 0) valores[c.moeda] = (valores[c.moeda] ?? 0) + Number(c.valor); });
  const media = (l: string[]) => {
    if (!l.length) return null;
    const m = l.map((h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))).reduce((a, b) => a + b, 0) / l.length;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
  };
  const esperas = cs.filter((c) => c.sem_resposta).map((c) => Number(c.espera_atual_min ?? 0));
  return {
    id, nome, conversas: cs.length, novos: cs.filter((c) => c.contato_novo).length,
    enviadas: cs.reduce((s, c) => s + c.enviadas, 0), recebidas: cs.reduce((s, c) => s + c.recebidas, 0),
    ativo: cs.reduce((s, c) => s + c.chamadas_nossas, 0), ativoConv: ativo.length, ativoRetorno: ativo.filter((c) => c.respondeu).length,
    receptivo: cs.reduce((s, c) => s + c.chamadas_cliente, 0), receptivoConv: receptivo.length,
    tempos, esperando: esperas.length, maiorEspera: esperas.length ? Math.max(...esperas) : null,
    comPedido: cs.filter((c) => c.pedidos > 0).length, comPedidoAtivo: ativo.filter((c) => c.pedidos > 0).length,
    comPedidoReceptivo: receptivo.filter((c) => c.pedidos > 0).length, pedidos: cs.reduce((s, c) => s + c.pedidos, 0), valores,
    leads: leads.length, leadsCadastrados: leads.filter((c) => c.cliente_id).length, leadsComPedido: leads.filter((c) => c.pedidos > 0).length,
    dias: ativ.length, mediaPrimeira: media(ativ.map((a) => a.primeira)), mediaUltima: media(ativ.map((a) => a.ultima)),
    carteira, carteiraContatada: new Set(cs.filter((c) => c.cliente_id && c.atribuicao === "cliente").map((c) => c.cliente_id)).size,
  };
}

export default async function Desempenho({ searchParams }: {
  searchParams: Promise<{ p?: string; de?: string; ate?: string; v?: string; w?: string; o?: string; ok?: string; erro?: string }>;
}) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const valida = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const per = valida(f.de) || valida(f.ate) ? "custom" : f.p && PERIODOS[f.p] ? f.p : "7";
  const de = per === "custom" ? valida(f.de) ?? hojeISO(-6) : hojeISO(-PERIODOS[per].dias);
  const ate = per === "custom" ? valida(f.ate) ?? hojeISO() : hojeISO();
  const ordem = f.o && ORDENS[f.o] ? f.o : "valor";

  const r = await comUsuario(u.id, async (c) => {
    const conexoes = (await c.query("select id, nome from app.whatsapp_conexoes where ativo order by nome")).rows as { id: string; nome: string }[];
    const w = f.w && conexoes.some((x) => x.id === f.w) ? f.w : null;
    const vendedoras = (await c.query("select id, nome from app.vendedoras where ativo and nome <> 'Marketplace' order by nome")).rows as { id: string; nome: string }[];
    const convs = (await c.query(`
      select cv.*, coalesce(cl.nome, k.nome) as nome, wc.nome as conexao
        from app.whatsapp_conversas($1::date, $2::date) cv
        join app.whatsapp_contatos k on k.conexao_id = cv.conexao_id and k.contato = cv.contato
        join app.whatsapp_conexoes wc on wc.id = cv.conexao_id
        left join app.clientes cl on cl.id = cv.cliente_id
       where ($3::uuid is null or cv.conexao_id = $3)`, [de, ate, w])).rows as Conv[];
    // Atividade: mensagens enviadas por dia (primeira e última) e por hora, por vendedora responsável da conversa
    const msgs = `
      with cv as (select conexao_id, contato, vendedora_id from app.whatsapp_conversas($1::date, $2::date) where ($3::uuid is null or conexao_id = $3)),
      per as (select ($1::date)::timestamp at time zone 'America/Asuncion' as ini, ($2::date + 1)::timestamp at time zone 'America/Asuncion' as fim),
      mm as (select cv.vendedora_id, m.enviada, m.em at time zone 'America/Asuncion' as loc
               from app.whatsapp_mensagens m join cv using (conexao_id, contato), per where m.em >= per.ini and m.em < per.fim)`;
    const ativ = (await c.query(`${msgs}
      select vendedora_id, to_char(loc::date, 'YYYY-MM-DD') as dia, to_char(min(loc), 'HH24:MI') as primeira, to_char(max(loc), 'HH24:MI') as ultima,
             count(*)::int as enviadas
        from mm where enviada group by 1, 2 order by 2`, [de, ate, w])).rows as Ativ[];
    const horas = (await c.query(`${msgs}
      select vendedora_id, extract(hour from loc)::int as hora, count(*) filter (where enviada)::int as enviadas, count(*) filter (where not enviada)::int as recebidas
        from mm group by 1, 2`, [de, ate, w])).rows as Hora[];
    const carteira = (await c.query("select vendedora_id, count(*)::int as clientes from app.clientes where ativo and mesclado_em is null group by 1")).rows as Carteira[];
    return { conexoes, vendedoras, convs, ativ, horas, carteira };
  });
  const { conexoes, vendedoras, convs, ativ, horas, carteira } = r;

  const nomeV = new Map(vendedoras.map((v) => [v.id, v.nome]));
  const ids = [...new Set(convs.map((c) => c.vendedora_id ?? ""))];
  const resumos = ids.map((id) => resumir(id, id ? nomeV.get(id) ?? "Vendedora inativa" : "Sem vendedora (leads a assumir)",
    convs.filter((c) => (c.vendedora_id ?? "") === id), ativ.filter((a) => (a.vendedora_id ?? "") === id),
    id ? carteira.find((x) => x.vendedora_id === id)?.clientes ?? 0 : 0));
  const valorTotal = (x: Resumo) => Object.values(x.valores).reduce((a, b) => a + b, 0);
  resumos.sort((a, b) => {
    if (!a.id !== !b.id) return a.id ? -1 : 1; // "sem vendedora" sempre no fim
    if (ordem === "fechamento") return (pct(b.comPedido, b.conversas) ?? -1) - (pct(a.comPedido, a.conversas) ?? -1);
    if (ordem === "resposta") return (mediana(a.tempos) ?? 1e9) - (mediana(b.tempos) ?? 1e9);
    if (ordem === "ativo") return b.ativo - a.ativo;
    if (ordem === "conversas") return b.conversas - a.conversas;
    if (ordem === "espera") return b.esperando - a.esperando;
    if (ordem === "nome") return a.nome.localeCompare(b.nome);
    return valorTotal(b) - valorTotal(a);
  });
  const sel = f.v !== undefined ? resumos.find((x) => x.id === f.v) : resumos.find((x) => x.id) ?? resumos[0];
  const selConvs = sel ? convs.filter((c) => (c.vendedora_id ?? "") === sel.id) : [];
  const selHoras = sel ? horas.filter((h) => (h.vendedora_id ?? "") === sel.id) : [];
  const maxHora = Math.max(1, ...selHoras.map((h) => h.enviadas + h.recebidas));
  const semDono = convs.filter((c) => !c.vendedora_id).sort((a, b) => new Date(b.ultima_msg).getTime() - new Date(a.ultima_msg).getTime());
  const valoresTxt = (v: Record<string, number>) => Object.entries(v).map(([m, x]) => dinheiro(x, m as Moeda)).join(" + ") || "—";

  const url = (p: Record<string, string | undefined>) => {
    const s = new URLSearchParams();
    Object.entries({ p: per === "custom" ? undefined : per, de: per === "custom" ? de : undefined, ate: per === "custom" ? ate : undefined,
      v: f.v, w: f.w, o: ordem === "valor" ? undefined : ordem, ...p }).forEach(([k, v]) => { if (v !== undefined && v !== null) s.set(k, v); });
    return `/desempenho?${s}`;
  };
  const volta = url({});

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Desempenho das vendedoras</h1>
          <p>Tudo o que dá para medir pelo WhatsApp de cada número: atendimento, quem puxou o contato, tempo de resposta, fechamento e o que virou venda.
            Tempo de resposta conta só o horário comercial (ajustável em Parâmetros).</p>
        </div>
        <Link className="botao" href="/whatsapp">Ver conversas</Link>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <FiltroCalendario caminho="/desempenho" de={de} ate={ate} manter={{ w: f.w, v: f.v, o: ordem === "valor" ? undefined : ordem }} />
      {conexoes.length > 1 && (
        <nav className="filtros" aria-label="Número">
          <span className="pequeno suave" style={{ alignSelf: "center" }}>Número:</span>
          <a href={url({ w: undefined })} className={!f.w ? "ativo" : ""}>Todos</a>
          {conexoes.map((w) => <a key={w.id} href={url({ w: w.id })} className={f.w === w.id ? "ativo" : ""}>{w.nome}</a>)}
        </nav>
      )}
      <form className="painel filtros" method="get">
        {f.v !== undefined && <input type="hidden" name="v" value={f.v} />}
        {f.w && <input type="hidden" name="w" value={f.w} />}
        <input type="hidden" name="de" value={de} /><input type="hidden" name="ate" value={ate} />
        <label>Ordenar ranking por<select name="o" defaultValue={ordem}>{Object.entries(ORDENS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <div className="filtro-botoes"><button className="principal">Filtrar</button><a className="botao" href="/desempenho">Limpar</a></div>
      </form>

      {conexoes.length === 0 ? (
        <section className="painel vazio">Nenhum número de WhatsApp conectado. <Link href="/whatsapp/conexoes">Conectar →</Link></section>
      ) : convs.length === 0 ? (
        <section className="painel vazio">Nenhuma conversa de {data(de)} a {data(ate)}.</section>
      ) : (
        <>
          <section className="painel">
            <h2>Ranking · {data(de)} a {data(ate)}</h2>
            <div className="tabela"><table>
              <thead><tr>
                <th>Vendedora</th><th>Conversas</th><th>Env. / Rec.</th><th>Ela chamou</th><th>Retorno das chamadas</th><th>Cliente chamou</th>
                <th>Tempo de resposta</th><th>Esperando</th><th>Fechamento</th><th>Vendido</th><th>Leads → cliente</th>
              </tr></thead>
              <tbody>{resumos.map((x) => (
                <tr key={x.id || "sem"} style={sel?.id === x.id ? { background: "var(--marca-suave)" } : undefined}>
                  <td><Link href={url({ v: x.id })}>{x.nome}</Link></td>
                  <td className="num">{x.conversas}<div className="pequeno suave">{x.novos} novos</div></td>
                  <td className="num">{x.enviadas} / {x.recebidas}</td>
                  <td className="num">{x.ativo}</td>
                  <td className="num">{fmtPct(pct(x.ativoRetorno, x.ativoConv))}</td>
                  <td className="num">{x.receptivo}</td>
                  <td className="num">{minutos(mediana(x.tempos))}</td>
                  <td className="num">{x.esperando ? <Selo cor="aviso">{x.esperando}</Selo> : 0}</td>
                  <td className="num">{fmtPct(pct(x.comPedido, x.conversas))}<div className="pequeno suave">{x.comPedido} de {x.conversas}</div></td>
                  <td className="num">{valoresTxt(x.valores)}</td>
                  <td className="num">{x.leads ? `${x.leadsCadastrados} de ${x.leads}` : "—"}</td>
                </tr>))}
              </tbody>
            </table></div>
            <p className="pequeno suave" style={{ margin: 0 }}>Toque no nome para ver o detalhe. Fechamento = conversas que tiveram pedido a partir do dia da conversa.
              Retorno = das conversas que ela puxou, quantas o cliente respondeu.</p>
          </section>

          {sel && (
            <>
              <section className="painel">
                <h2 style={{ marginTop: 0 }}>{sel.nome}</h2>
                <div className="indicadores">
                  <div className="indicador"><span className="rotulo">Conversas</span><span className="valor">{sel.conversas}</span>
                    <span className="pequeno suave">{sel.novos} contato(s) novo(s)</span></div>
                  <div className="indicador"><span className="rotulo">Mensagens</span><span className="valor">{sel.enviadas} env · {sel.recebidas} rec</span>
                    <span className="pequeno suave">{sel.dias ? `${Math.round(sel.enviadas / sel.dias)} enviadas por dia trabalhado` : "—"}</span></div>
                  <div className="indicador"><span className="rotulo">Ela chamou (ativo)</span><span className="valor">{sel.ativo}</span>
                    <span className="pequeno suave">{fmtPct(pct(sel.ativoRetorno, sel.ativoConv))} responderam · {fmtPct(pct(sel.comPedidoAtivo, sel.ativoConv))} compraram</span></div>
                  <div className="indicador"><span className="rotulo">Cliente chamou (receptivo)</span><span className="valor">{sel.receptivo}</span>
                    <span className="pequeno suave">{fmtPct(pct(sel.comPedidoReceptivo, sel.receptivoConv))} compraram</span></div>
                  <div className="indicador"><span className="rotulo">Tempo de resposta</span><span className="valor">{minutos(mediana(sel.tempos))}</span>
                    <span className="pequeno suave">Mediana em horário comercial · {sel.tempos.length} resposta(s)</span></div>
                  <div className="indicador"><span className="rotulo">Esperando resposta</span><span className="valor">{sel.esperando}</span>
                    <span className="pequeno suave">{sel.maiorEspera !== null ? `Mais antigo: ${minutos(sel.maiorEspera)}` : "Ninguém esperando"}</span></div>
                  <div className="indicador"><span className="rotulo">Fechamento</span><span className="valor">{fmtPct(pct(sel.comPedido, sel.conversas))}</span>
                    <span className="pequeno suave">{sel.comPedido} conversa(s) com pedido · {sel.pedidos} pedido(s)</span></div>
                  <div className="indicador"><span className="rotulo">Vendido pelas conversas</span><span className="valor">{valoresTxt(sel.valores)}</span>
                    <span className="pequeno suave">Ticket médio: {Object.entries(sel.valores).map(([m, x]) => dinheiro(x / Math.max(1, sel.pedidos), m as Moeda)).join(" + ") || "—"}</span></div>
                  <div className="indicador"><span className="rotulo">Leads novos</span><span className="valor">{sel.leads}</span>
                    <span className="pequeno suave">{sel.leadsCadastrados} cadastrado(s) · {sel.leadsComPedido} com pedido</span></div>
                  {sel.id && <div className="indicador"><span className="rotulo">Carteira contatada</span>
                    <span className="valor">{fmtPct(pct(sel.carteiraContatada, sel.carteira))}</span>
                    <span className="pequeno suave">{sel.carteiraContatada} de {sel.carteira} clientes dela</span></div>}
                  <div className="indicador"><span className="rotulo">Horário de trabalho</span><span className="valor">{hora(sel.mediaPrimeira)} – {hora(sel.mediaUltima)}</span>
                    <span className="pequeno suave">Média da 1ª e última mensagem enviada · {sel.dias} dia(s)</span></div>
                </div>
              </section>

              <section className="painel">
                <h2>Respostas</h2>
                {sel.tempos.length === 0 ? <p className="suave">Sem respostas no período.</p> : (
                  <div className="grafico-barras">
                    {([["Até 5 min", 0, 5], ["5 a 30 min", 5, 30], ["30 min a 2 h", 30, 120], ["Mais de 2 h", 120, Infinity]] as [string, number, number][]).map(([t, a, b]) => {
                      const n = sel.tempos.filter((x) => x >= a && x < b).length;
                      return (<div key={t} className="lin"><span>{t}</span><Barra percentual={(n / sel.tempos.length) * 100} ok={a === 0} />
                        <span className="num pequeno">{n} · {fmtPct(pct(n, sel.tempos.length))}</span></div>);
                    })}
                  </div>
                )}
              </section>

              <section className="painel">
                <h2>Movimento por hora</h2>
                <div className="grafico-barras">{selHoras.sort((a, b) => a.hora - b.hora).map((h) => (
                  <div key={h.hora} className="lin"><span>{String(h.hora).padStart(2, "0")}h</span>
                    <Barra percentual={((h.enviadas + h.recebidas) / maxHora) * 100} />
                    <span className="num pequeno">{h.enviadas} env · {h.recebidas} rec</span></div>))}
                </div>
              </section>

              <section className="painel">
                <h2>Dias trabalhados</h2>
                <div className="tabela"><table style={{ minWidth: 0 }}>
                  <thead><tr><th>Dia</th><th>Primeira mensagem</th><th>Última mensagem</th><th>Enviadas</th></tr></thead>
                  <tbody>{ativ.filter((a) => (a.vendedora_id ?? "") === sel.id).map((a) => (
                    <tr key={a.dia}><td>{data(a.dia)}</td><td className="num">{a.primeira}</td><td className="num">{a.ultima}</td><td className="num">{a.enviadas}</td></tr>))}
                  </tbody>
                </table></div>
              </section>

              <section className="painel">
                <h2>Conversas de {sel.nome}: {selConvs.length}</h2>
                <div className="tabela"><table>
                  <thead><tr><th>Contato</th><th>Quem chamou</th><th>Env. / Rec.</th><th>Situação</th><th>Pedidos</th><th>Última mensagem</th></tr></thead>
                  <tbody>{[...selConvs].sort((a, b) => Number(b.sem_resposta) - Number(a.sem_resposta) || new Date(b.ultima_msg).getTime() - new Date(a.ultima_msg).getTime())
                    .slice(0, 300).map((c) => (
                    <tr key={c.conexao_id + c.contato}>
                      <td><Link href={`/whatsapp/conversa?w=${c.conexao_id}&c=${encodeURIComponent(c.contato)}`}>{c.nome ?? contatoLegivel(c.contato)}</Link>
                        <div className="pequeno suave">{contatoLegivel(c.contato)}{conexoes.length > 1 ? ` · ${c.conexao}` : ""}</div>
                        {c.cliente_id ? <Selo cor="ok">{c.cliente_novo ? "Cadastrado agora" : "Cliente"}</Selo> : <Selo cor="info">Lead</Selo>}</td>
                      <td>{c.quem_iniciou === true ? "Ela" : c.quem_iniciou === false ? "Cliente" : "—"}</td>
                      <td className="num">{c.enviadas} / {c.recebidas}</td>
                      <td>{c.sem_resposta ? <Selo cor="aviso">Esperando {minutos(Number(c.espera_atual_min))}</Selo>
                        : c.quem_iniciou === true && !c.respondeu ? <Selo>Sem retorno do cliente</Selo> : <Selo cor="ok">Respondida</Selo>}</td>
                      <td className="num">{c.pedidos ? <>{dinheiro(c.valor, c.moeda)}<div className="pequeno suave">{c.pedidos} pedido(s)</div></> : "—"}</td>
                      <td className="pequeno">{dataHora(c.ultima_msg)}</td>
                    </tr>))}
                  </tbody>
                </table></div>
              </section>
            </>
          )}

          {semDono.length > 0 && (
            <section className="painel">
              <h2>Leads sem vendedora: {semDono.length}</h2>
              <p className="pequeno suave">Conversas de número compartilhado com contato que ainda não é cliente. Escolha quem atende para entrar no desempenho dela.</p>
              <div className="tabela"><table>
                <thead><tr><th>Contato</th><th>Número</th><th>Quem chamou</th><th>Situação</th><th>Responsável</th></tr></thead>
                <tbody>{semDono.slice(0, 200).map((c) => (
                  <tr key={c.conexao_id + c.contato}>
                    <td><Link href={`/whatsapp/conversa?w=${c.conexao_id}&c=${encodeURIComponent(c.contato)}`}>{c.nome ?? contatoLegivel(c.contato)}</Link>
                      <div className="pequeno suave">{contatoLegivel(c.contato)} · {dataHora(c.ultima_msg)}</div></td>
                    <td className="pequeno">{c.conexao}</td>
                    <td>{c.quem_iniciou === true ? "Vendedora" : "Cliente"}</td>
                    <td>{c.sem_resposta ? <Selo cor="aviso">Esperando {minutos(Number(c.espera_atual_min))}</Selo> : <Selo cor="ok">Respondida</Selo>}</td>
                    <td>
                      <form action={atribuirConversa} className="linha" style={{ gap: 6 }}>
                        <input type="hidden" name="conexao_id" value={c.conexao_id} /><input type="hidden" name="contato" value={c.contato} />
                        <input type="hidden" name="volta" value={volta} />
                        <select name="vendedora_id" defaultValue="" required>
                          <option value="" disabled>Escolher…</option>{vendedoras.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
                        </select>
                        <button>Atribuir</button>
                      </form>
                    </td>
                  </tr>))}
                </tbody>
              </table></div>
            </section>
          )}
        </>
      )}
    </>
  );
}
