import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, hojeISO } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import { decidirPromocao, encerrarPromocao, proporPromocao, salvarDescontoQuantidade } from "./acoes";

export const metadata = { title: "Promoções" };

const COR: Record<string, string> = { proposta: "aviso", aprovada: "ok", recusada: "erro", encerrada: "" };
const SITUACAO: Record<string, { t: string; c: string }> = {
  parado: { t: "Parado", c: "aviso" }, baixo: { t: "Estoque baixo", c: "erro" }, normal: { t: "Normal", c: "ok" }, esgotado: { t: "Esgotado", c: "" },
};

export default async function Promocoes({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const gestao = ehGestao(u);
  const d = await comUsuario(u.id, async (c) => ({
    sugestoes: (await c.query("select * from app.v_sugestoes_promocao order by vendido_janela, saldo desc limit 30")).rows,
    promocoes: (await c.query(
      `select pr.*, p.codigo, p.nome, uc.nome as criada_nome from app.promocoes pr
         join app.produtos p on p.id = pr.produto_id left join app.usuarios uc on uc.id = pr.criada_por
        where pr.status in ('proposta','aprovada') or pr.decidida_em > now() - interval '30 days'
        order by case pr.status when 'proposta' then 0 when 'aprovada' then 1 else 2 end, pr.fim`)).rows,
    giro: (await c.query(
      `select * from app.v_giro where situacao in ('parado','baixo') order by situacao, cobertura_dias desc nulls first limit 60`)).rows,
    produtos: (await c.query("select id, codigo, nome from app.produtos where ativo and not marketplace order by nome")).rows,
    parametros: (await c.query("select chave, valor from app.parametros")).rows as { chave: string; valor: string }[],
    descontos: (await c.query("select * from app.descontos_quantidade order by ativo desc, marca nulls first, min_qtd")).rows,
    marcas: (await c.query("select distinct marca from app.produtos where ativo and marca is not null order by 1")).rows.map((x) => x.marca as string),
  }));
  const par = Object.fromEntries(d.parametros.map((x) => [x.chave, Number(x.valor)]));

  return (
    <>
      <section>
        <h1>Promoções e giro de estoque</h1>
        <div className="suave pequeno">
          O sistema sugere promoção para produto parado (sem venda em {par.giro_janela_dias} dias ou com estoque para mais de {par.giro_parado_cobertura} dias).
          Nenhum desconto aparece para o cliente sem aprovação do gerente. Desconto máximo: {par.promo_desconto_maximo}%.
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <section className="painel">
        <h2 style={{ margin: 0 }}>Desconto por quantidade</h2>
        <p className="suave pequeno" style={{ margin: 0 }}>Ex.: levando 10 caixas de MAYCRENE, 5% de desconto. O carrinho do cliente mostra "leve mais N caixas e o pedido pode ganhar X%". O desconto <b>só entra com a liberação do gerente</b>: o pedido que atinge a faixa aparece em Vendas → Descontos a liberar. Produto já em promoção não leva o desconto de novo.</p>
        {d.descontos.length > 0 && (
          <div className="tabela"><table>
            <thead><tr><th>Marca</th><th className="num">A partir de</th><th className="num">Desconto</th><th>País</th><th>Situação</th>{gestao && <th></th>}</tr></thead>
            <tbody>{d.descontos.map((x) => (
              <tr key={x.id}>
                <td>{x.marca ?? "Qualquer marca"}</td><td className="num">{x.min_qtd} caixas</td><td className="num">{Number(x.desconto_pct)}%</td>
                <td>{x.pais === "PY" ? "Paraguai" : x.pais === "BR" ? "Brasil" : "Os dois"}</td>
                <td><Selo cor={x.ativo ? "ok" : ""}>{x.ativo ? "ativo" : "pausado"}</Selo></td>
                {gestao && <td><form action={salvarDescontoQuantidade}>
                  <input type="hidden" name="id" value={x.id} /><input type="hidden" name="marca" value={x.marca ?? ""} /><input type="hidden" name="min_qtd" value={x.min_qtd} />
                  <input type="hidden" name="desconto_pct" value={x.desconto_pct} /><input type="hidden" name="pais" value={x.pais ?? ""} /><input type="hidden" name="ativo" value={x.ativo ? "0" : "1"} />
                  <button className="discreto">{x.ativo ? "Pausar" : "Reativar"}</button></form></td>}
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {gestao && (
          <form action={salvarDescontoQuantidade} className="campos">
            <label>Marca<select name="marca" defaultValue=""><option value="">Qualquer marca</option>{d.marcas.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
            <label>A partir de (caixas)<input name="min_qtd" inputMode="numeric" required placeholder="10" /></label>
            <label>Desconto (%)<input name="desconto_pct" inputMode="decimal" required placeholder="5" /></label>
            <label>País<select name="pais" defaultValue=""><option value="">Os dois</option><option value="PY">Paraguai</option><option value="BR">Brasil</option></select></label>
            <button className="principal">Criar desconto</button>
          </form>
        )}
      </section>

      <section className="painel">
        <h2>Promoções</h2>
        {d.promocoes.length === 0 ? <p className="suave">Nenhuma promoção ativa ou aguardando.</p> : (
          <div className="tabela"><table>
            <thead><tr><th>Produto</th><th>País</th><th>Desconto</th><th>Período</th><th>Motivo</th><th>Situação</th><th></th></tr></thead>
            <tbody>{d.promocoes.map((p) => (
              <tr key={p.id}>
                <td><b>{p.nome}</b><div className="pequeno suave">{p.codigo}{p.limite_qtd ? ` · máx. ${Number(p.limite_qtd)} por pedido` : ""}</div></td>
                <td>{p.pais}</td>
                <td className="num">-{Number(p.desconto_pct)}%</td>
                <td className="num">{data(p.inicio)} a {data(p.fim)}</td>
                <td className="pequeno">{p.motivo ?? "—"}{p.origem === "sugestao_giro" && <div><Selo cor="info">sugerida pelo giro</Selo></div>}</td>
                <td><Selo cor={COR[p.status]}>{p.status}</Selo>{p.motivo_recusa && <div className="pequeno">{p.motivo_recusa}</div>}</td>
                <td>
                  {gestao && p.status === "proposta" && (
                    <form action={decidirPromocao} className="linha">
                      <input type="hidden" name="id" value={p.id} />
                      <input name="motivo" placeholder="Motivo se recusar" style={{ width: 150 }} />
                      <button className="principal" name="decisao" value="aprovar">Aprovar</button>
                      <button className="perigo" name="decisao" value="recusar">Recusar</button>
                    </form>
                  )}
                  {gestao && p.status === "aprovada" && (
                    <form action={encerrarPromocao}><input type="hidden" name="id" value={p.id} /><button>Encerrar</button></form>
                  )}
                </td>
              </tr>))}
            </tbody></table></div>
        )}
      </section>

      {gestao && (
        <section className="painel">
          <h2>Sugestões do sistema</h2>
          {d.sugestoes.length === 0 ? <p className="suave">Nenhum produto parado sem promoção.</p> : (
            <div className="coluna" style={{ gap: 10 }}>
              {d.sugestoes.map((s, k) => (
                <form key={k} action={proporPromocao} className="painel campos" style={{ background: "var(--afundado)" }}>
                  <input type="hidden" name="produto_id" value={s.produto_id} />
                  <input type="hidden" name="origem" value="sugestao_giro" />
                  <input type="hidden" name="motivo" value={`${s.motivo} (${s.deposito}: ${Number(s.saldo)} un.)`} />
                  <div className="largo"><b>{s.produto}</b> <span className="suave pequeno">{s.codigo} · {s.deposito} · {Number(s.saldo)} un. · {s.motivo}</span></div>
                  <label>Desconto (%)<input name="desconto" inputMode="decimal" defaultValue={Number(s.desconto_sugerido)} /></label>
                  <label>Para clientes do
                    <select name="pais" defaultValue="ambos"><option value="ambos">Paraguai e Brasil</option><option value="PY">Paraguai</option><option value="BR">Brasil</option></select>
                  </label>
                  <label>Início<input name="inicio" type="date" defaultValue={hojeISO()} /></label>
                  <label>Fim<input name="fim" type="date" defaultValue={hojeISO(15)} /></label>
                  <label>Máx. por pedido<input name="limite" inputMode="numeric" placeholder="sem limite" /></label>
                  <button className="principal">Propor promoção</button>
                </form>
              ))}
            </div>
          )}
          <details>
            <summary>Criar promoção manual</summary>
            <form action={proporPromocao} className="campos" style={{ marginTop: 10 }}>
              <label className="largo">Produto
                <select name="produto_id" required defaultValue="">
                  <option value="">Escolha…</option>
                  {d.produtos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nome}</option>)}
                </select>
              </label>
              <label>Desconto (%)<input name="desconto" inputMode="decimal" required /></label>
              <label>Para clientes do
                <select name="pais" defaultValue="ambos"><option value="ambos">Paraguai e Brasil</option><option value="PY">Paraguai</option><option value="BR">Brasil</option></select>
              </label>
              <label>Início<input name="inicio" type="date" defaultValue={hojeISO()} /></label>
              <label>Fim<input name="fim" type="date" defaultValue={hojeISO(15)} /></label>
              <label>Máx. por pedido<input name="limite" inputMode="numeric" /></label>
              <label className="largo">Motivo<input name="motivo" placeholder="Ex.: lançamento, data comemorativa" /></label>
              <button className="principal">Propor promoção</button>
            </form>
          </details>
        </section>
      )}

      <section className="painel">
        <h2>Giro de estoque: atenção</h2>
        {d.giro.length === 0 ? <p className="suave">Nenhum produto parado ou com estoque baixo.</p> : (
          <div className="tabela"><table>
            <thead><tr><th>Produto</th><th>Depósito</th><th>Saldo</th><th>Vendido ({par.giro_janela_dias} dias)</th><th>Cobertura</th><th>Situação</th></tr></thead>
            <tbody>{d.giro.map((g, k) => (
              <tr key={k}>
                <td>{g.produto}<div className="pequeno suave">{g.codigo}</div></td>
                <td>{g.deposito}</td>
                <td className="num">{Number(g.saldo)}</td>
                <td className="num">{Number(g.vendido_janela)}</td>
                <td className="num">{g.cobertura_dias ? `${g.cobertura_dias} dias` : "sem vendas"}</td>
                <td><Selo cor={SITUACAO[g.situacao]?.c}>{SITUACAO[g.situacao]?.t ?? g.situacao}</Selo></td>
              </tr>))}
            </tbody></table></div>
        )}
        <p className="pequeno suave">Estoque baixo: menos de {par.giro_baixo_cobertura} dias de venda. Vale repor ou transferir antes de faltar.</p>
      </section>
    </>
  );
}
