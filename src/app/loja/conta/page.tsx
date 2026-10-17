import Link from "next/link";
import { hash } from "@node-rs/argon2";
import { redirect } from "next/navigation";
import { pool, mensagemErro } from "@/lib/db";
import { dinheiro, data, linkWhatsApp, telefone, type Moeda } from "@/lib/formato";
import { idiomaAtual } from "@/lib/idioma";
import { conferirCliente, exigirCliente } from "@/lib/portal";
import { Acompanhamento, type PedidoAcomp } from "../acompanhamento";

export const metadata = { title: "Minha área" };

const T = {
  pt: {
    titulo: "Minha área", ola: (n: string) => `Olá, ${n}!`, doc: "Usuário (documento)", vendedora: "Sua vendedora", falar: "Falar no WhatsApp",
    total: "Total comprado", pedidos: "Pedidos", ultimo: "Última compra", saldo: "Saldo a pagar", meta: "Sua meta",
    metaTexto: (falta: string, fim: string, premio: string) => `Faltam ${falta} em compras até ${fim} para ganhar ${premio} em mercadorias.`,
    metaBatida: (premio: string) => `Meta batida! Você ganhou ${premio} em mercadorias.`,
    historico: "Histórico de compras", acompanhar: "Acompanhe seu pedido", verTodos: "Ver todos os pedidos e pagamentos", nenhum: "Você ainda não fez pedidos por aqui.",
    maisComprados: "O que você mais compra", comprarNovo: "Ver catálogo", troca: "Trocar senha", atual: "Senha atual",
    nova: "Nova senha (mínimo 6 caracteres)", repetir: "Repita a nova senha", salvar: "Trocar senha", ok: "Senha trocada. Use a nova senha da próxima vez.",
    curta: "A nova senha precisa ter pelo menos 6 caracteres.", diferente: "As duas senhas novas não são iguais.", atualErrada: "A senha atual não confere.",
    etapas: { aguardando_vendedora: "Aguardando a vendedora", em_separacao: "Em separação", aguardando_pagamento: "Aguardando pagamento",
              pago_preparando_envio: "Pago: preparando envio", enviado: "Em transporte", aguardando_retirada: "Aguardando retirada", entregue: "Retirado", cancelado: "Cancelado" } as Record<string, string>,
  },
  es: {
    titulo: "Mi área", ola: (n: string) => `¡Hola, ${n}!`, doc: "Usuario (documento)", vendedora: "Su vendedora", falar: "Hablar por WhatsApp",
    total: "Total comprado", pedidos: "Pedidos", ultimo: "Última compra", saldo: "Saldo a pagar", meta: "Su meta",
    metaTexto: (falta: string, fim: string, premio: string) => `Faltan ${falta} en compras hasta el ${fim} para ganar ${premio} en mercaderías.`,
    metaBatida: (premio: string) => `¡Meta cumplida! Ganó ${premio} en mercaderías.`,
    historico: "Historial de compras", acompanhar: "Siga su pedido", verTodos: "Ver todos los pedidos y pagos", nenhum: "Todavía no hizo pedidos por aquí.",
    maisComprados: "Lo que más compra", comprarNovo: "Ver catálogo", troca: "Cambiar contraseña", atual: "Contraseña actual",
    nova: "Nueva contraseña (mínimo 6 caracteres)", repetir: "Repita la nueva contraseña", salvar: "Cambiar contraseña", ok: "Contraseña cambiada. Use la nueva la próxima vez.",
    curta: "La nueva contraseña debe tener al menos 6 caracteres.", diferente: "Las dos contraseñas nuevas no son iguales.", atualErrada: "La contraseña actual no es correcta.",
    etapas: { aguardando_vendedora: "Esperando a la vendedora", em_separacao: "En preparación", aguardando_pagamento: "Esperando pago",
              pago_preparando_envio: "Pagado: preparando envío", enviado: "En transporte", aguardando_retirada: "Esperando retiro", entregue: "Retirado", cancelado: "Cancelado" } as Record<string, string>,
  },
};
const COR: Record<string, string> = { aguardando_retirada: "ok", aguardando_vendedora: "aviso", em_separacao: "info", aguardando_pagamento: "marca", pago_preparando_envio: "ok", enviado: "ok", entregue: "ok", cancelado: "" };

type Pedido = { id: string; data_pedido: string; bling_numero: string | null; valor_total: string; saldo: string; moeda: Moeda; etapa: string;
  total_confirmado: boolean; itens: { descricao: string; quantidade: number }[] } & PedidoAcomp;
type Meta = { fim: string; moeda: Moeda; valor_meta: string; valor_premio: string; vendido: string; falta: string; percentual: string; meta_batida: boolean };

async function trocar(fd: FormData) {
  "use server";
  const idioma = await idiomaAtual();
  const t = T[idioma];
  const { sessao } = await exigirCliente();
  const atual = String(fd.get("atual") ?? ""), nova = String(fd.get("nova") ?? ""), repetir = String(fd.get("repetir") ?? "");
  let q: string;
  try {
    if (nova.length < 6) throw new Error(t.curta);
    if (nova !== repetir) throw new Error(t.diferente);
    const doc = String((await pool.query("select app.portal_documento($1) as d", [sessao])).rows[0]?.d ?? "");
    const r = await conferirCliente(doc, atual, idioma === "es");
    if (!r.id) throw new Error(r.erro?.includes("15") ? r.erro : t.atualErrada);
    const senhaHash = await hash(nova, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await pool.query("select app.portal_trocar_senha($1, $2)", [sessao, senhaHash]);
    q = "ok=" + encodeURIComponent(t.ok);
  } catch (e) {
    q = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  redirect(`/loja/conta?${q}#senha`);
}

export default async function MinhaArea({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { cliente, sessao } = await exigirCliente();
  const f = await searchParams;
  const idioma = await idiomaAtual();
  const t = T[idioma];
  const [doc, pedidos, meta] = await Promise.all([
    pool.query("select app.portal_documento($1) as d", [sessao]).then((r) => String(r.rows[0]?.d ?? "")),
    pool.query("select * from app.portal_pedidos($1)", [sessao]).then((r) => r.rows as Pedido[]),
    pool.query("select * from app.portal_meta($1)", [sessao]).then((r) => (r.rows[0] as Meta | undefined) ?? null),
  ]);
  const moeda = cliente.moeda;
  const validos = pedidos.filter((p) => p.etapa !== "cancelado");
  const total = validos.reduce((s, p) => s + Number(p.valor_total), 0);
  const saldo = validos.filter((p) => p.total_confirmado).reduce((s, p) => s + Number(p.saldo), 0);
  const contagem = new Map<string, number>();
  for (const p of validos) for (const i of p.itens) {
    const nome = i.descricao.replace(/ ·.*$/, "").replace(/ \(promoção.*\)$/, "");
    contagem.set(nome, (contagem.get(nome) ?? 0) + Number(i.quantidade));
  }
  const top = [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const zap = linkWhatsApp(cliente.vendedora_whatsapp, `${idioma === "es" ? "¡Hola" : "Olá"}, ${cliente.vendedora}! ${idioma === "es" ? "Soy" : "Sou"} ${cliente.nome}.`);

  return (
    <div className="in pagina area-cli">
      <section className="area-topo">
        <div>
          <div className="suave pequeno">{t.titulo}</div>
          <h1>{t.ola(cliente.nome)}</h1>
          <div className="suave pequeno">{t.doc}: {doc}</div>
        </div>
        <div className="area-vendedora">
          <div className="suave pequeno">{t.vendedora}</div>
          <b>{cliente.vendedora}</b>
          {zap && <a className="botao-zap" href={zap} target="_blank" rel="noopener noreferrer">{t.falar} · {telefone(cliente.vendedora_whatsapp)}</a>}
        </div>
      </section>

      <div className="area-numeros">
        <div><span>{t.total}</span><b>{dinheiro(total, moeda)}</b></div>
        <div><span>{t.pedidos}</span><b>{validos.length}</b></div>
        <div><span>{t.ultimo}</span><b>{validos[0] ? data(validos[0].data_pedido) : "—"}</b></div>
        <div><span>{t.saldo}</span><b>{dinheiro(saldo, moeda)}</b></div>
      </div>

      {(() => {
        const emAndamento = pedidos.find((p) => !["entregue", "cancelado"].includes(p.etapa));
        return emAndamento ? (
          <section className="painel area-bloco">
            <div className="linha entre"><h2>{t.acompanhar}</h2><span className="suave pequeno">{data(emAndamento.data_pedido)} · {dinheiro(emAndamento.valor_total, emAndamento.moeda)}</span></div>
            <Acompanhamento p={emAndamento} idioma={idioma} />
          </section>
        ) : null;
      })()}

      {meta && (
        <section className="painel area-bloco">
          <h2>{t.meta}</h2>
          <div className="area-barra"><span style={{ width: `${Math.min(100, Number(meta.percentual))}%` }} /></div>
          <p style={{ margin: 0 }}>{meta.meta_batida ? t.metaBatida(dinheiro(meta.valor_premio, meta.moeda))
            : t.metaTexto(dinheiro(meta.falta, meta.moeda), data(meta.fim), dinheiro(meta.valor_premio, meta.moeda))}</p>
        </section>
      )}

      <section className="painel area-bloco">
        <div className="linha entre"><h2>{t.historico}</h2><Link href="/loja/pedidos">{t.verTodos}</Link></div>
        {pedidos.length === 0 ? <p className="suave" style={{ margin: 0 }}>{t.nenhum}</p> : (
          <ul className="area-pedidos">
            {pedidos.slice(0, 8).map((p) => (
              <li key={p.id}>
                <div>
                  <b>{data(p.data_pedido)}</b>{p.bling_numero ? <span className="suave"> · nº {p.bling_numero}</span> : null}
                  <div className="suave pequeno">{p.itens.slice(0, 3).map((i) => `${Number(i.quantidade)}× ${i.descricao.replace(/ ·.*$/, "")}`).join(" · ")}{p.itens.length > 3 ? " …" : ""}</div>
                </div>
                <div className="area-ped-dir">
                  <b className="num">{dinheiro(p.valor_total, p.moeda)}</b>
                  <span className={`selo ${COR[p.etapa] ?? ""}`}>{t.etapas[p.etapa] ?? p.etapa}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {top.length > 0 && (
        <section className="painel area-bloco">
          <div className="linha entre"><h2>{t.maisComprados}</h2><Link href="/loja#catalogo">{t.comprarNovo}</Link></div>
          <ul className="area-top">
            {top.map(([nome, q]) => <li key={nome}><span>{nome}</span><b className="num">{q}</b></li>)}
          </ul>
        </section>
      )}

      <details className="painel area-bloco" id="senha" open={Boolean(f.ok || f.erro)}>
        <summary><b>{t.troca}</b></summary>
        {f.ok && <div className="aviso-ok" role="status">{f.ok}</div>}
        {f.erro && <div className="aviso-erro" role="alert">{f.erro}</div>}
        <form action={trocar} className="acesso-form" style={{ maxWidth: 420, marginTop: 12 }}>
          <input name="usuario" value={doc} autoComplete="username" readOnly hidden />
          <label>{t.atual}<input name="atual" type="password" required autoComplete="current-password" /></label>
          <label>{t.nova}<input name="nova" type="password" required minLength={6} autoComplete="new-password" /></label>
          <label>{t.repetir}<input name="repetir" type="password" required minLength={6} autoComplete="new-password" /></label>
          <button className="adicionar">{t.salvar}</button>
        </form>
      </details>
    </div>
  );
}
