import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { hojeISO } from "@/lib/formato";
import { Avisos, Selo } from "../../avisos";
import { AbasRH, PAIS, dia, diasAte } from "../comum";

export const metadata = { title: "Férias" };

type S = { id: string; nome: string; cargo: string | null; pais: string; unidade: string | null; dias_ferias_ano: number; dias_adquiridos: number;
  dias_marcados: number; saldo_ferias: number; ferias_limite: string | null; proximas_ferias: string | null; de_ferias: boolean; proximo_periodo_em: string };
type P = { id: string; funcionario_id: string; nome: string; inicio: string; fim: string; dias: number; observacao: string | null };

const ORDENS: Record<string, string> = { prazo: "Prazo mais próximo", saldo: "Mais dias a tirar", nome: "Nome (A–Z)" };

export default async function Ferias({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; situacao?: string; pais?: string; ordem?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono acessa o RH.</div>;
  const f = await searchParams;
  const hoje = hojeISO();
  const ordem = ORDENS[f.ordem ?? ""] ? f.ordem! : "prazo";
  const d = await comUsuario(u.id, async (c) => ({
    situacao: (await c.query(
      `select f.*, d.nome as unidade from app.v_rh_funcionarios f left join app.depositos d on d.id = f.deposito_id
        where f.ativo order by f.nome`)).rows as S[],
    periodos: (await c.query(
      `select x.*, f.nome from app.funcionario_ferias x join app.funcionarios f on f.id = x.funcionario_id
        where x.fim >= current_date - 90 order by x.inicio`)).rows as P[],
  }));

  const classe = (s: S) => {
    const lim = diasAte(s.ferias_limite, hoje);
    if (lim !== null && lim < 0) return "vencida";
    if (lim !== null && lim <= 90) return "vencendo";
    return "ok";
  };
  let lista = d.situacao.filter((s) => (!f.pais || s.pais === f.pais) && (!f.situacao || classe(s) === f.situacao || (f.situacao === "ferias" && s.de_ferias)));
  lista = [...lista].sort((a, b) =>
    ordem === "saldo" ? b.saldo_ferias - a.saldo_ferias
      : ordem === "nome" ? a.nome.localeCompare(b.nome)
        : (a.ferias_limite ?? "9999").localeCompare(b.ferias_limite ?? "9999"));
  const vencidas = d.situacao.filter((s) => classe(s) === "vencida").length;
  const vencendo = d.situacao.filter((s) => classe(s) === "vencendo").length;

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Férias</h1>
          <p>Quem tem férias a tirar, até quando e o que já está programado. No Brasil, férias tiradas depois do prazo podem ter de ser pagas em dobro.</p>
        </div>
      </section>
      <AbasRH atual="ferias" />
      <Avisos ok={f.ok} erro={f.erro} />

      <div className="indicadores">
        <div className="indicador"><span className="rotulo">Vencidas</span><span className="valor num">{vencidas}</span></div>
        <div className="indicador"><span className="rotulo">Vencem em 90 dias</span><span className="valor num">{vencendo}</span></div>
        <div className="indicador"><span className="rotulo">De férias hoje</span><span className="valor num">{d.situacao.filter((s) => s.de_ferias).length}</span></div>
        <div className="indicador"><span className="rotulo">Programadas</span><span className="valor num">{d.periodos.filter((p) => p.inicio > hoje).length}</span></div>
      </div>

      <form className="painel filtros" method="get">
        <label>Situação<select name="situacao" defaultValue={f.situacao ?? ""}>
          <option value="">Todas</option><option value="vencida">Vencidas</option><option value="vencendo">Vencem em 90 dias</option>
          <option value="ok">Em dia</option><option value="ferias">De férias hoje</option></select></label>
        <label>País<select name="pais" defaultValue={f.pais ?? ""}><option value="">Todos</option><option value="BR">Brasil</option><option value="PY">Paraguai</option></select></label>
        <label>Ordenar por<select name="ordem" defaultValue={ordem}>{Object.entries(ORDENS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
        <button className="principal">Filtrar</button>
      </form>

      <section className="painel">
        <h2>Saldo por funcionário</h2>
        {lista.length === 0 ? <div className="vazio">Ninguém com esses filtros. <Link href="/rh/funcionarios/novo">Cadastre a equipe</Link> para acompanhar as férias.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Funcionário</th><th className="num">Dias por ano</th><th className="num">Adquiridos</th><th className="num">Marcados</th><th className="num">A tirar</th><th>Tirar até</th><th>Próximas</th></tr></thead>
            <tbody>{lista.map((s) => {
              const c = classe(s);
              return (
                <tr key={s.id}>
                  <td><Link href={`/rh/funcionarios/${s.id}#ferias`}><b>{s.nome}</b></Link><div className="pequeno suave">{s.cargo ?? "—"} · {PAIS[s.pais]}{s.unidade ? ` · ${s.unidade}` : ""}</div></td>
                  <td className="num">{s.dias_ferias_ano}</td>
                  <td className="num">{s.dias_adquiridos}</td>
                  <td className="num">{s.dias_marcados}</td>
                  <td className="num"><b>{s.saldo_ferias}</b></td>
                  <td>{s.ferias_limite ? dia(s.ferias_limite) : <span className="suave">próximo período em {dia(s.proximo_periodo_em)}</span>}
                    {c === "vencida" && <div><Selo cor="erro">vencidas</Selo></div>}
                    {c === "vencendo" && <div><Selo cor="aviso">vence logo</Selo></div>}</td>
                  <td>{s.de_ferias ? <Selo cor="info">de férias agora</Selo> : s.proximas_ferias ? dia(s.proximas_ferias) : "—"}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>

      <section className="painel">
        <h2>Períodos marcados (em curso e próximos)</h2>
        {d.periodos.filter((p) => p.fim >= hoje).length === 0 ? <div className="vazio">Nenhuma férias programada.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Funcionário</th><th>Período</th><th className="num">Dias</th><th>Observação</th></tr></thead>
            <tbody>{d.periodos.filter((p) => p.fim >= hoje).map((p) => (
              <tr key={p.id}><td><Link href={`/rh/funcionarios/${p.funcionario_id}#ferias`}>{p.nome}</Link></td>
                <td>{dia(p.inicio)} a {dia(p.fim)} {p.inicio <= hoje && <Selo cor="marca">em curso</Selo>}</td><td className="num">{p.dias}</td><td className="pequeno">{p.observacao ?? ""}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
