import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { data, dinheiro, hojeISO, type Moeda } from "@/lib/formato";
import { Avisos } from "../../avisos";
import { lancarVendaAvulsa, excluirVendaAvulsa } from "./acoes";

export const metadata = { title: "Vendas avulsas" };

type Linha = { id: string; unidade: string; data: string; moeda: Moeda; valor: string; custo_brl: string | null; descricao: string; quem: string | null };

export default async function VendasAvulsas({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) redirect("/");
  const f = await searchParams;
  const gerir = u.perfil === "dono" || u.perfil === "gerente";
  const d = await comUsuario(u.id, async (c) => ({
    unidades: (await c.query("select id, nome from app.depositos where ativo order by codigo = 'cd-foz' desc, nome")).rows as { id: string; nome: string }[],
    linhas: (await c.query(`select a.id, dp.nome unidade, a.data, a.moeda, a.valor, a.custo_brl, a.descricao, us.nome quem
        from app.vendas_avulsas a join app.depositos dp on dp.id = a.deposito_id left join app.usuarios us on us.id = a.criado_por
       order by a.data desc, dp.nome`)).rows as Linha[],
  }));
  const somaGs = d.linhas.filter((l) => l.moeda === "GS").reduce((s, l) => s + Number(l.valor), 0);

  return (
    <main>
      <h1>Vendas avulsas</h1>
      <p className="suave">Vendas feitas fora do sistema, lançadas só pelo valor (sem produtos, sem cliente e sem mexer no estoque).
        Entram no <b>Vendido no mês</b>, no <Link href="/unidades">Painel das unidades</Link> e no <Link href="/financeiro">Painel financeiro</Link>.
        Sem custo informado, a venda conta no faturamento mas fica fora do lucro.</p>
      <Avisos ok={f.ok} erro={f.erro} />

      {gerir && (
        <section className="painel">
          <h2>Lançar venda avulsa</h2>
          <form action={lancarVendaAvulsa} className="linha" style={{ flexWrap: "wrap", alignItems: "end", gap: 10 }}>
          <label>Unidade<select name="deposito" required>{d.unidades.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
          <label>Data<input type="date" name="data" defaultValue={hojeISO()} max={hojeISO()} required /></label>
          <label>Moeda<select name="moeda" defaultValue="GS"><option value="GS">Gs</option><option value="BRL">R$</option></select></label>
          <label>Valor<input name="valor" inputMode="decimal" placeholder="Ex.: 12.500.000" required /></label>
          <label>Custo em R$ (opcional)<input name="custo" inputMode="decimal" placeholder="Deixe vazio se não souber" /></label>
          <label style={{ flex: "1 1 320px" }}>Descrição<input name="descricao" maxLength={300} placeholder="Ex.: vendas de 01 a 06/10 pelos comprovantes" required /></label>
          <button className="principal">Lançar</button>
          </form>
        </section>
      )}

      <div className="tabela">
        <table>
          <thead><tr><th>Data</th><th>Unidade</th><th>Descrição</th><th className="num">Valor</th><th className="num">Custo</th><th>Lançado por</th>{gerir && <th></th>}</tr></thead>
          <tbody>
            {d.linhas.length === 0 && <tr><td colSpan={7} className="suave">Nenhuma venda avulsa lançada.</td></tr>}
            {d.linhas.map((l) => (
              <tr key={l.id}>
                <td>{data(l.data)}</td><td>{l.unidade}</td><td>{l.descricao}</td>
                <td className="num"><b>{dinheiro(l.valor, l.moeda)}</b></td>
                <td className="num">{l.custo_brl != null ? dinheiro(l.custo_brl, "BRL") : <span className="suave">—</span>}</td>
                <td>{l.quem ?? <span className="suave">Sistema</span>}</td>
                {gerir && <td><form action={excluirVendaAvulsa}><input type="hidden" name="id" value={l.id} /><button className="perigo">Excluir</button></form></td>}
              </tr>
            ))}
          </tbody>
          {d.linhas.length > 0 && <tfoot><tr><td colSpan={3}><b>Total em Gs</b></td><td className="num"><b>{dinheiro(somaGs, "GS")}</b></td><td colSpan={gerir ? 3 : 2}></td></tr></tfoot>}
        </table>
      </div>
    </main>
  );
}
