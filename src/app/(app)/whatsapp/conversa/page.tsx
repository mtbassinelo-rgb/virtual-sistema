import Link from "next/link";
import { notFound } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, dataHora, dinheiro, STATUS_COMERCIAL, type Moeda } from "@/lib/formato";
import { contatoLegivel, TIPO_MSG } from "@/lib/whatsapp";
import { Avisos, Selo } from "../../avisos";
import { atribuirConversa } from "../acoes";
import { AtualizarSozinho } from "../atualizar-sozinho";

export const metadata = { title: "Conversa do WhatsApp" };

type Msg = { id: string; enviada: boolean; tipo: string; texto: string | null; em: string };
type Cli = { id: string; nome: string; moeda: Moeda | null; categoria_preco: string; vendedora: string; cidade: string | null };
type Ped = { id: string; data_pedido: string; valor_total: string; moeda: Moeda; status_comercial: string; bling_numero: string | null };

export default async function Conversa({ searchParams }: { searchParams: Promise<{ w?: string; c?: string; tudo?: string; ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  if (!f.w || !/^[0-9a-f-]{36}$/i.test(f.w) || !f.c) notFound();
  const limite = f.tudo ? 5000 : 300;

  const r = await comUsuario(u.id, async (c) => {
    const k = (await c.query(`
      select k.contato, k.nome, k.primeira_em, k.vendedora_id as assumida_por, w.nome as conexao, w.pais from app.whatsapp_contatos k join app.whatsapp_conexoes w on w.id = k.conexao_id
       where k.conexao_id = $1 and k.contato = $2`, [f.w, f.c])).rows[0] as { contato: string; nome: string | null; primeira_em: string; conexao: string; pais: string; assumida_por: string | null } | undefined;
    if (!k) return null;
    const msgs = ((await c.query(`select id::text, enviada, tipo, texto, em from app.whatsapp_mensagens
       where conexao_id = $1 and contato = $2 order by em desc limit $3`, [f.w, f.c, limite])).rows as Msg[]).reverse();
    const total = Number((await c.query("select count(*) as n from app.whatsapp_mensagens where conexao_id = $1 and contato = $2", [f.w, f.c])).rows[0].n);
    const cli = f.c!.startsWith("lid:") ? undefined : (await c.query(`
      select c.id, c.nome, c.moeda, c.categoria_preco, v.nome as vendedora, c.cidade from app.clientes c join app.vendedoras v on v.id = c.vendedora_id
       where c.mesclado_em is null and (app.zap8(c.whatsapp) = app.zap8($1) or app.zap8(c.telefone) = app.zap8($1))
       order by c.ativo desc, c.criado_em limit 1`, [f.c])).rows[0] as Cli | undefined;
    const pedidos = cli ? (await c.query(`select id, data_pedido, valor_total, moeda, status_comercial, bling_numero from app.pedidos
       where cliente_id = $1 and status_comercial <> 'cancelado' order by data_pedido desc, criado_em desc limit 10`, [cli.id])).rows as Ped[] : [];
    const tot = cli ? (await c.query(`select moeda, count(*)::int as n, sum(valor_total) as valor from app.pedidos
       where cliente_id = $1 and status_comercial <> 'cancelado' and data_pedido >= current_date - 365 group by moeda`, [cli.id])).rows as { moeda: Moeda; n: number; valor: string }[] : [];
    const vendedoras = (await c.query(`select v.id, v.nome from app.vendedoras v where v.ativo and v.nome <> 'Marketplace' order by v.nome`)).rows as { id: string; nome: string }[];
    const resp = (await c.query("select vendedora_id, atribuicao from app.whatsapp_responsavel($1, $2)",
      [f.w, f.c])).rows[0] as { vendedora_id: string | null; atribuicao: string | null } | undefined;
    return { k, msgs, total, cli, pedidos, tot, vendedoras, resp };
  });
  if (!r) notFound();
  const { k, msgs, total, cli, pedidos, tot, vendedoras, resp } = r;
  const gestao = ehGestao(u);
  const volta = `/whatsapp/conversa?w=${f.w}&c=${encodeURIComponent(f.c!)}`;
  const nomeResp = vendedoras.find((v) => v.id === resp?.vendedora_id)?.nome;
  const COMO: Record<string, string> = { assumida: "assumiu a conversa", cliente: "dona do cliente no cadastro", numero: "única vendedora do número" };
  const enviadas = msgs.filter((m) => m.enviada).length;

  let diaAnterior = "";
  return (
    <>
      <AtualizarSozinho segundos={30} />
      <section className="cabecalho-pagina">
        <div>
          <p className="pequeno"><Link href="/whatsapp">← WhatsApp</Link></p>
          <h1>{cli?.nome ?? k.nome ?? contatoLegivel(k.contato)}</h1>
          <p>{contatoLegivel(k.contato)}{k.nome && k.nome !== cli?.nome ? ` · se apresenta como "${k.nome}"` : ""} · {k.conexao} · primeiro contato em {data(k.primeira_em)}</p>
        </div>
      </section>

      <div className="conversa-grade">
        <section className="painel">
          <div className="linha entre">
            <h2 style={{ margin: 0 }}>Histórico</h2>
            <span className="pequeno suave">{total.toLocaleString("pt-BR")} mensagens · {enviadas} nossas e {msgs.length - enviadas} do contato {msgs.length < total ? `(últimas ${msgs.length})` : ""}</span>
          </div>
          {msgs.length < total && <p className="pequeno"><Link href={`/whatsapp/conversa?w=${f.w}&c=${encodeURIComponent(f.c!)}&tudo=1`}>Ver todas</Link></p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {msgs.map((m) => {
              const dLocal = new Date(m.em).toLocaleDateString("pt-BR", { timeZone: "America/Asuncion" });
              const mostrarDia = dLocal !== diaAnterior;
              diaAnterior = dLocal;
              return (
                <div key={m.id} style={{ display: "contents" }}>
                  {mostrarDia && <div className="pequeno suave" style={{ textAlign: "center", margin: "8px 0" }}>{dLocal}</div>}
                  <div style={{
                    alignSelf: m.enviada ? "flex-end" : "flex-start", maxWidth: "80%", padding: "6px 10px", borderRadius: 10,
                    background: m.enviada ? "var(--marca-suave)" : "var(--afundado)", whiteSpace: "pre-wrap", overflowWrap: "anywhere",
                  }}>
                    {m.tipo !== "texto" && <div className="pequeno suave">{TIPO_MSG[m.tipo] ?? "Mensagem"}</div>}
                    {m.texto && <div>{m.texto}</div>}
                    <div className="pequeno suave" style={{ textAlign: "right" }}>
                      {new Date(m.em).toLocaleTimeString("pt-BR", { timeZone: "America/Asuncion", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>);
            })}
          </div>
        </section>

        <aside className="painel">
          <Avisos ok={f.ok} erro={f.erro} />
          <h2 style={{ marginTop: 0 }}>Vendedora responsável</h2>
          <p className="pequeno">{nomeResp ? <><b>{nomeResp}</b> <span className="suave">({COMO[resp?.atribuicao ?? ""] ?? ""})</span></> : <Selo cor="aviso">Sem vendedora</Selo>}</p>
          {gestao ? (
            <form action={atribuirConversa} className="linha" style={{ gap: 6, marginBottom: 16 }}>
              <input type="hidden" name="conexao_id" value={f.w} /><input type="hidden" name="contato" value={k.contato} /><input type="hidden" name="volta" value={volta} />
              <select name="vendedora_id" defaultValue={k.assumida_por ?? ""}>
                <option value="">Automático (cadastro do cliente)</option>{vendedoras.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
              <button>Salvar</button>
            </form>
          ) : !resp?.vendedora_id && u.vendedora_id ? (
            <form action={atribuirConversa} style={{ marginBottom: 16 }}>
              <input type="hidden" name="conexao_id" value={f.w} /><input type="hidden" name="contato" value={k.contato} /><input type="hidden" name="volta" value={volta} />
              <input type="hidden" name="assumir" value="1" />
              <button className="principal">Assumir esta conversa</button>
            </form>
          ) : null}
          {cli ? (
            <>
              <h2 style={{ marginTop: 0 }}>Cliente</h2>
              <p><Link href={`/clientes/${cli.id}`}><b>{cli.nome}</b></Link><br />
                <span className="pequeno suave">{cli.vendedora} · {cli.categoria_preco === "vip" ? "VIP" : "Normal"}{cli.cidade ? ` · ${cli.cidade}` : ""}</span></p>
              {tot.map((t) => (
                <div key={t.moeda} className="indicador" style={{ marginBottom: 8 }}>
                  <span className="rotulo">Comprou nos últimos 12 meses</span>
                  <span className="valor">{dinheiro(t.valor, t.moeda)}</span>
                  <span className="pequeno suave">{t.n} pedido(s)</span>
                </div>))}
              <h3>Últimos pedidos</h3>
              {pedidos.length === 0 ? <p className="suave pequeno">Ainda não comprou.</p> : (
                <ul style={{ paddingLeft: 16, margin: 0 }}>
                  {pedidos.map((p) => (
                    <li key={p.id} className="pequeno" style={{ marginBottom: 4 }}>
                      <Link href={`/pedidos/${p.id}`}>{data(p.data_pedido)} · {dinheiro(p.valor_total, p.moeda)}</Link>{" "}
                      <span className="suave">{STATUS_COMERCIAL[p.status_comercial] ?? p.status_comercial}</span>
                    </li>))}
                </ul>
              )}
            </>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>Não cadastrado</h2>
              <p className="pequeno">Este número não está no cadastro de clientes{k.contato.startsWith("lid:") ? " (o WhatsApp escondeu o número deste contato)" : ""}.</p>
              <Selo cor="info">Lead</Selo>
              <p className="pequeno suave">Ao cadastrar o cliente com este WhatsApp, a conversa passa a aparecer ligada a ele, com os pedidos.</p>
              <Link className="botao" href="/clientes">Ir para Clientes</Link>
            </>
          )}
          <p className="pequeno suave" style={{ marginBottom: 0 }}>Atualizado {dataHora(new Date())}. Fotos e áudios aparecem só como tipo.</p>
        </aside>
      </div>
    </>
  );
}
