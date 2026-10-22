import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, data, hojeISO, nomeMes, SITUACAO_DESPESA, type Moeda } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { alterarValorRecorrente, apagarDespesa, desfazerPagamento, encerrarRecorrente, lancarDespesa, pagarDespesa, salvarRecorrente } from "./acoes";

export const metadata = { title: "Contas a pagar" };

const VISOES = [
  { k: "abertas", t: "A pagar", w: "pago_em is null" },
  { k: "vencidas", t: "Vencidas", w: "situacao = 'vencida'" },
  { k: "semana", t: "Vencem em 7 dias", w: "situacao in ('vence_hoje','vence_7_dias')" },
  { k: "pagas", t: "Pagas no mês", w: "pago_em is not null" },
  { k: "todas", t: "Todas do mês", w: "true" },
] as const;

export default async function Despesas({ searchParams }: {
  searchParams: Promise<{ ver?: string; mes?: string; categoria?: string; ok?: string; erro?: string }>;
}) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) redirect("/");
  const f = await searchParams;
  const visao = VISOES.find((v) => v.k === f.ver) ?? VISOES[0];
  const mes = /^\d{4}-\d{2}$/.test(f.mes ?? "") ? f.mes! : hojeISO().slice(0, 7);
  const porMes = visao.k === "pagas" || visao.k === "todas";
  const params = new URLSearchParams({ ver: visao.k, mes, ...(f.categoria ? { categoria: f.categoria } : {}) });
  const volta = `/despesas?${params}`;
  const gerir = u.perfil === "dono" || u.perfil === "gerente";
  const { atual } = await unidadeSistema(u);

  const d = await comUsuario(u.id, async (c) => {
    // contas fixas: lança a do mês atual e a do próximo (não duplica)
    if (gerir) {
      await c.query("select app.gerar_despesas_recorrentes(current_date)");
      await c.query("select app.gerar_despesas_recorrentes((current_date + interval '1 month')::date)");
    }
    const filtros: string[] = [visao.w];
    const vals: unknown[] = [];
    if (porMes) {
      vals.push(`${mes}-01`);
      filtros.push(visao.k === "pagas" ? `date_trunc('month', pago_em) = $${vals.length}::date` : `competencia = $${vals.length}::date`);
    }
    if (f.categoria) { vals.push(f.categoria); filtros.push(`categoria = $${vals.length}`); }
    if (atual) { vals.push(atual.id); filtros.push(`deposito_id = $${vals.length}`); }
    const lista = (await c.query(
      `select * from app.v_despesas where ${filtros.join(" and ")}
        order by case when pago_em is null then 0 else 1 end, vencimento nulls last, criado_em limit 500`, vals)).rows;
    const resumo = (await c.query(`select moeda,
        coalesce(sum(valor) filter (where situacao = 'vencida'), 0) vencidas,
        coalesce(sum(valor) filter (where situacao in ('vence_hoje','vence_7_dias')), 0) semana,
        coalesce(sum(valor) filter (where pago_em is null), 0) a_pagar,
        coalesce(sum(valor_pago) filter (where date_trunc('month', pago_em) = date_trunc('month', current_date)), 0) pago_mes
      from app.v_despesas ${atual ? "where deposito_id = $1" : ""} group by moeda order by moeda desc`, atual ? [atual.id] : [])).rows;
    const depositos = (await c.query("select id, nome from app.depositos where ativo order by tipo, nome")).rows as { id: string; nome: string }[];
    const categorias = (await c.query("select codigo, nome, tipo from app.despesa_categorias where ativo order by ordem, nome")).rows;
    const recorrentes = (await c.query(`select r.*, c.nome categoria_nome, c.tipo from app.despesas_recorrentes r
        join app.despesa_categorias c on c.codigo = r.categoria where r.ativo order by r.dia_vencimento, r.descricao`)).rows;
    return { lista, resumo, categorias, recorrentes, depositos };
  });

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Contas a pagar{atual ? ` · ${atual.nome}` : ""}</h1>
          <p>Compras das marcas, aluguel, salários, transportadoras, passeiro e o que mais vencer. Lance a conta e marque quando pagar.</p>
        </div>
        <Link className="botao" href="/relatorios?aba=resultado">Ver resultado do mês</Link>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      {d.resumo.map((r) => (
        <section key={r.moeda} className="indicadores">
          <div className="indicador"><span className="rotulo">Vencidas ({r.moeda === "GS" ? "Gs" : "R$"})</span><span className="valor">{dinheiro(r.vencidas, r.moeda)}</span></div>
          <div className="indicador"><span className="rotulo">Vencem em 7 dias</span><span className="valor">{dinheiro(r.semana, r.moeda)}</span></div>
          <div className="indicador"><span className="rotulo">Total a pagar</span><span className="valor">{dinheiro(r.a_pagar, r.moeda)}</span></div>
          <div className="indicador"><span className="rotulo">Pago neste mês</span><span className="valor">{dinheiro(r.pago_mes, r.moeda)}</span></div>
        </section>
      ))}

      <nav className="filtros">
        {VISOES.map((v) => (
          <Link key={v.k} href={`/despesas?${new URLSearchParams({ ver: v.k, mes, ...(f.categoria ? { categoria: f.categoria } : {}) })}`}
            className={v.k === visao.k ? "ativo" : ""}>{v.t}</Link>
        ))}
      </nav>
      <form className="linha" method="get">
        <input type="hidden" name="ver" value={visao.k} />
        {porMes && <label>Mês<input type="month" name="mes" defaultValue={mes} /></label>}
        <label>Categoria
          <select name="categoria" defaultValue={f.categoria ?? ""}>
            <option value="">Todas</option>
            {d.categorias.map((c) => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)}
          </select>
        </label>
        <button>Filtrar</button>
      </form>

      <section className="painel">
        <h2>{visao.t}{porMes ? ` · ${nomeMes(mes)}` : ""}</h2>
        {d.lista.length === 0 ? <div className="vazio">Nada por aqui.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Vencimento</th><th>Conta</th><th>Categoria</th><th>Valor</th><th>Situação</th>{gerir && <th></th>}</tr></thead>
            <tbody>{d.lista.map((x) => {
              const s = SITUACAO_DESPESA[x.situacao] ?? { texto: x.situacao, cor: "" };
              return (
                <tr key={x.id}>
                  <td className="num">{x.vencimento ? data(x.vencimento) : "—"}</td>
                  <td>{x.descricao}{x.recorrente_id && <> <Selo>fixa</Selo></>}{x.compra_id && <> <Link className="pequeno" href={`/estoque/notas/${x.compra_id}`}>ver nota</Link></>}<div className="pequeno suave">{[x.fornecedor, x.documento, `ref. ${nomeMes(x.competencia)}`, !atual && x.deposito_id ? d.depositos.find((z) => z.id === x.deposito_id)?.nome : null].filter(Boolean).join(" · ")}</div>
                    {x.observacao && <div className="pequeno suave">{x.observacao}</div>}</td>
                  <td>{x.categoria_nome}</td>
                  <td className="num">{dinheiro(x.valor, x.moeda as Moeda)}
                    {x.pago_em && Number(x.valor_pago) !== Number(x.valor) && <div className="pequeno suave">pago {dinheiro(x.valor_pago, x.moeda as Moeda)}</div>}</td>
                  <td><Selo cor={s.cor}>{s.texto}</Selo>{x.pago_em && <div className="pequeno suave">em {data(x.pago_em)}{x.forma ? ` · ${x.forma}` : ""}</div>}</td>
                  {gerir && (
                    <td>
                      {x.pago_em ? (
                        <form action={desfazerPagamento}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="volta" value={volta} />
                          <button className="pequeno">Desfazer pagamento</button></form>
                      ) : (
                        <div className="linha">
                          <form action={pagarDespesa} className="linha">
                            <input type="hidden" name="id" value={x.id} /><input type="hidden" name="volta" value={volta} />
                            <input type="date" name="pago_em" defaultValue={hojeISO()} aria-label="Data do pagamento" />
                            <input name="valor_pago" inputMode="decimal" placeholder="Valor pago" aria-label="Valor pago (vazio = valor da conta)" style={{ width: 110 }} />
                            <button className="principal">Pagar</button>
                          </form>
                          <form action={apagarDespesa}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="volta" value={volta} />
                            <button className="perigo pequeno">Apagar</button></form>
                        </div>
                      )}
                    </td>
                  )}
                </tr>);
            })}</tbody>
          </table></div>
        )}
      </section>

      {gerir && (
        <section className="painel">
          <h2>Lançar conta</h2>
          <form action={lancarDespesa} className="campos">
            <input type="hidden" name="volta" value={volta} />
            <label>Categoria
              <select name="categoria" required defaultValue={f.categoria ?? ""}>
                <option value="">Escolha…</option>
                {d.categorias.map((c) => <option key={c.codigo} value={c.codigo}>{c.nome}{c.tipo === "fixa" ? " (fixa)" : " (variável)"}</option>)}
              </select>
            </label>
            <label className="largo">Descrição<input name="descricao" required maxLength={200} placeholder="Ex.: Pedido 2303 Fonte da Beleza, aluguel do CD de Foz" /></label>
            <label>Fornecedor, marca ou a quem pagar<input name="fornecedor" maxLength={120} /></label>
            <label>Unidade<select name="deposito" defaultValue={atual?.id ?? ""}><option value="">Empresa (geral)</option>{d.depositos.map((z) => <option key={z.id} value={z.id}>{z.nome}</option>)}</select></label>
            <label>Moeda
              <select name="moeda" defaultValue="GS"><option value="GS">Gs</option><option value="BRL">R$</option></select>
            </label>
            <label>Valor<input name="valor" inputMode="decimal" required /></label>
            <label>Vencimento<input name="vencimento" type="date" /></label>
            <label>Mês de referência<input name="competencia" type="month" defaultValue={hojeISO().slice(0, 7)} /></label>
            <label>Repetir todo mês (vezes)<input name="repetir" type="number" min={1} max={24} defaultValue={1} /></label>
            <label>Nº da nota / boleto<input name="documento" maxLength={80} /></label>
            <label>Câmbio pago (Gs por R$)<input name="cambio" inputMode="decimal" placeholder="Se pagou R$ com Gs" /></label>
            <label>Forma de pagamento<input name="forma" maxLength={60} placeholder="Pix, transferência, efetivo…" /></label>
            <label className="largo">Observação<input name="observacao" maxLength={500} /></label>
            <label className="linha"><input type="checkbox" name="paga" value="1" /> Já está paga</label>
            <label>Pago em<input name="pago_em" type="date" defaultValue={hojeISO()} /></label>
            <button className="principal">Lançar</button>
          </form>
          <p className="suave pequeno" style={{ margin: 0 }}>Aluguel e salários: use "Repetir todo mês" para lançar as próximas contas de uma vez.
            Compras de mercadoria aparecem aqui como conta a pagar, mas no resultado do mês o que conta é o custo do que foi vendido.</p>
        </section>
      )}
      {gerir && (
        <section className="painel">
          <h2>Contas fixas (todo mês)</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>Aluguel, salários, internet, contador… Cadastre uma vez: a conta de cada mês aparece sozinha em "A pagar" (o mês atual e o próximo).
            Elas entram como custo fixo no ponto de equilíbrio do painel financeiro.</p>
          {d.recorrentes.length > 0 && (
            <div className="tabela"><table>
              <thead><tr><th>Dia</th><th>Conta</th><th>Categoria</th><th>Valor</th><th></th></tr></thead>
              <tbody>{d.recorrentes.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.dia_vencimento}</td>
                  <td>{r.descricao}{r.fornecedor && <div className="pequeno suave">{r.fornecedor}</div>}</td>
                  <td>{r.categoria_nome} <span className="pequeno suave">({r.tipo === "fixa" ? "fixa" : "variável"})</span></td>
                  <td>
                    <form action={alterarValorRecorrente} className="linha" style={{ gap: 6 }}>
                      <input type="hidden" name="id" value={r.id} /><input type="hidden" name="volta" value={volta} />
                      <span className="pequeno suave">{r.moeda === "GS" ? "Gs" : "R$"}</span>
                      <input name="valor" inputMode="decimal" defaultValue={String(Number(r.valor))} style={{ width: 110 }} aria-label="Valor" />
                      <button className="pequeno">Salvar</button>
                    </form>
                  </td>
                  <td><form action={encerrarRecorrente}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="volta" value={volta} />
                    <button className="discreto pequeno">Encerrar</button></form></td>
                </tr>))}</tbody>
            </table></div>
          )}
          <form action={salvarRecorrente} className="campos">
            <input type="hidden" name="volta" value={volta} />
            <label>Categoria
              <select name="categoria" required defaultValue="">
                <option value="">Escolha…</option>
                {d.categorias.filter((c) => c.codigo !== "mercadoria").map((c) => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)}
              </select>
            </label>
            <label className="largo">Descrição<input name="descricao" required maxLength={200} placeholder="Ex.: Aluguel do CD de Foz" /></label>
            <label>A quem pagar<input name="fornecedor" maxLength={120} /></label>
            <label>Unidade<select name="deposito" defaultValue={atual?.id ?? ""}><option value="">Empresa (geral)</option>{d.depositos.map((z) => <option key={z.id} value={z.id}>{z.nome}</option>)}</select></label>
            <label>Moeda<select name="moeda" defaultValue="BRL"><option value="BRL">R$</option><option value="GS">Gs</option></select></label>
            <label>Valor<input name="valor" inputMode="decimal" required /></label>
            <label>Dia do vencimento<input name="dia" type="number" min={1} max={28} required defaultValue={10} /></label>
            <label>A partir de<input name="inicio" type="month" defaultValue={hojeISO().slice(0, 7)} /></label>
            <button className="principal">Cadastrar conta fixa</button>
          </form>
        </section>
      )}
    </>
  );
}
