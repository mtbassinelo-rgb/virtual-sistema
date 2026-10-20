import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { PERFIS } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import { ativarPessoa, salvarAcessos, salvarUnidadesVendedora } from "./acoes";
import { PERMISSOES, pode, permitidaParaPerfil, soDono } from "@/lib/permissoes";
import { BotaoLinkSenha, NovaPessoa } from "./formularios";

export const metadata = { title: "Equipe" };

type Pessoa = { id: string; nome: string; email: string; perfil: string; ativo: boolean; tem_senha: boolean; vendedora: string | null;
  link_pendente: string | null; ultimo_acesso: string | null };

const data = (d: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }) : "");

export default async function Equipe({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono cuida da equipe. Para trocar a sua senha, use Minha conta.</div>;
  const d = await comUsuario(u.id, async (c) => ({
    pessoas: (await c.query("select * from app.equipe()")).rows as Pessoa[],
    vendedoras: (await c.query("select id, nome, slug from app.vendedoras where nome <> 'Marketplace' order by nome")).rows as { id: string; nome: string; slug: string | null }[],
    depositos: (await c.query("select id, nome from app.depositos where ativo order by tipo, nome")).rows as { id: string; nome: string }[],
    vinculos: (await c.query("select vendedora_id, deposito_id, padrao from app.vendedora_depositos")).rows as { vendedora_id: string; deposito_id: string; padrao: boolean }[],
    acessos: (await c.query("select * from app.acessos_equipe()")).rows as { usuario_id: string; permissoes: Record<string, boolean>; horarios: { dia: number; inicio: string; fim: string }[]; depositos: string[] }[],
  }));
  const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const editaveis = d.pessoas.filter((p) => p.ativo && p.id !== u.id && p.perfil !== "dono");
  return (
    <>
      <section>
        <h1>Equipe</h1>
        <p className="suave" style={{ margin: 0, maxWidth: 760 }}>
          Quem entra no sistema. Ninguém vê a senha de ninguém: para dar acesso ou quando alguém esquecer a senha, gere um link
          e mande só para a pessoa. Ela mesma cria a senha (o link vale 72 horas, uma única vez). Cada um troca a própria senha em <b>Minha conta</b>.
        </p>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />
      <div className="tabela"><table>
        <thead><tr><th>Pessoa</th><th>Perfil</th><th>Situação</th><th>Acesso</th><th></th></tr></thead>
        <tbody>{d.pessoas.map((p) => (
          <tr key={p.id}>
            <td><b>{p.nome}</b><div className="pequeno suave">{p.email}</div></td>
            <td>{PERFIS[p.perfil] ?? p.perfil}{p.vendedora && <div className="pequeno suave">{p.vendedora}</div>}</td>
            <td>
              {!p.ativo ? <Selo cor="erro">desativado</Selo>
                : p.tem_senha ? <Selo cor="ok">senha criada</Selo> : <Selo cor="aviso">ainda não entrou</Selo>}
              {p.link_pendente && <div className="pequeno suave">link vale até {data(p.link_pendente)}</div>}
              {p.ultimo_acesso && <div className="pequeno suave">último acesso {data(p.ultimo_acesso)}</div>}
            </td>
            <td style={{ minWidth: 220 }}>{p.ativo && <BotaoLinkSenha id={p.id} nome={p.nome} temSenha={p.tem_senha} />}</td>
            <td>
              {p.id !== u.id && (
                <form action={ativarPessoa}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="ativo" value={p.ativo ? "0" : "1"} />
                  <button className={p.ativo ? "discreto" : ""}>{p.ativo ? "Desativar" : "Reativar"}</button>
                </form>
              )}
            </td>
          </tr>
        ))}</tbody>
      </table></div>
      <NovaPessoa dono={u.perfil === "dono"} vendedoras={d.vendedoras} />

      <section className="painel" id="acessos">
        <h2 style={{ margin: 0 }}>Acessos e horários</h2>
        <p className="suave pequeno" style={{ margin: 0, maxWidth: 820 }}>
          Para cada pessoa: quais áreas do sistema ela usa, em que dias e horários pode entrar e em quais unidades mexe no estoque e no caixa.
          Fora do horário a pessoa não consegue entrar (e quem estiver dentro sai na próxima tela). O dono tem acesso a tudo, sempre.
          Áreas marcadas <i>só gestão</i> não podem ser dadas a vendedora ou estoquista. Para bloquear de vez, use <b>Desativar</b> na tabela acima.
        </p>
        {editaveis.length === 0 && <div className="vazio">Ninguém para configurar.</div>}
        <div className="acessos-lista">{editaveis.map((p) => {
          const a = d.acessos.find((x) => x.usuario_id === p.id);
          const alvo = { perfil: p.perfil, permissoes: a?.permissoes ?? {} };
          const hs = a?.horarios ?? [];
          const resumoHorario = hs.length ? `${hs.length} dia(s) com horário` : "sem limite de horário";
          const liberadas = PERMISSOES.filter((x) => pode(alvo, x.chave)).length;
          return (
            <details key={p.id} id={`acesso-${p.id}`} className="acesso-pessoa">
              <summary><b>{p.nome}</b> <span className="suave pequeno">· {PERFIS[p.perfil] ?? p.perfil} · {liberadas} áreas · {resumoHorario}</span></summary>
              <form action={salvarAcessos} className="acesso-form-eq">
                <input type="hidden" name="usuario_id" value={p.id} />
                <fieldset>
                  <legend>Áreas do sistema</legend>
                  <div className="acesso-grade">{PERMISSOES.map((x) => {
                    const pode_ = permitidaParaPerfil(p.perfil, x.chave);
                    const bloqueadoDono = soDono(x.chave) && u.perfil !== "dono";
                    return (
                      <label key={x.chave} className={`acesso-item ${pode_ && !bloqueadoDono ? "" : "desligado"}`}>
                        <input type="checkbox" name={`perm_${x.chave}`} value="1" defaultChecked={pode(alvo, x.chave)} disabled={!pode_ || bloqueadoDono} />
                        {x.nome}{!pode_ ? <small> (só gestão)</small> : bloqueadoDono ? <small> (só o dono libera)</small> : null}
                      </label>
                    );
                  })}</div>
                </fieldset>
                <fieldset>
                  <legend>Horário de acesso</legend>
                  <label className="acesso-item"><input type="radio" name="limite" value="livre" defaultChecked={!hs.length} /> Sem limite de horário</label>
                  <label className="acesso-item"><input type="radio" name="limite" value="horario" defaultChecked={hs.length > 0} /> Só nos dias e horários marcados (horário de Foz)</label>
                  <div className="acesso-dias">{DIAS.map((nome, dia) => {
                    const h = hs.find((x) => x.dia === dia);
                    const padrao = !hs.length && dia >= 1 && dia <= 6;
                    return (
                      <div key={dia} className="acesso-dia">
                        <label><input type="checkbox" name={`dia_${dia}`} value="1" defaultChecked={Boolean(h) || padrao} /> {nome}</label>
                        <input type="time" name={`ini_${dia}`} defaultValue={h?.inicio ?? "08:00"} aria-label={`${nome}: entra a partir de`} />
                        <span className="suave">às</span>
                        <input type="time" name={`fim_${dia}`} defaultValue={h?.fim ?? (dia === 6 ? "13:00" : "18:00")} aria-label={`${nome}: até`} />
                      </div>
                    );
                  })}</div>
                </fieldset>
                <fieldset>
                  <legend>Unidades em que mexe no estoque e no caixa</legend>
                  <p className="suave pequeno" style={{ margin: "0 0 6px" }}>Para estoquista e para quem opera o caixa de uma unidade. Gerente e dono mexem em todas.</p>
                  <div className="acesso-grade">{d.depositos.map((x) => (
                    <label key={x.id} className="acesso-item"><input type="checkbox" name="dep" value={x.id} defaultChecked={a?.depositos.includes(x.id)} /> {x.nome}</label>
                  ))}</div>
                </fieldset>
                <div><button className="principal">Salvar acessos de {p.nome.split(" ")[0]}</button></div>
              </form>
            </details>
          );
        })}</div>
      </section>

      <section className="painel" id="unidades">
        <h2 style={{ margin: 0 }}>Unidades de cada vendedora</h2>
        <p className="suave pequeno" style={{ margin: 0 }}>
          Marque de quais unidades a vendedora pode separar e vender (ex.: as vendedoras de Foz também vendem do CD CDE) e qual é a padrão.
          Os clientes de uma vendedora entram no site da unidade padrão dela: clientes da vendedora de CDE veem só o estoque de CDE.
          Um cliente específico pode ter outra unidade na ficha dele (Clientes → cliente → Unidade).
        </p>
        <div className="tabela"><table>
          <thead><tr><th>Vendedora</th>{d.depositos.map((x) => <th key={x.id}>{x.nome}</th>)}<th></th></tr></thead>
          <tbody>{d.vendedoras.map((v) => {
            const meus = d.vinculos.filter((x) => x.vendedora_id === v.id);
            const form = `un-${v.id}`;
            return (
              <tr key={v.id}>
                <td><b>{v.nome}</b>{v.slug && <div className="pequeno suave">Link de vendas: distribuidoravirtualcosmeticos.com/loja/v/{v.slug}</div>}<form id={form} action={salvarUnidadesVendedora}><input type="hidden" name="vendedora_id" value={v.id} /></form></td>
                {d.depositos.map((x) => {
                  const vin = meus.find((m) => m.deposito_id === x.id);
                  return (
                    <td key={x.id}>
                      <label className="linha" style={{ gap: 6, flexDirection: "row", color: "inherit" }}>
                        <input type="checkbox" name="depositos" value={x.id} form={form} defaultChecked={Boolean(vin)} /> vende
                      </label>
                      <label className="linha" style={{ gap: 6, flexDirection: "row", color: "inherit" }}>
                        <input type="radio" name="padrao" value={x.id} form={form} defaultChecked={Boolean(vin?.padrao)} /> padrão
                      </label>
                    </td>
                  );
                })}
                <td><button form={form}>Salvar</button></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </section>
    </>
  );
}
