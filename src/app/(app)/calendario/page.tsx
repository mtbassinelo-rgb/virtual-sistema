import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { hojeISO } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import { AbasRH, MESES, PAIS, TIPO_DATA, dia, diasAte } from "../rh/comum";
import { desativarData, salvarData } from "./acoes";

export const metadata = { title: "Calendário comercial" };

type O = { id: string; quando: string; pais: string; nome: string; tipo: string; dica: string | null; produtos: string | null; antecedencia: number; fixa: boolean };
const COR: Record<string, string> = { feriado: "erro", comemorativa: "marca", evento: "info" };
const BANDEIRA: Record<string, string> = { BR: "🇧🇷", PY: "🇵🇾", AMBOS: "🇧🇷🇵🇾" };

export default async function Calendario({ searchParams }: {
  searchParams: Promise<{ ok?: string; erro?: string; mes?: string; pais?: string; tipo?: string; editar?: string }>;
}) {
  const u = await exigirUsuario();
  const gestao = ehGestao(u);
  const f = await searchParams;
  const hoje = hojeISO();
  const [anoHoje, mesHoje] = hoje.split("-").map(Number);
  // mes = "AAAA-MM"
  const m = /^\d{4}-\d{2}$/.test(f.mes ?? "") ? f.mes! : `${anoHoje}-${String(mesHoje).padStart(2, "0")}`;
  const [ano, mes] = m.split("-").map(Number);
  const de = `${m}-01`;
  const ate = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
  const ant = new Date(Date.UTC(ano, mes - 2, 1)).toISOString().slice(0, 7);
  const prox = new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 7);
  const pais = f.pais === "BR" || f.pais === "PY" ? f.pais : "";
  const tipo = TIPO_DATA[f.tipo ?? ""] ? f.tipo! : "";

  const d = await comUsuario(u.id, async (c) => {
    const filtro = (rows: O[]) => rows.filter((o) => (!pais || o.pais === pais || o.pais === "AMBOS") && (!tipo || o.tipo === tipo));
    const doMes = filtro((await c.query("select * from app.calendario_comercial($1, $2) order by quando, nome", [de, ate])).rows as O[]);
    // campanhas para começar já: datas dos próximos 60 dias cuja antecedência já chegou
    const proximas = filtro((await c.query("select * from app.calendario_comercial(current_date, current_date + 60) order by quando", [])).rows as O[])
      .filter((o) => (diasAte(o.quando, hoje) ?? 99) <= o.antecedencia && o.tipo !== "feriado");
    const editar = gestao && /^[0-9a-f-]{36}$/i.test(f.editar ?? "")
      ? (await c.query("select * from app.datas_comerciais where id = $1", [f.editar])).rows[0] : null;
    return { doMes, proximas, editar };
  });
  const e = d.editar;
  const dataEditar = e ? (e.data ? String(e.data).slice(0, 10) : `${ano}-${String(e.mes).padStart(2, "0")}-${String(e.dia).padStart(2, "0")}`) : "";

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Calendário comercial</h1>
          <p>Feriados e datas comemorativas do Brasil e do Paraguai, com dicas do que oferecer, e os eventos que vamos trabalhar no mês.</p>
        </div>
      </section>
      {gestao && <AbasRH atual="calendario" />}
      <Avisos ok={f.ok} erro={f.erro} />

      {d.proximas.length > 0 && (
        <section className="painel" style={{ borderColor: "var(--marca)" }}>
          <h2 style={{ margin: 0 }}>Hora de preparar a campanha</h2>
          <p className="suave pequeno" style={{ margin: 0 }}>Datas que se aproximam e já entraram no prazo de preparação (estoque, kits, mensagens para clientes).</p>
          <div className="tabela"><table>
            <thead><tr><th>Data</th><th>O quê</th><th>Faltam</th><th>Dica</th></tr></thead>
            <tbody>{d.proximas.map((o) => (
              <tr key={o.id + o.quando}>
                <td className="num">{dia(o.quando).slice(0, 5)}</td>
                <td><b>{BANDEIRA[o.pais]} {o.nome}</b></td>
                <td className="num">{diasAte(o.quando, hoje)} dia(s)</td>
                <td className="pequeno">{o.dica}{o.produtos && <div><b>Oferecer:</b> {o.produtos}</div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}

      <form className="painel filtros" method="get">
        <label>Mês<input type="month" name="mes" defaultValue={m} /></label>
        <label>País<select name="pais" defaultValue={pais}><option value="">Brasil e Paraguai</option><option value="BR">Brasil</option><option value="PY">Paraguai</option></select></label>
        <label>Tipo<select name="tipo" defaultValue={tipo}><option value="">Todos</option>
          {Object.entries(TIPO_DATA).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
        <button className="principal">Filtrar</button>
      </form>

      <section className="painel">
        <div className="linha entre">
          <Link className="botao" href={`/calendario?mes=${ant}${pais ? `&pais=${pais}` : ""}${tipo ? `&tipo=${tipo}` : ""}`}>← {MESES[Number(ant.slice(5)) - 1]}</Link>
          <h2 style={{ margin: 0, textTransform: "capitalize" }}>{MESES[mes - 1]} de {ano}</h2>
          <Link className="botao" href={`/calendario?mes=${prox}${pais ? `&pais=${pais}` : ""}${tipo ? `&tipo=${tipo}` : ""}`}>{MESES[Number(prox.slice(5)) - 1]} →</Link>
        </div>
        {d.doMes.length === 0 ? <div className="vazio">Nenhuma data neste mês com esses filtros.</div> : (
          <div className="tabela"><table>
            <thead><tr><th>Dia</th><th>Data</th><th>País</th><th>Tipo</th><th>Dica de vendas</th>{gestao && <th></th>}</tr></thead>
            <tbody>{d.doMes.map((o) => {
              const falta = diasAte(o.quando, hoje) ?? 0;
              return (
                <tr key={o.id + o.quando} style={falta < 0 ? { opacity: 0.6 } : undefined}>
                  <td className="num"><b>{dia(o.quando).slice(0, 5)}</b>
                    <div className="pequeno suave">{new Date(o.quando + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" })}</div>
                    {falta === 0 && <Selo cor="marca">hoje</Selo>}</td>
                  <td><b>{o.nome}</b></td>
                  <td>{BANDEIRA[o.pais]} <span className="pequeno">{PAIS[o.pais]}</span></td>
                  <td><Selo cor={COR[o.tipo]}>{TIPO_DATA[o.tipo]}</Selo></td>
                  <td className="pequeno">{o.dica ?? "—"}{o.produtos && <div><b>Oferecer:</b> {o.produtos}</div>}
                    <div className="suave">preparar {o.antecedencia} dia(s) antes</div></td>
                  {gestao && <td className="linha" style={{ flexWrap: "nowrap" }}>
                    <Link className="botao discreto" href={`/calendario?mes=${m}&editar=${o.id}#editar`}>Editar</Link>
                    <form action={desativarData}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="mes_volta" value={m} />
                      <button className="discreto">Remover</button></form>
                  </td>}
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>

      {gestao && (
        <form action={salvarData} className="painel campos" id="editar">
          <h2 className="largo" style={{ margin: 0 }}>{e ? `Editar: ${e.nome}` : "Acrescentar data ou evento do mês"}</h2>
          <input type="hidden" name="id" value={e?.id ?? ""} />
          <input type="hidden" name="mes_volta" value={m} />
          <label className="largo">Nome<input name="nome" required defaultValue={e?.nome ?? ""} placeholder="Ex.: Feira de beleza em CDE, live na Shopee, aniversário da loja" /></label>
          <label>Data<input type="date" name="data" required defaultValue={dataEditar} /></label>
          <label className="linha" style={{ gap: 6, alignSelf: "end" }}><input type="checkbox" name="repete" defaultChecked={e ? !e.data : false} /> Repete todo ano neste dia</label>
          <label>País<select name="pais" defaultValue={e?.pais ?? "AMBOS"}><option value="AMBOS">Brasil e Paraguai</option><option value="BR">Brasil</option><option value="PY">Paraguai</option></select></label>
          <label>Tipo<select name="tipo" defaultValue={e?.tipo ?? "evento"}>{Object.entries(TIPO_DATA).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
          <label>Preparar quantos dias antes<input name="antecedencia" inputMode="numeric" defaultValue={e?.antecedencia ?? 15} /></label>
          <label className="largo">Dica de vendas<textarea name="dica" rows={2} defaultValue={e?.dica ?? ""} placeholder="O que fazer: promoção, kit, mensagem para os clientes…" /></label>
          <label className="largo">O que oferecer<input name="produtos" defaultValue={e?.produtos ?? ""} placeholder="Ex.: perfumes, kits presente, linha masculina" /></label>
          <div className="linha largo">
            <button className="principal">{e ? "Salvar alterações" : "Acrescentar"}</button>
            {e && <Link className="botao" href={`/calendario?mes=${m}`}>Cancelar</Link>}
          </div>
          <p className="pequeno suave largo" style={{ margin: 0 }}>Datas móveis (Carnaval, Páscoa, Dia das Mães no Brasil etc.) estão cadastradas para 2026 e 2027; para os anos seguintes, acrescente aqui sem marcar &quot;repete todo ano&quot;. Feriados que o Paraguai traslada para segunda-feira podem mudar a cada ano.</p>
        </form>
      )}
    </>
  );
}
