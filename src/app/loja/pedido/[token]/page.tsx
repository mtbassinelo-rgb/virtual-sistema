import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { pool, mensagemErro } from "@/lib/db";
import { dinheiro, data, linkWhatsApp, type Moeda } from "@/lib/formato";
import { idiomaAtual } from "@/lib/idioma";

export const metadata = { title: "Confirmar pedido", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const T = {
  pt: {
    titulo: "Confirme o seu pedido", de: (v: string) => `Pedido montado pela sua vendedora ${v}.`,
    instr: "Confira os produtos e informe quantas caixas quer de cada um. Para tirar um produto, deixe 0. Depois toque em Confirmar pedido.",
    produto: "Produto", caixas: "Caixas", pecas: "Peças", preco: "Preço un.", total: "Total", caixaCom: (n: number) => `caixa com ${n}`,
    obs: "Observação para a vendedora (opcional)", confirmar: "Confirmar pedido", valido: (d: string) => `Link válido até ${d}.`,
    totalAtual: "Total atual", falar: "Falar com a vendedora",
    ok: "Pedido confirmado! A vendedora já recebeu e vai separar os produtos. O valor final chega para você pelo WhatsApp.",
    confirmado: "Este pedido já foi confirmado. Qualquer mudança, fale com a sua vendedora.",
    expirado: "Este link expirou. Peça um novo link para a sua vendedora.",
    substituido: "Este link foi trocado por um mais novo. Use o último link que a vendedora enviou.",
    fechado: "Este pedido não está mais aguardando confirmação.",
    invalido: "Link inválido. Peça um novo link para a sua vendedora.",
  },
  es: {
    titulo: "Confirme su pedido", de: (v: string) => `Pedido preparado por su vendedora ${v}.`,
    instr: "Revise los productos e indique cuántas cajas quiere de cada uno. Para quitar un producto, deje 0. Después toque Confirmar pedido.",
    produto: "Producto", caixas: "Cajas", pecas: "Piezas", preco: "Precio un.", total: "Total", caixaCom: (n: number) => `caja con ${n}`,
    obs: "Observación para la vendedora (opcional)", confirmar: "Confirmar pedido", valido: (d: string) => `Link válido hasta ${d}.`,
    totalAtual: "Total actual", falar: "Hablar con la vendedora",
    ok: "¡Pedido confirmado! La vendedora ya lo recibió y va a separar los productos. El valor final le llega por WhatsApp.",
    confirmado: "Este pedido ya fue confirmado. Para cualquier cambio, hable con su vendedora.",
    expirado: "Este link venció. Pida un nuevo link a su vendedora.",
    substituido: "Este link fue reemplazado por uno más nuevo. Use el último link que envió la vendedora.",
    fechado: "Este pedido ya no está esperando confirmación.",
    invalido: "Link inválido. Pida un nuevo link a su vendedora.",
  },
};

type Item = { item_id: string; codigo: string | null; descricao: string; quantidade: string; preco: string; total: string; unidades_caixa: number | null };

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const tokenValido = (t: string) => /^[A-Za-z0-9_-]{20,100}$/.test(t);

async function confirmar(fd: FormData) {
  "use server";
  const token = String(fd.get("token") ?? "");
  if (!tokenValido(token)) redirect("/loja");
  let erro: string | null = null;
  try {
    const linha = (await pool.query("select itens from app.link_pedido($1)", [hashToken(token)])).rows[0];
    const itens = ((linha?.itens ?? []) as Item[]).map((i) => {
      const por = i.unidades_caixa && i.unidades_caixa > 1 ? i.unidades_caixa : 1;
      const cx = Number(String(fd.get(`cx_${i.item_id}`) ?? "").replace(",", "."));
      const un = Number(String(fd.get(`un_${i.item_id}`) ?? "").replace(",", "."));
      const q = por > 1 ? (Number.isFinite(cx) ? Math.max(cx, 0) : 0) * por + (Number.isFinite(un) ? Math.max(un, 0) : 0)
                        : (Number.isFinite(un) ? Math.max(un, 0) : Number(i.quantidade));
      return { item_id: i.item_id, quantidade: Math.round(q) };
    });
    await pool.query("select app.confirmar_link_pedido($1, $2::jsonb, $3)",
      [hashToken(token), JSON.stringify(itens), String(fd.get("obs") ?? "").slice(0, 500)]);
  } catch (e) {
    erro = mensagemErro(e);
  }
  redirect(`/loja/pedido/${token}?${erro ? "erro=" + encodeURIComponent(erro) : "ok=1"}`);
}

export default async function ConfirmarPedido({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const { token } = await params;
  const f = await searchParams;
  const idioma = await idiomaAtual();
  const t = T[idioma];
  const p = tokenValido(token) ? (await pool.query("select * from app.link_pedido($1)", [hashToken(token)])).rows[0] : null;

  if (!p) return <div className="in pagina"><section className="painel area-cli link-pedido"><h1>{t.titulo}</h1><p className="aviso-erro" role="alert">{t.invalido}</p></section></div>;
  const moeda = p.moeda as Moeda;
  const whats = linkWhatsApp(p.vendedora_whatsapp, `${t.titulo}: ${dinheiro(p.valor_total, moeda)}`);
  const msgSituacao: Record<string, string> = { confirmado: t.confirmado, expirado: t.expirado, substituido: t.substituido, fechado: t.fechado };

  return (
    <div className="in pagina"><section className="painel area-cli link-pedido">
      <h1>{t.titulo}</h1>
      <p>{p.cliente} · {data(p.data_pedido)} · {t.de(p.vendedora)}</p>
      {f.ok && <p className="aviso-ok">{t.ok}</p>}
      {f.erro && <p className="aviso-erro" role="alert">{f.erro}</p>}
      {p.situacao !== "aberto" && !f.ok && <p className="aviso-erro">{msgSituacao[p.situacao] ?? t.fechado}</p>}

      {p.situacao === "aberto" ? (
        <form action={confirmar}>
          <input type="hidden" name="token" value={token} />
          <p className="pequeno">{t.instr}</p>
          <div className="tabela"><table>
            <thead><tr><th>{t.produto}</th><th>{t.caixas}</th><th>{t.pecas}</th><th>{t.preco}</th></tr></thead>
            <tbody>{(p.itens as Item[]).map((i) => {
              const por = i.unidades_caixa && i.unidades_caixa > 1 ? i.unidades_caixa : 0;
              const q = Number(i.quantidade);
              return (
                <tr key={i.item_id}>
                  <td>{i.descricao}<div className="pequeno suave">{i.codigo}{por ? ` · ${t.caixaCom(por)}` : ""}</div></td>
                  <td>{por ? <input name={`cx_${i.item_id}`} type="number" min={0} step={1} defaultValue={Math.floor(q / por)} style={{ width: 70 }} aria-label={t.caixas} /> : "—"}</td>
                  <td><input name={`un_${i.item_id}`} type="number" min={0} step={1} defaultValue={por ? q % por : q} style={{ width: 80 }} aria-label={t.pecas} /></td>
                  <td className="num">{dinheiro(i.preco, moeda)}</td>
                </tr>);
            })}</tbody>
          </table></div>
          <p><b>{t.totalAtual}: {dinheiro(p.valor_total, moeda)}</b></p>
          <label style={{ display: "block" }}>{t.obs}<textarea name="obs" maxLength={500} rows={2} style={{ width: "100%" }} /></label>
          <p className="linha"><button className="adicionar">{t.confirmar}</button>
            {whats && <a className="botao-zap" href={whats} target="_blank" rel="noopener noreferrer">{t.falar}</a>}</p>
          {p.expira_em && <p className="pequeno suave">{t.valido(data(p.expira_em))}</p>}
        </form>
      ) : (
        <>
          <div className="tabela"><table>
            <thead><tr><th>{t.produto}</th><th>{t.pecas}</th><th>{t.total}</th></tr></thead>
            <tbody>{(p.itens as Item[]).map((i) => (
              <tr key={i.item_id}><td>{i.descricao}</td><td className="num">{Number(i.quantidade).toLocaleString("pt-BR")}</td><td className="num">{dinheiro(i.total, moeda)}</td></tr>
            ))}</tbody>
          </table></div>
          <p><b>{t.total}: {dinheiro(p.valor_total, moeda)}</b></p>
          {whats && <p><a className="botao-zap" href={whats} target="_blank" rel="noopener noreferrer">{t.falar}</a></p>}
        </>
      )}
    </section></div>
  );
}
