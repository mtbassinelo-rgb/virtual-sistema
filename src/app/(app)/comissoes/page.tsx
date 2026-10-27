import Link from "next/link";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { BASE_COMISSAO, dinheiro, data, hojeISO, nomeMes, type Moeda } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import { definirComissao } from "./acoes";

export const metadata = { title: "Comissões" };

type Linha = {
  vendedora_id: string; vendedora: string; moeda: Moeda; base: string | null; percentual: string | null;
  vendido: string; recebido: string; lucro: string; itens_sem_custo: number; valor_base: string | null; comissao: string | null;
};

export default async function Comissoes({ searchParams }: { searchParams: Promise<{ mes?: string; ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const gestao = ehGestao(u);
  const mes = /^\d{4}-\d{2}$/.test(f.mes ?? "") ? f.mes! : hojeISO().slice(0, 7);
  const [a, m] = mes.split("-").map(Number);
  const anterior = new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7);
  const seguinte = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 7);

  const d = await comUsuario(u.id, async (c) => ({
    // vendedora vê só a própria linha e a própria regra
    linhas: ((await c.query("select * from app.comissoes(($1 || '-01')::date)", [mes])).rows as Linha[])
      .filter((l) => gestao || l.vendedora_id === u.vendedora_id),
    regras: (await c.query(
      `select r.*, v.nome as vendedora, u.nome as quem from app.comissao_regras r
         join app.vendedoras v on v.id = r.vendedora_id left join app.usuarios u on u.id = r.definido_por
        where $1::boolean or r.vendedora_id = $2::uuid
        order by v.nome, r.vigente_desde desc`, [gestao, u.vendedora_id])).rows,
    vendedoras: gestao ? (await c.query("select id, nome from app.vendedoras where ativo order by nome")).rows : [],
  }));
  const total = (moeda: Moeda) => d.linhas.filter((l) => l.moeda === moeda).reduce((t, l) => t + Number(l.comissao ?? 0), 0);

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>{gestao ? "Comissões" : "Minha comissão"}</h1>
          <p>{gestao
            ? "Cada vendedora tem o próprio percentual e a base (vendido, recebido ou lucro), definidos aqui pelo gerente."
            : "Sua comissão do mês, calculada pela regra definida pelo gerente."}</p>
        </div>
        <nav className="linha">
          <Link className="botao" href={`/comissoes?mes=${anterior}`}>← {nomeMes(anterior)}</Link>
          <b>{nomeMes(mes)}</b>
          <Link className="botao" href={`/comissoes?mes=${seguinte}`}>{nomeMes(seguinte)} →</Link>
        </nav>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <section className="indicadores">
        {(["GS", "BRL"] as Moeda[]).filter((x) => d.linhas.some((l) => l.moeda === x)).map((x) => (
          <div key={x} className="indicador"><span className="rotulo">Comissões do mês ({x === "GS" ? "Gs" : "R$"})</span><span className="valor">{dinheiro(total(x), x)}</span></div>
        ))}
      </section>

      <section className="painel">
        <div className="linha entre">
          <h2>{nomeMes(mes)}</h2>
          {gestao && <a className="botao" href={`/comissoes/planilha?mes=${mes}`}>Baixar planilha (CSV)</a>}
        </div>
        {d.linhas.length === 0 ? <div className="vazio">Nenhuma venda neste mês.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Vendedora</th><th>Regra</th><th>Vendido</th><th>Recebido</th>{gestao && <th>Lucro</th>}<th>Base</th><th>Comissão</th></tr></thead>
            <tbody>{d.linhas.map((l) => (
              <tr key={l.vendedora_id + l.moeda}>
                <td>{l.vendedora} <span className="suave pequeno">{l.moeda === "GS" ? "Gs" : "R$"}</span></td>
                <td>{l.base ? `${Number(l.percentual).toLocaleString("pt-BR")}% ${BASE_COMISSAO[l.base]}` : <Selo cor="aviso">sem regra</Selo>}</td>
                <td className="num">{dinheiro(l.vendido, l.moeda)}</td>
                <td className="num">{dinheiro(l.recebido, l.moeda)}</td>
                {gestao && <td className="num">{dinheiro(l.lucro, l.moeda)}
                  {l.itens_sem_custo > 0 && <div className="pequeno suave">{l.itens_sem_custo} itens sem custo</div>}</td>}
                <td className="num">{l.valor_base == null ? "—" : dinheiro(l.valor_base, l.moeda)}</td>
                <td className="num"><b>{l.comissao == null ? "—" : dinheiro(l.comissao, l.moeda)}</b></td>
              </tr>))}</tbody>
          </table></div>
        )}
        <p className="suave pequeno" style={{ margin: 0 }}>Vendido: pedidos confirmados do mês. Recebido: pagamentos conferidos com data no mês.
          {gestao ? "Lucro: venda menos o custo dos itens (itens sem custo cadastrado ficam de fora)." : ""}</p>
      </section>

      {gestao && (
        <section className="painel">
          <h2>Definir comissão</h2>
          <form action={definirComissao} className="campos">
            <input type="hidden" name="mes" value={mes} />
            <label>Vendedora
              <select name="vendedora_id" required defaultValue="">
                <option value="">Escolha…</option>
                {d.vendedoras.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
            </label>
            <label>Percentual (%)<input name="percentual" inputMode="decimal" required placeholder="Ex.: 3" /></label>
            <label>Base
              <select name="base" required defaultValue="recebido">
                <option value="recebido">Sobre o recebido (pago e conferido)</option>
                <option value="vendido">Sobre o vendido</option>
                <option value="lucro">Sobre o lucro</option>
              </select>
            </label>
            <label>Vale a partir de<input name="vigente_desde" type="month" required defaultValue={mes} /></label>
            <label className="largo">Observação<input name="observacao" maxLength={300} /></label>
            <button className="principal">Salvar</button>
          </form>
        </section>
      )}

      <section className="painel">
        <h2>Regras</h2>
        {d.regras.length === 0 ? <div className="vazio">Nenhuma regra definida ainda.</div> : (
          <div className="tabela"><table style={{ minWidth: 0 }}>
            <thead><tr><th>Vendedora</th><th>Desde</th><th>Regra</th><th>Definida por</th></tr></thead>
            <tbody>{d.regras.map((r) => (
              <tr key={r.vendedora_id + r.vigente_desde}>
                <td>{r.vendedora}</td>
                <td>{nomeMes(r.vigente_desde)}</td>
                <td>{Number(r.percentual).toLocaleString("pt-BR")}% {BASE_COMISSAO[r.base]}{r.observacao && <div className="pequeno suave">{r.observacao}</div>}</td>
                <td className="pequeno suave">{r.quem ?? "—"} · {data(r.definido_em)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
