import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { PERFIS } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import { ativarPessoa, salvarUnidadesVendedora } from "./acoes";
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
    vendedoras: (await c.query("select id, nome from app.vendedoras where nome <> 'Marketplace' order by nome")).rows as { id: string; nome: string }[],
    depositos: (await c.query("select id, nome from app.depositos where ativo order by tipo, nome")).rows as { id: string; nome: string }[],
    vinculos: (await c.query("select vendedora_id, deposito_id, padrao from app.vendedora_depositos")).rows as { vendedora_id: string; deposito_id: string; padrao: boolean }[],
  }));
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
                <td><b>{v.nome}</b><form id={form} action={salvarUnidadesVendedora}><input type="hidden" name="vendedora_id" value={v.id} /></form></td>
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
