import Link from "next/link";
import { notFound } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, hojeISO, linkWhatsApp, type Moeda } from "@/lib/formato";
import { Avisos, Selo } from "../../../avisos";
import { adicionarFerias, removerFerias, salvarFuncionario } from "../../acoes";
import { AbasRH, PAIS, TIPO_CONTRATO, dia, diasAte, iso, tempoCasa } from "../../comum";

export const metadata = { title: "Funcionário" };

export default async function Funcionario({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono acessa o RH.</div>;
  const { id } = await params;
  const avisos = await searchParams;
  const novo = id === "novo";
  if (!novo && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const hoje = hojeISO();

  const d = await comUsuario(u.id, async (c) => {
    const f = novo ? null : (await c.query("select * from app.funcionarios where id = $1", [id])).rows[0];
    const s = novo ? null : (await c.query("select * from app.v_rh_funcionarios where id = $1", [id])).rows[0];
    const ferias = novo ? [] : (await c.query("select * from app.funcionario_ferias where funcionario_id = $1 order by inicio desc", [id])).rows;
    const regra = f?.vendedora_id ? (await c.query(
      `select percentual, base, vigente_desde from app.comissao_regras where vendedora_id = $1 and vigente_desde <= current_date
        order by vigente_desde desc limit 1`, [f.vendedora_id])).rows[0] : null;
    return {
      f, s, ferias, regra,
      unidades: (await c.query("select id, nome from app.depositos where ativo order by tipo, nome")).rows as { id: string; nome: string }[],
      usuarios: (await c.query("select id, nome, perfil from app.usuarios where ativo order by nome")).rows as { id: string; nome: string; perfil: string }[],
      vendedoras: (await c.query("select id, nome from app.vendedoras order by nome")).rows as { id: string; nome: string }[],
    };
  });
  if (!novo && !d.f) notFound();
  const f = d.f ?? {};
  const s = d.s;
  const lim = s ? diasAte(s.ferias_limite, hoje) : null;
  const zap = f.whatsapp ? linkWhatsApp(f.whatsapp, `Olá ${String(f.nome).split(" ")[0]}!`) : null;

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <Link href="/rh/funcionarios">← Funcionários</Link>
          <h1 style={{ marginTop: 4 }}>{novo ? "Novo funcionário" : f.nome}</h1>
          {s && <p className="linha pequeno">
            <span>{f.cargo ?? "Sem cargo"}</span><span>{PAIS[f.pais]}</span><span>{tempoCasa(s.dias_casa)} de empresa</span>
            {s.idade !== null && <span>{s.idade} anos</span>}
            {!s.ativo && <Selo cor="erro">desligado em {dia(f.data_desligamento)}</Selo>}
            {s.de_ferias && <Selo cor="info">de férias</Selo>}
          </p>}
        </div>
        {zap && <a className="botao whatsapp" href={zap} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
      </section>
      <AbasRH atual="funcionarios" />
      <Avisos ok={avisos.ok} erro={avisos.erro} />

      {s && s.ativo && (
        <div className="indicadores">
          <div className="indicador"><span className="rotulo">Salário</span><span className="valor num">{f.salario ? dinheiro(f.salario, f.moeda as Moeda) : "—"}</span>
            {f.dia_pagamento && <span className="pequeno suave">paga todo dia {f.dia_pagamento}</span>}</div>
          <div className="indicador"><span className="rotulo">Comissão</span>
            <span className="valor">{d.regra ? `${Number(d.regra.percentual).toLocaleString("pt-BR")}%` : f.comissao ? "combinada" : "—"}</span>
            <span className="pequeno suave">{d.regra ? `sobre ${d.regra.base} · ` : ""}{f.comissao ?? ""}{d.regra && <Link href="/comissoes"> ver comissões</Link>}</span></div>
          <div className="indicador"><span className="rotulo">Férias a tirar</span><span className="valor num">{s.saldo_ferias} dia(s)</span>
            <span className="pequeno suave">{s.dias_ferias_ano} dias por ano · próximo período em {dia(s.proximo_periodo_em)}</span></div>
          <div className="indicador"><span className="rotulo">Prazo das férias</span>
            <span className="valor">{s.ferias_limite ? dia(s.ferias_limite) : "—"}</span>
            {lim !== null && lim < 0 && <Selo cor="erro">vencidas</Selo>}
            {lim !== null && lim >= 0 && lim <= 90 && <Selo cor="aviso">faltam {lim} dias</Selo>}</div>
          <div className="indicador"><span className="rotulo">Aniversário</span><span className="valor">{s.proximo_aniversario ? dia(s.proximo_aniversario).slice(0, 5) : "—"}</span>
            <span className="pequeno suave">empresa: {dia(s.proximo_aniversario_casa).slice(0, 5)}</span></div>
        </div>
      )}

      <form action={salvarFuncionario} className="painel campos">
        <input type="hidden" name="id" value={novo ? "" : id} />
        <h2 className="largo" style={{ margin: 0 }}>Dados pessoais</h2>
        <label className="largo">Nome completo<input name="nome" required defaultValue={f.nome ?? ""} /></label>
        <label>Data de nascimento<input type="date" name="data_nascimento" defaultValue={iso(f.data_nascimento)} /></label>
        <label>Documento (CPF / Cédula)<input name="documento" defaultValue={f.documento ?? ""} /></label>
        <label>WhatsApp<input name="whatsapp" inputMode="tel" defaultValue={f.whatsapp ?? ""} placeholder="Com DDI: 55… ou 595…" /></label>
        <label>E-mail<input type="email" name="email" defaultValue={f.email ?? ""} /></label>
        <label className="largo">Endereço<input name="endereco" defaultValue={f.endereco ?? ""} /></label>
        <label className="largo">Contato de emergência<input name="contato_emergencia" defaultValue={f.contato_emergencia ?? ""} placeholder="Nome, parentesco e telefone" /></label>

        <h2 className="largo" style={{ margin: "12px 0 0" }}>Trabalho</h2>
        <label>Cargo<input name="cargo" defaultValue={f.cargo ?? ""} placeholder="Ex.: vendedora, estoquista, caixa" /></label>
        <label>País do contrato<select name="pais" defaultValue={f.pais ?? "BR"}>
          <option value="BR">Brasil</option><option value="PY">Paraguai</option></select></label>
        <label>Unidade<select name="deposito_id" defaultValue={f.deposito_id ?? ""}>
          <option value="">—</option>{d.unidades.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
        <label>Tipo de contrato<select name="tipo_contrato" defaultValue={f.tipo_contrato ?? "clt"}>
          {Object.entries(TIPO_CONTRATO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
        <label>Data de admissão<input type="date" name="data_admissao" required defaultValue={iso(f.data_admissao)} /></label>
        <label>Jornada<input name="jornada" defaultValue={f.jornada ?? ""} placeholder="Ex.: seg a sex 8h–18h, sáb 8h–12h" /></label>
        <label>Acesso ao sistema<select name="usuario_id" defaultValue={f.usuario_id ?? ""}>
          <option value="">Não tem / não ligar</option>{d.usuarios.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
        <label>Vendedora (para a comissão)<select name="vendedora_id" defaultValue={f.vendedora_id ?? ""}>
          <option value="">Não é vendedora</option>{d.vendedoras.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>

        <h2 className="largo" style={{ margin: "12px 0 0" }}>Remuneração</h2>
        <label>Salário<input name="salario" inputMode="decimal" defaultValue={f.salario ? Number(f.salario) : ""} /></label>
        <label>Moeda<select name="moeda" defaultValue={f.moeda ?? "BRL"}><option value="BRL">R$</option><option value="GS">Gs</option></select></label>
        <label>Dia do pagamento<input name="dia_pagamento" inputMode="numeric" defaultValue={f.dia_pagamento ?? ""} placeholder="Ex.: 5" /></label>
        <label className="largo">Comissão combinada<input name="comissao" defaultValue={f.comissao ?? ""}
          placeholder={d.regra ? "A regra da vendedora já vem da tela Comissões; use para observações" : "Ex.: 2% sobre vendas da loja"} /></label>
        <label className="largo">Benefícios<input name="beneficios" defaultValue={f.beneficios ?? ""} placeholder="Ex.: vale-transporte, almoço, plano de saúde" /></label>
        <label className="largo">Dados para pagamento<input name="dados_pagamento" defaultValue={f.dados_pagamento ?? ""} placeholder="PIX ou conta" /></label>

        <h2 className="largo" style={{ margin: "12px 0 0" }}>Férias e desligamento</h2>
        <label>Dias de férias já tirados antes do sistema<input name="ferias_anteriores" inputMode="numeric" defaultValue={f.ferias_anteriores ?? 0} /></label>
        <label>Data de desligamento<input type="date" name="data_desligamento" defaultValue={iso(f.data_desligamento)} /></label>
        <label className="largo">Motivo do desligamento<input name="motivo_desligamento" defaultValue={f.motivo_desligamento ?? ""} /></label>
        <label className="largo">Observações<textarea name="observacoes" rows={3} defaultValue={f.observacoes ?? ""} /></label>
        <button className="principal">{novo ? "Cadastrar funcionário" : "Salvar alterações"}</button>
        <p className="pequeno suave largo" style={{ margin: 0 }}>
          Férias por ano: Brasil (CLT) 30 dias; Paraguai 12 dias até 5 anos, 18 dias de 5 a 10 anos e 30 dias acima de 10 anos.
          O prazo mostrado é de 12 meses depois de completar cada período; confira com o contador.
        </p>
      </form>

      {!novo && (
        <section className="painel" id="ferias">
          <h2>Férias</h2>
          <form action={adicionarFerias} className="campos">
            <input type="hidden" name="funcionario_id" value={id} />
            <label>Início<input type="date" name="inicio" required /></label>
            <label>Fim<input type="date" name="fim" required /></label>
            <label className="largo">Observação<input name="observacao" placeholder="Ex.: período 2025/2026, 10 dias vendidos" /></label>
            <button className="principal">Registrar férias</button>
          </form>
          {d.ferias.length === 0 ? <div className="vazio">Nenhuma férias registrada.</div> : (
            <div className="tabela"><table>
              <thead><tr><th>Período</th><th className="num">Dias</th><th>Situação</th><th>Observação</th><th></th></tr></thead>
              <tbody>{d.ferias.map((x) => {
                const situ = x.inicio > hoje ? <Selo cor="info">programada</Selo> : x.fim >= hoje ? <Selo cor="marca">em curso</Selo> : <Selo cor="ok">tirada</Selo>;
                return (
                  <tr key={x.id}>
                    <td>{dia(x.inicio)} a {dia(x.fim)}</td><td className="num">{x.dias}</td><td>{situ}</td><td className="pequeno">{x.observacao ?? ""}</td>
                    <td><form action={removerFerias}><input type="hidden" name="funcionario_id" value={id} /><input type="hidden" name="ferias_id" value={x.id} />
                      <button className="discreto">Remover</button></form></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </section>
      )}
    </>
  );
}
