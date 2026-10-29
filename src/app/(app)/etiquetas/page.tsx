import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data } from "@/lib/formato";
import { Imprimir } from "../estoque/transferencias/[id]/imprimir";

export const metadata = { title: "Etiquetas de envio" };

type Linha = {
  id: string; cliente: string; bling_numero: string | null; data_pedido: string; entrega_tipo: string | null; entrega_meio: string | null;
  entrega_dados: string | null; volumes: number; cidade: string | null; pais: string;
  envio_nome: string | null; envio_documento: string | null; envio_telefone: string | null; envio_endereco: string | null; vendedora: string | null;
};

/** Pega "Nome: …", "Identidade: …" do que a vendedora confirmou no pedido; se não tiver, usa a ficha do cliente. */
function dadosDe(x: Linha) {
  const campo = (rotulo: string) => {
    const l = (x.entrega_dados ?? "").split("\n").find((s) => s.startsWith(`${rotulo}:`));
    return l ? l.slice(rotulo.length + 1).trim() : null;
  };
  const confirmado = Boolean(campo("Direção"));
  return {
    nome: campo("Nome") ?? x.envio_nome ?? x.cliente,
    documento: campo("Identidade") ?? x.envio_documento,
    telefone: campo("Telefone") ?? x.envio_telefone,
    endereco: campo("Direção") ?? x.envio_endereco ?? x.cidade,
    obs: campo("Obs."),
    livre: !confirmado && x.entrega_dados && !x.envio_endereco ? x.entrega_dados : null,
  };
}

/** Etiquetas para colar nas caixas: uma por volume, com os dados confirmados de envio. */
export default async function Etiquetas({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const u = await exigirUsuario();
  const ids = ((await searchParams).ids ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 100);
  const lista = ids.length
    ? (await comUsuario(u.id, (c) => c.query("select * from app.etiquetas_envio($1::uuid[])", [ids]))).rows as Linha[]
    : [];
  const etiquetas = lista.flatMap((x) => Array.from({ length: Math.min(x.volumes, 30) }, (_, k) => ({ x, k })));

  return (
    <>
      <section className="cabecalho-pagina nao-imprimir">
        <div>
          <div className="trilha"><Link href="/pedidos">Pedidos</Link> / Etiquetas de envio</div>
          <h1>Etiquetas de envio</h1>
          <p>{etiquetas.length} etiqueta(s) — uma por caixa. Imprima e cole em cada volume.</p>
        </div>
        {etiquetas.length > 0 && <Imprimir />}
      </section>
      {etiquetas.length === 0 && <div className="painel vazio">Nenhum pedido para etiquetar.</div>}
      <div className="etiquetas">
        {etiquetas.map(({ x, k }) => {
          const d = dadosDe(x);
          return (
            <article key={`${x.id}-${k}`} className="etiqueta">
              <div className="etiqueta-topo">
                <span>DESTINATÁRIO</span>
                <span className="etiqueta-vol">Caixa {k + 1}/{x.volumes}</span>
              </div>
              <div className="etiqueta-nome">{d.nome}</div>
              {d.documento && <div><b>{x.pais === "PY" ? "CI" : "Doc."}:</b> {d.documento}</div>}
              {d.telefone && <div><b>Tel.:</b> {d.telefone}</div>}
              {d.endereco && <div className="etiqueta-end">{d.endereco}</div>}
              {d.livre && <div className="etiqueta-end">{d.livre}</div>}
              {d.obs && <div className="pequeno">Obs.: {d.obs}</div>}
              <div className="etiqueta-rodape">
                <span><b>{x.entrega_meio ?? "Envio"}</b></span>
                <span>Pedido {x.bling_numero ?? x.id.slice(0, 8)} · {data(x.data_pedido)}{x.vendedora ? ` · ${x.vendedora}` : ""}</span>
                <span>Remetente: Virtual Cosméticos</span>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
