import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { hojeISO, linkWhatsApp } from "@/lib/formato";
import { Selo } from "../../avisos";
import { AbasRH, MESES, PAIS } from "../comum";

export const metadata = { title: "Aniversariantes" };

type A = { id: string; nome: string; cargo: string | null; pais: string; unidade: string | null; whatsapp: string | null; dia: number; anos: number; tipo: "vida" | "empresa" };

export default async function Aniversariantes({ searchParams }: { searchParams: Promise<{ mes?: string; tipo?: string; unidade?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono acessa o RH.</div>;
  const f = await searchParams;
  const hoje = hojeISO();
  const [anoHoje, mesHoje, diaHoje] = hoje.split("-").map(Number);
  const mes = Number(f.mes) >= 1 && Number(f.mes) <= 12 ? Number(f.mes) : mesHoje;
  const tipo = f.tipo === "vida" || f.tipo === "empresa" ? f.tipo : "";

  const d = await comUsuario(u.id, async (c) => ({
    lista: (await c.query(
      `select f.id, f.nome, f.cargo, f.pais, d.nome as unidade, f.whatsapp, extract(day from f.data_nascimento)::int as dia,
              ($2::int - extract(year from f.data_nascimento)::int) as anos, 'vida' as tipo
         from app.funcionarios f left join app.depositos d on d.id = f.deposito_id
        where f.data_desligamento is null and f.data_nascimento is not null and extract(month from f.data_nascimento) = $1
          and ($3::uuid is null or f.deposito_id = $3::uuid)
       union all
       select f.id, f.nome, f.cargo, f.pais, d.nome, f.whatsapp, extract(day from f.data_admissao)::int,
              ($2::int - extract(year from f.data_admissao)::int), 'empresa'
         from app.funcionarios f left join app.depositos d on d.id = f.deposito_id
        where f.data_desligamento is null and extract(month from f.data_admissao) = $1 and extract(year from f.data_admissao) < $2
          and ($3::uuid is null or f.deposito_id = $3::uuid)
        order by 7, 2`, [mes, anoHoje, /^[0-9a-f-]{36}$/i.test(f.unidade ?? "") ? f.unidade : null])).rows as A[],
    unidades: (await c.query("select id, nome from app.depositos where ativo order by tipo, nome")).rows as { id: string; nome: string }[],
  }));
  const lista = d.lista.filter((a) => !tipo || a.tipo === tipo);

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Aniversariantes de {MESES[mes - 1]}</h1>
          <p>Aniversários da equipe e tempo de empresa no mês. Um parabéns pelo WhatsApp, um bolo ou um brinde fazem diferença.</p>
        </div>
      </section>
      <AbasRH atual="aniversariantes" />

      <form className="painel filtros" method="get">
        <label>Mês<select name="mes" defaultValue={String(mes)}>{MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <label>Tipo<select name="tipo" defaultValue={tipo}><option value="">Aniversário e tempo de empresa</option>
          <option value="vida">Só aniversário</option><option value="empresa">Só tempo de empresa</option></select></label>
        <label>Unidade<select name="unidade" defaultValue={f.unidade ?? ""}><option value="">Todas</option>
          {d.unidades.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
        <button className="principal">Filtrar</button>
      </form>

      <section className="painel">
        {lista.length === 0 ? (
          <div className="vazio">Ninguém faz aniversário neste mês{d.lista.length === 0 ? " (cadastre a data de nascimento na ficha de cada funcionário)" : ""}.</div>
        ) : (
          <div className="tabela"><table>
            <thead><tr><th>Dia</th><th>Funcionário</th><th>Motivo</th><th>Unidade</th><th></th></tr></thead>
            <tbody>{lista.map((a) => {
              const ehHoje = mes === mesHoje && a.dia === diaHoje;
              const passou = mes === mesHoje && a.dia < diaHoje;
              const msg = a.tipo === "vida"
                ? `Feliz aniversário, ${a.nome.split(" ")[0]}! 🎉 Toda a equipe da Virtual Cosméticos deseja um dia maravilhoso. Obrigada por fazer parte do time!`
                : `${a.nome.split(" ")[0]}, hoje você completa ${a.anos} ${a.anos === 1 ? "ano" : "anos"} com a gente! Obrigada pela dedicação. 💜`;
              const zap = a.whatsapp ? linkWhatsApp(a.whatsapp, msg) : null;
              return (
                <tr key={a.id + a.tipo}>
                  <td className="num"><b>{String(a.dia).padStart(2, "0")}/{String(mes).padStart(2, "0")}</b>
                    {ehHoje && <div><Selo cor="marca">hoje!</Selo></div>}{passou && <div className="pequeno suave">já passou</div>}</td>
                  <td><Link href={`/rh/funcionarios/${a.id}`}><b>{a.nome}</b></Link><div className="pequeno suave">{a.cargo ?? "—"} · {PAIS[a.pais]}</div></td>
                  <td>{a.tipo === "vida" ? `Aniversário · ${a.anos} anos` : `${a.anos} ${a.anos === 1 ? "ano" : "anos"} de empresa`}</td>
                  <td>{a.unidade ?? "—"}</td>
                  <td>{zap ? <a className="botao whatsapp" href={zap} target="_blank" rel="noopener noreferrer">Parabéns no WhatsApp</a> : <span className="pequeno suave">sem WhatsApp</span>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
