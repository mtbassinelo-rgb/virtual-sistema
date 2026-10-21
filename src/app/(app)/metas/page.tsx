import Link from "next/link";
import { exigirUsuario, ehGestao, podeEscrever } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, data, hojeISO, STATUS_META, type Moeda } from "@/lib/formato";
import { Avisos, Barra, Selo } from "../avisos";
import { avaliarMetas, cancelarMeta, decidirMeta, entregarPremio, proporMeta } from "./acoes";

export const metadata = { title: "Metas" };

const COR: Record<string, string> = {
  proposta: "aviso", aprovada: "info", atingida: "ok", premio_entregue: "marca", recusada: "erro", nao_atingida: "", cancelada: "",
};

export default async function Metas({ searchParams }: {
  searchParams: Promise<{ status?: string; cliente?: string; ok?: string; erro?: string }>;
}) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const gestao = ehGestao(u);
  const d = await comUsuario(u.id, async (c) => ({
    metas: (await c.query(
      `select * from app.v_metas ${f.status ? "where status = $1::app.status_meta" : ""}
        order by case status when 'proposta' then 0 when 'aprovada' then 1 when 'atingida' then 2 else 3 end, fim`,
      f.status ? [f.status] : [])).rows,
    clientes: (await c.query("select id, nome, moeda from app.clientes where mesclado_em is null and ativo order by nome")).rows,
  }));

  return (
    <>
      <section className="linha entre">
        <div>
          <h1>Metas com premiação</h1>
          <div className="suave pequeno">A vendedora propõe, o gerente aprova. O prêmio só é liberado com as compras do período pagas e conferidas.</div>
        </div>
        {gestao && <form action={avaliarMetas}><button>Avaliar metas vencidas</button></form>}
      </section>
      <Avisos ok={f.ok} erro={f.erro} />
      <nav className="filtros">
        {[["", "Todas"], ["proposta", "Para aprovar"], ["aprovada", "Em andamento"], ["atingida", "Atingidas"], ["premio_entregue", "Prêmio entregue"], ["nao_atingida", "Não atingidas"]].map(([k, v]) => (
          <Link key={k} href={k ? `/metas?status=${k}` : "/metas"} className={(f.status ?? "") === k ? "ativo" : ""}>{v}</Link>
        ))}
      </nav>

      {d.metas.length === 0 ? <div className="painel vazio">Nenhuma meta aqui ainda.</div> : (
        <div className="coluna">
          {d.metas.map((m) => {
            const moeda = m.moeda as Moeda;
            return (
              <section key={m.id} className="painel">
                <div className="linha entre">
                  <div>
                    <Link href={`/clientes/${m.cliente_id}`}><b>{m.cliente_nome}</b></Link>
                    <span className="suave"> · {m.vendedora_nome} · {data(m.inicio)} a {data(m.fim)}</span>
                  </div>
                  <Selo cor={COR[m.status]}>{STATUS_META[m.status]}</Selo>
                </div>
                <div className="linha entre">
                  <span>Meta: <b className="num">{dinheiro(m.valor_meta, moeda)}</b></span>
                  <span>Prêmio: <b className="num">{dinheiro(m.valor_premio, moeda)}</b> em {m.tipo_premio}{m.descricao_premio ? ` (${m.descricao_premio})` : ""}</span>
                </div>
                {["aprovada", "atingida", "nao_atingida", "premio_entregue"].includes(m.status) && (
                  <>
                    <Barra percentual={Number(m.percentual)} ok={m.meta_batida} />
                    <div className="linha entre pequeno">
                      <span>Comprado: <span className="num">{dinheiro(m.vendido, moeda)}</span> ({Number(m.percentual)}%)</span>
                      {m.status === "aprovada" && <span>Falta <span className="num">{dinheiro(m.falta, moeda)}</span> · {m.dias_restantes} dia(s)</span>}
                      {Number(m.saldo_em_aberto) > 0 && <span className="suave">Em aberto: <span className="num">{dinheiro(m.saldo_em_aberto, moeda)}</span></span>}
                    </div>
                  </>
                )}
                {m.status === "recusada" && <div className="pequeno">Motivo: {m.motivo_recusa}</div>}
                {m.status === "atingida" && (
                  <div className={`aviso-caixa ${m.premio_liberado ? "ok" : "aviso"}`}>
                    {m.premio_liberado ? "Prêmio liberado: compras do período pagas e conferidas." : "Prêmio bloqueado até as compras do período estarem pagas e conferidas."}
                  </div>
                )}

                {gestao && m.status === "proposta" && (
                  <form action={decidirMeta} className="campos">
                    <input type="hidden" name="meta_id" value={m.id} />
                    <label>Motivo (se recusar)<input name="motivo" /></label>
                    <div className="linha">
                      <button className="principal" name="decisao" value="aprovar">Aprovar</button>
                      <button className="perigo" name="decisao" value="recusar">Recusar</button>
                    </div>
                  </form>
                )}
                {!gestao && m.status === "proposta" && podeEscrever(u) && (
                  <form action={cancelarMeta}><input type="hidden" name="meta_id" value={m.id} /><button>Cancelar proposta</button></form>
                )}
                {gestao && m.status === "atingida" && m.premio_liberado && (
                  <form action={entregarPremio} className="campos">
                    <input type="hidden" name="meta_id" value={m.id} />
                    <label>Como foi entregue<input name="observacao" placeholder="Ex.: mercadoria Rhenuks no pedido 1050" /></label>
                    <button className="principal">Registrar entrega do prêmio</button>
                  </form>
                )}
              </section>
            );
          })}
        </div>
      )}

      {podeEscrever(u) && (
        <section className="painel" id="propor">
          <h2>Propor meta</h2>
          <form action={proporMeta} className="campos">
            <label className="largo">Cliente
              <select name="cliente_id" required defaultValue={f.cliente ?? ""}>
                <option value="">Escolha…</option>
                {d.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome} ({c.moeda === "GS" ? "Gs" : "R$"})</option>)}
              </select>
            </label>
            <label>Início<input name="inicio" type="date" required defaultValue={hojeISO()} /></label>
            <label>Fim<input name="fim" type="date" required defaultValue={hojeISO(30)} /></label>
            <label>Valor a comprar<input name="valor_meta" inputMode="decimal" required placeholder="20.000.000" /></label>
            <label>Prêmio<input name="valor_premio" inputMode="decimal" required placeholder="1.000.000" /></label>
            <label>Tipo de prêmio
              <select name="tipo_premio" defaultValue="mercadoria">
                <option value="mercadoria">Mercadoria</option><option value="desconto">Desconto</option><option value="outro">Outro</option>
              </select>
            </label>
            <label className="largo">Descrição do prêmio<input name="descricao_premio" placeholder="Ex.: Gs 1.000.000 em mercadoria à escolha" /></label>
            <button className="principal">Enviar para aprovação</button>
          </form>
        </section>
      )}
    </>
  );
}
