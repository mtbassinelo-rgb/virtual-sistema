import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, hojeISO } from "@/lib/formato";
import { Selo } from "../avisos";
import { AbasRH, PAIS, TIPO_DATA, dia, diasAte } from "./comum";

export const metadata = { title: "RH" };

type S = { id: string; nome: string; cargo: string | null; pais: string; ativo: boolean; salario: string | null; moeda: "GS" | "BRL";
  ferias_limite: string | null; saldo_ferias: number; de_ferias: boolean; proximas_ferias: string | null; fim_experiencia: string;
  tipo_contrato: string; proximo_aniversario: string | null; proximo_aniversario_casa: string; anos_casa: number; idade: number | null; dia_pagamento: number | null };
type O = { id: string; quando: string; pais: string; nome: string; tipo: string; dica: string | null };

export default async function PainelRH() {
  const u = await exigirUsuario();
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono acessa o RH.</div>;
  const hoje = hojeISO();
  const d = await comUsuario(u.id, async (c) => ({
    s: (await c.query("select * from app.v_rh_funcionarios where ativo order by nome")).rows as S[],
    datas: (await c.query("select * from app.calendario_comercial(current_date, current_date + 30) order by quando")).rows as O[],
  }));
  const em = (x: string | null, n: number) => { const v = diasAte(x, hoje); return v !== null && v >= 0 && v <= n; };

  const vencidas = d.s.filter((s) => (diasAte(s.ferias_limite, hoje) ?? 1) < 0);
  const vencendo = d.s.filter((s) => em(s.ferias_limite, 90));
  const experiencia = d.s.filter((s) => em(s.fim_experiencia, 30));
  const aniversarios = d.s.filter((s) => em(s.proximo_aniversario, 30)).sort((a, b) => (a.proximo_aniversario ?? "").localeCompare(b.proximo_aniversario ?? ""));
  const casa = d.s.filter((s) => em(s.proximo_aniversario_casa, 30));
  const deFerias = d.s.filter((s) => s.de_ferias);
  const proxFerias = d.s.filter((s) => em(s.proximas_ferias, 30));
  const folha = d.s.reduce<Record<string, number>>((a, s) => { if (s.salario) a[s.moeda] = (a[s.moeda] ?? 0) + Number(s.salario); return a; }, {});
  const alertas = vencidas.length + vencendo.length + experiencia.length;

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>RH</h1>
          <p>O que pede atenção na equipe: férias, fim de experiência, aniversários e as datas comerciais que estão chegando.</p>
        </div>
        <Link className="botao principal" href="/rh/funcionarios/novo">Novo funcionário</Link>
      </section>
      <AbasRH atual="painel" />

      <div className="indicadores">
        <div className="indicador"><span className="rotulo">Funcionários ativos</span><span className="valor num">{d.s.length}</span></div>
        <div className="indicador"><span className="rotulo">Folha mensal</span><span className="valor num">{dinheiro(folha.BRL ?? 0, "BRL")}</span>
          {folha.GS ? <span className="pequeno suave">+ {dinheiro(folha.GS, "GS")}</span> : null}</div>
        <div className="indicador"><span className="rotulo">Alertas</span><span className="valor num">{alertas}</span></div>
        <div className="indicador"><span className="rotulo">De férias hoje</span><span className="valor num">{deFerias.length}</span></div>
      </div>

      {d.s.length === 0 && (
        <section className="painel"><div className="vazio">Nenhum funcionário cadastrado ainda. <Link href="/rh/funcionarios/novo">Cadastre a equipe</Link> para ver férias, aniversários e alertas aqui.</div></section>
      )}

      {alertas > 0 && (
        <section className="painel" style={{ borderColor: "#e0b04a", background: "#fffaf0" }}>
          <h2 style={{ margin: 0 }}>Precisa de atenção</h2>
          <ul style={{ margin: 0 }}>
            {vencidas.map((s) => <li key={"v" + s.id}><Selo cor="erro">férias vencidas</Selo> <Link href={`/rh/funcionarios/${s.id}#ferias`}><b>{s.nome}</b></Link>: prazo era {dia(s.ferias_limite)} · {s.saldo_ferias} dia(s) a tirar</li>)}
            {vencendo.map((s) => <li key={"f" + s.id}><Selo cor="aviso">férias</Selo> <Link href={`/rh/funcionarios/${s.id}#ferias`}><b>{s.nome}</b></Link>: tirar até {dia(s.ferias_limite)} ({diasAte(s.ferias_limite, hoje)} dias) · {s.saldo_ferias} dia(s) a tirar</li>)}
            {experiencia.map((s) => <li key={"e" + s.id}><Selo cor="aviso">experiência</Selo> <Link href={`/rh/funcionarios/${s.id}`}><b>{s.nome}</b></Link>: período de experiência termina em {dia(s.fim_experiencia)} ({PAIS[s.pais] === "Brasil" ? "90" : "30"} dias). Decida se efetiva.</li>)}
          </ul>
        </section>
      )}

      <div className="duas-colunas">
        <div className="coluna">
          <section className="painel">
            <div className="linha entre"><h2 style={{ margin: 0 }}>Aniversários nos próximos 30 dias</h2><Link href="/rh/aniversariantes">Ver o mês</Link></div>
            {aniversarios.length + casa.length === 0 ? <div className="vazio">Nenhum aniversário nos próximos 30 dias.</div> : (
              <ul style={{ margin: 0 }}>
                {aniversarios.map((s) => <li key={"a" + s.id}><b>{dia(s.proximo_aniversario).slice(0, 5)}</b> · <Link href={`/rh/funcionarios/${s.id}`}>{s.nome}</Link>
                  {s.idade !== null && <span className="suave"> ({diasAte(s.proximo_aniversario, hoje) === 0 ? s.idade : s.idade + 1} anos)</span>}{diasAte(s.proximo_aniversario, hoje) === 0 && <> <Selo cor="marca">hoje!</Selo></>}</li>)}
                {casa.map((s) => <li key={"c" + s.id}><b>{dia(s.proximo_aniversario_casa).slice(0, 5)}</b> · <Link href={`/rh/funcionarios/${s.id}`}>{s.nome}</Link>
                  <span className="suave"> completa {s.anos_casa + 1} {s.anos_casa + 1 === 1 ? "ano" : "anos"} de empresa</span></li>)}
              </ul>
            )}
          </section>
          <section className="painel">
            <div className="linha entre"><h2 style={{ margin: 0 }}>Férias</h2><Link href="/rh/ferias">Ver todas</Link></div>
            {deFerias.length + proxFerias.length === 0 ? <div className="vazio">Ninguém de férias agora nem nos próximos 30 dias.</div> : (
              <ul style={{ margin: 0 }}>
                {deFerias.map((s) => <li key={"d" + s.id}><Selo cor="info">de férias</Selo> {s.nome}</li>)}
                {proxFerias.map((s) => <li key={"p" + s.id}>{s.nome}: começa em {dia(s.proximas_ferias)}</li>)}
              </ul>
            )}
          </section>
        </div>
        <div className="coluna">
          <section className="painel">
            <div className="linha entre"><h2 style={{ margin: 0 }}>Datas dos próximos 30 dias</h2><Link href="/calendario">Calendário completo</Link></div>
            {d.datas.length === 0 ? <div className="vazio">Nenhuma data cadastrada nos próximos 30 dias.</div> : (
              <ul style={{ margin: 0 }}>
                {d.datas.map((o) => <li key={o.id + o.quando}><b>{dia(o.quando).slice(0, 5)}</b> · {o.nome} <span className="pequeno suave">({PAIS[o.pais]} · {TIPO_DATA[o.tipo]})</span>
                  {o.dica && <div className="pequeno suave">{o.dica}</div>}</li>)}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
