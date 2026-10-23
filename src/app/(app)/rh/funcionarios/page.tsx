import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, hojeISO, type Moeda } from "@/lib/formato";
import { Avisos, Selo } from "../../avisos";
import { AbasRH, PAIS, TIPO_CONTRATO, dia, diaMes, diasAte, tempoCasa } from "../comum";

export const metadata = { title: "Funcionários" };

type F = {
  id: string; nome: string; cargo: string | null; pais: string; unidade: string | null; tipo_contrato: string; salario: string | null; moeda: Moeda;
  data_admissao: string; data_desligamento: string | null; ativo: boolean; dias_casa: number; idade: number | null; proximo_aniversario: string | null;
  saldo_ferias: number; ferias_limite: string | null; de_ferias: boolean; proximas_ferias: string | null; whatsapp: string | null;
  fim_experiencia: string; comissao_regra: string | null;
};

const ORDENS: Record<string, { t: string; sql: string }> = {
  nome: { t: "Nome (A–Z)", sql: "f.nome" },
  salario_maior: { t: "Maior salário", sql: "f.salario desc nulls last, f.nome" },
  salario_menor: { t: "Menor salário", sql: "f.salario asc nulls last, f.nome" },
  admissao: { t: "Mais antigos na empresa", sql: "f.data_admissao, f.nome" },
  recentes: { t: "Contratados mais recentes", sql: "f.data_admissao desc, f.nome" },
  aniversario: { t: "Próximo aniversário", sql: "f.proximo_aniversario nulls last, f.nome" },
  ferias: { t: "Mais dias de férias a tirar", sql: "f.saldo_ferias desc, f.nome" },
};

export default async function Funcionarios({ searchParams }: {
  searchParams: Promise<{ ok?: string; erro?: string; q?: string; unidade?: string; pais?: string; situacao?: string; contrato?: string; ordem?: string }>;
}) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono acessa o RH.</div>;
  const f = await searchParams;
  const ordem = ORDENS[f.ordem ?? ""] ? f.ordem! : "nome";
  const situacao = f.situacao === "desligados" || f.situacao === "todos" ? f.situacao : "ativos";
  const hoje = hojeISO();

  const d = await comUsuario(u.id, async (c) => {
    const cond: string[] = []; const par: unknown[] = [];
    const add = (sql: string, v: unknown) => { par.push(v); cond.push(sql.replace("?", `$${par.length}`)); };
    if (situacao === "ativos") cond.push("f.ativo");
    if (situacao === "desligados") cond.push("not f.ativo");
    if (f.q?.trim()) add("(f.nome ilike ? or f.cargo ilike $" + (par.length + 1) + ")", `%${f.q.trim()}%`);
    if (f.unidade) add("f.deposito_id = ?::uuid", f.unidade);
    if (f.pais === "BR" || f.pais === "PY") add("f.pais = ?::app.pais", f.pais);
    if (f.contrato && TIPO_CONTRATO[f.contrato]) add("f.tipo_contrato = ?", f.contrato);
    const lista = (await c.query(
      `select f.*, d.nome as unidade,
              (select r.percentual::text || '% sobre ' || r.base from app.comissao_regras r
                where r.vendedora_id = f.vendedora_id and r.vigente_desde <= current_date order by r.vigente_desde desc limit 1) as comissao_regra
         from app.v_rh_funcionarios f left join app.depositos d on d.id = f.deposito_id
        ${cond.length ? "where " + cond.join(" and ") : ""}
        order by ${ORDENS[ordem].sql}`, par)).rows as F[];
    const unidades = (await c.query("select id, nome from app.depositos where ativo order by tipo, nome")).rows as { id: string; nome: string }[];
    return { lista, unidades };
  });

  const folha = d.lista.filter((x) => x.ativo).reduce<Record<string, number>>((acc, x) => {
    if (x.salario) acc[x.moeda] = (acc[x.moeda] ?? 0) + Number(x.salario);
    return acc;
  }, {});

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Funcionários</h1>
          <p>Cadastro da equipe: cargo, unidade, contrato, salário, comissão, férias e contatos. Só gerente e dono veem esta área.</p>
        </div>
        <Link className="botao principal" href="/rh/funcionarios/novo">Novo funcionário</Link>
      </section>
      <AbasRH atual="funcionarios" />
      <Avisos ok={f.ok} erro={f.erro} />

      <form className="painel filtros" method="get">
        <label>Buscar<input name="q" defaultValue={f.q ?? ""} placeholder="Nome ou cargo" /></label>
        <label>Unidade<select name="unidade" defaultValue={f.unidade ?? ""}>
          <option value="">Todas</option>{d.unidades.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </select></label>
        <label>País<select name="pais" defaultValue={f.pais ?? ""}>
          <option value="">Todos</option><option value="BR">Brasil</option><option value="PY">Paraguai</option>
        </select></label>
        <label>Contrato<select name="contrato" defaultValue={f.contrato ?? ""}>
          <option value="">Todos</option>{Object.entries(TIPO_CONTRATO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select></label>
        <label>Situação<select name="situacao" defaultValue={situacao}>
          <option value="ativos">Ativos</option><option value="desligados">Desligados</option><option value="todos">Todos</option>
        </select></label>
        <label>Ordenar por<select name="ordem" defaultValue={ordem}>
          {Object.entries(ORDENS).map(([k, o]) => <option key={k} value={k}>{o.t}</option>)}
        </select></label>
        <button className="principal">Filtrar</button>
      </form>

      <div className="indicadores">
        <div className="indicador"><span className="rotulo">Funcionários na lista</span><span className="valor num">{d.lista.length}</span></div>
        <div className="indicador"><span className="rotulo">Folha (ativos, R$)</span><span className="valor num">{dinheiro(folha.BRL ?? 0, "BRL")}</span></div>
        <div className="indicador"><span className="rotulo">Folha (ativos, Gs)</span><span className="valor num">{dinheiro(folha.GS ?? 0, "GS")}</span></div>
        <div className="indicador"><span className="rotulo">De férias hoje</span><span className="valor num">{d.lista.filter((x) => x.de_ferias).length}</span></div>
      </div>

      <section className="painel">
        {d.lista.length === 0 ? (
          <div className="vazio">Nenhum funcionário {situacao === "ativos" ? "ativo " : ""}cadastrado com esses filtros. <Link href="/rh/funcionarios/novo">Cadastrar o primeiro</Link>.</div>
        ) : (
          <div className="tabela"><table>
            <thead><tr><th>Funcionário</th><th>Unidade</th><th>Contrato</th><th className="num">Salário</th><th>Comissão</th><th>Na empresa</th><th>Aniversário</th><th>Férias</th></tr></thead>
            <tbody>{d.lista.map((x) => {
              const lim = diasAte(x.ferias_limite, hoje);
              const exp = diasAte(x.fim_experiencia, hoje);
              return (
                <tr key={x.id}>
                  <td><Link href={`/rh/funcionarios/${x.id}`}><b>{x.nome}</b></Link>
                    <div className="pequeno suave">{x.cargo ?? "—"} · {PAIS[x.pais]}</div>
                    {!x.ativo && <Selo cor="erro">desligado em {dia(x.data_desligamento)}</Selo>}</td>
                  <td>{x.unidade ?? "—"}</td>
                  <td className="pequeno">{TIPO_CONTRATO[x.tipo_contrato] ?? x.tipo_contrato}
                    {x.ativo && exp !== null && exp >= 0 && exp <= 30 && <div><Selo cor="aviso">experiência termina {dia(x.fim_experiencia)}</Selo></div>}</td>
                  <td className="num">{x.salario ? dinheiro(x.salario, x.moeda) : "—"}</td>
                  <td className="pequeno">{x.comissao_regra ?? "—"}</td>
                  <td className="pequeno">{tempoCasa(x.dias_casa)}<div className="suave">desde {dia(x.data_admissao)}</div></td>
                  <td className="pequeno">{x.proximo_aniversario ? <>{diaMes(x.proximo_aniversario)}{x.idade !== null && <span className="suave"> · {x.idade} anos</span>}</> : "—"}</td>
                  <td className="pequeno">
                    {x.de_ferias ? <Selo cor="info">de férias</Selo> : <>saldo {x.saldo_ferias} dia(s)</>}
                    {x.ativo && lim !== null && lim < 0 && <div><Selo cor="erro">vencidas desde {dia(x.ferias_limite)}</Selo></div>}
                    {x.ativo && lim !== null && lim >= 0 && lim <= 90 && <div><Selo cor="aviso">tirar até {dia(x.ferias_limite)}</Selo></div>}
                    {x.proximas_ferias && <div className="suave">próximas: {dia(x.proximas_ferias)}</div>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
