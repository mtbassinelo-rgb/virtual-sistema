import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dataHora, STATUS_TRANSFERENCIA } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import {
  ajustarEstoque, cancelarTransferencia, criarTransferencia, definirKit, entradaCompra, enviarTransferencia, receberTransferencia,
} from "./acoes";

export const metadata = { title: "Estoque" };

const COR: Record<string, string> = { rascunho: "", enviada: "aviso", recebida: "ok", recebida_com_divergencia: "erro", cancelada: "" };

export default async function Estoque({ searchParams }: { searchParams: Promise<{ q?: string; situacao?: string; deposito?: string; ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const d = await comUsuario(u.id, async (c) => {
    const depositos = (await c.query(
      "select id, nome, cidade, app.pode_operar_deposito(id) as opera from app.depositos where ativo order by tipo, nome")).rows;
    const par: unknown[] = [];
    let filtro = "where produto_id not in (select kit_id from app.kit_componentes)";
    if (f.q) { par.push(`%${f.q}%`); filtro += " and (codigo ilike $1 or produto ilike $1)"; }
    const saldos = (await c.query(`select * from app.v_estoque ${filtro} order by produto, deposito`, par)).rows;
    const pendencias = ehGestao(u) ? (await c.query(
      `select e.*, p.nome as produto, d.nome as deposito, pe.numero_externo, pe.canal from app.estoque_pendencias e
         left join app.produtos p on p.id = e.produto_id left join app.depositos d on d.id = e.deposito_id
         left join app.pedidos pe on pe.id = e.pedido_id
        where e.resolvida_em is null order by e.em desc limit 100`)).rows : [];
    const kits = (await c.query(
      `select k.id, k.codigo, k.nome, string_agg(kc.quantidade::int || '× ' || c.nome, ' + ' order by c.nome) as composicao
         from app.produtos k join app.kit_componentes kc on kc.kit_id = k.id join app.produtos c on c.id = kc.componente_id
        where k.tipo = 'kit' and k.ativo group by k.id order by k.nome`)).rows;
    const transferencias = (await c.query(
      `select t.*, o.nome as origem, de.nome as destino, uc.nome as criada_nome,
              app.pode_operar_deposito(t.origem_id) as opera_origem, app.pode_operar_deposito(t.destino_id) as opera_destino,
              coalesce(json_agg(json_build_object('produto_id', i.produto_id, 'codigo', p.codigo, 'nome', p.nome,
                       'enviada', i.quantidade_enviada, 'recebida', i.quantidade_recebida) order by p.nome)
                       filter (where i.produto_id is not null), '[]') as itens
         from app.transferencias t
         join app.depositos o on o.id = t.origem_id join app.depositos de on de.id = t.destino_id
         left join app.usuarios uc on uc.id = t.criada_por
         left join app.transferencia_itens i on i.transferencia_id = t.id
         left join app.produtos p on p.id = i.produto_id
        group by t.id, o.nome, de.nome, uc.nome
        order by case t.status when 'enviada' then 0 when 'rascunho' then 1 else 2 end, t.numero desc limit 50`)).rows;
    const produtos = (await c.query("select id, codigo, nome from app.produtos where ativo order by nome")).rows;
    return { depositos, saldos, transferencias, produtos, pendencias, kits };
  });

  // Tabela: uma linha por produto, uma coluna por depósito
  type Linha = { codigo: string; nome: string; dep: Record<string, { saldo: number; aReceber: number }> };
  const porProduto = new Map<string, Linha>();
  for (const s of d.saldos) {
    const chave = String(s.produto_id);
    const p: Linha = porProduto.get(chave) ?? { codigo: String(s.codigo), nome: String(s.produto), dep: {} };
    p.dep[String(s.deposito_id)] = { saldo: Number(s.saldo), aReceber: Number(s.a_receber) };
    porProduto.set(chave, p);
  }
  // Filtro de situação: "zerado" = sem estoque; "com" = com estoque. Com um depósito escolhido,
  // vale o saldo daquele depósito; sem depósito, vale o total de todos.
  const situacao = f.situacao === "zerado" || f.situacao === "com" ? f.situacao : "";
  const depFiltro = d.depositos.some((x) => x.id === f.deposito) ? String(f.deposito) : "";
  const saldoFiltro = (p: Linha) =>
    depFiltro ? (p.dep[depFiltro]?.saldo ?? 0) : Object.values(p.dep).reduce((s, v) => s + v.saldo, 0);
  const todas = [...porProduto.values()];
  const visiveis = todas.filter((p) =>
    situacao === "zerado" ? saldoFiltro(p) <= 0 : situacao === "com" ? saldoFiltro(p) > 0 : true);
  const nomeDep = d.depositos.find((x) => x.id === depFiltro)?.nome;
  const operaAlgum = d.depositos.some((x) => x.opera);
  const linhas = Array.from({ length: 6 }, (_, i) => i);
  // Um único catálogo para todos os campos de produto (digite código ou nome e escolha)
  const produtoSelect = (i: number) => (
    <input name={`produto_${i}`} list="lista-produtos" placeholder="Código ou nome do produto" aria-label={`Produto ${i + 1}`} autoComplete="off" />
  );

  return (
    <>
      <datalist id="lista-produtos">
        {d.produtos.map((p) => <option key={p.id} value={p.codigo}>{p.nome}</option>)}
      </datalist>
      <section className="linha entre">
        <h1>Estoque</h1>
        <div className="linha">
          {operaAlgum && (
            <>
              <a className="botao principal" href="/estoque/inventario">Fazer inventário</a>
              <a className="botao" href="#entrada">Adicionar estoque</a>
            </>
          )}
          {ehGestao(u) && (
            <>
              <a className="botao" href="#ajuste">Ajuste manual</a>
              <a className="botao" href="/estoque/precos">Tabela de preços</a>
              <a className="botao" href="/estoque/importar">Importar produtos do Bling</a>
            </>
          )}
        </div>
      </section>
      <section>
        <div className="suave pequeno">
          {d.depositos.map((x) => `${x.nome}${x.cidade ? " (" + x.cidade + ")" : ""}`).join(" · ")}. Na fase atual o estoque oficial continua no Bling; aqui roda em paralelo.
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <form className="painel linha" method="get">
        <label style={{ flex: 1 }}>Produto<input name="q" defaultValue={f.q} placeholder="Código ou nome" /></label>
        <label>Situação
          <select name="situacao" defaultValue={situacao}>
            <option value="">Todos</option>
            <option value="zerado">Sem estoque (zerado)</option>
            <option value="com">Com estoque</option>
          </select>
        </label>
        <label>Depósito
          <select name="deposito" defaultValue={depFiltro}>
            <option value="">Todos (soma)</option>
            {d.depositos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </label>
        <button className="principal">Filtrar</button>
        {(f.q || situacao || depFiltro) && <a className="botao" href="/estoque">Limpar</a>}
      </form>

      {porProduto.size > 0 && (
        <p className="pequeno suave">
          {situacao === "zerado"
            ? `${visiveis.length} produto(s) sem estoque${nomeDep ? " em " + nomeDep : " (somando todos os depósitos)"}.`
            : situacao === "com"
              ? `${visiveis.length} produto(s) com estoque${nomeDep ? " em " + nomeDep : ""}.`
              : `${visiveis.length} produto(s).`}
          {situacao !== "zerado" && <> <a href={`/estoque?situacao=zerado${depFiltro ? "&deposito=" + depFiltro : ""}`}>Ver os sem estoque</a></>}
        </p>
      )}

      {porProduto.size === 0 ? <div className="painel vazio">Nenhum produto cadastrado ainda.</div> :
       visiveis.length === 0 ? <div className="painel vazio">Nenhum produto nessa situação.</div> : (
        <div className="tabela"><table>
          <thead><tr><th>Código</th><th>Produto</th>{d.depositos.map((x) => <th key={x.id}>{x.nome}</th>)}<th>Total</th></tr></thead>
          <tbody>{visiveis.map((p) => {
            const total = Object.values(p.dep).reduce((s, v) => s + v.saldo, 0);
            return (
              <tr key={p.codigo}>
                <td className="num">{p.codigo}</td><td>{p.nome}</td>
                {d.depositos.map((x) => (
                  <td key={x.id} className="num">
                    {p.dep[x.id]?.saldo ?? 0}
                    {(p.dep[x.id]?.aReceber ?? 0) > 0 && <div className="pequeno suave">+{p.dep[x.id].aReceber} a receber</div>}
                  </td>
                ))}
                <td className="num"><b>{total}</b></td>
              </tr>
            );
          })}</tbody></table></div>
      )}

      {(d.kits.length > 0 || ehGestao(u)) && (
        <section className="painel" id="kits">
          <h2>Kits</h2>
          <p className="pequeno suave">Kit não tem estoque próprio: ao vender, saem os componentes. A disponibilidade é a do componente que acabar primeiro.</p>
          {d.kits.length === 0 ? <p className="suave">Nenhum kit montado ainda.</p> :
            <ul className="lista-simples">{d.kits.map((k) => <li key={k.id}><b>{k.nome}</b> <span className="suave">({k.codigo})</span>: {k.composicao}</li>)}</ul>}
          {ehGestao(u) && (
            <details>
              <summary>Montar ou alterar um kit</summary>
              <form action={definirKit} className="campos" style={{ marginTop: 10 }}>
                <label className="largo">Produto que é o kit
                  <input name="kit" list="lista-produtos" required placeholder="Ex.: MPLA-CM" autoComplete="off" />
                </label>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="largo linha">
                    <div style={{ flex: 3, minWidth: 200 }}>{produtoSelect(i)}</div>
                    <input name={`qtd_${i}`} inputMode="decimal" placeholder="Qtd" defaultValue={i < 3 ? "1" : ""} style={{ flex: 1, minWidth: 80 }} aria-label={`Quantidade ${i + 1}`} />
                  </div>
                ))}
                <p className="largo pequeno suave">Ex.: Kit Platinum = 1 shampoo + 1 condicionador + 1 máscara. Salvar de novo substitui a composição.</p>
                <div className="largo linha">
                  <button className="principal">Salvar kit</button>
                  <button name="desfazer" value="1" formNoValidate>Desfazer kit (volta a ser produto simples)</button>
                </div>
              </form>
            </details>
          )}
        </section>
      )}

      {d.pendencias.length > 0 && (
        <section className="painel" id="pendencias">
          <h2>Pendências de estoque</h2>
          <p className="pequeno suave">Pedidos de marketplace que não deram saída completa no sistema. O estoque oficial ainda é o do Bling: confira e ajuste.</p>
          <div className="tabela"><table>
            <thead><tr><th>Quando</th><th>Pedido</th><th>Problema</th><th>Produto / código</th><th>Qtd</th></tr></thead>
            <tbody>{d.pendencias.map((e) => (
              <tr key={e.id}>
                <td className="num">{dataHora(e.em)}</td>
                <td>{e.pedido_id ? <a href={`/pedidos/${e.pedido_id}`}>{e.canal} {e.numero_externo ?? ""}</a> : "—"}</td>
                <td>{e.tipo === "sem_estoque" ? <Selo cor="erro">Sem estoque no sistema</Selo> : <Selo cor="aviso">Código sem cadastro</Selo>}</td>
                <td>{e.produto ?? e.codigo}<div className="pequeno suave">{e.detalhe}</div></td>
                <td className="num">{Number(e.quantidade)}</td>
              </tr>))}
            </tbody></table></div>
        </section>
      )}

      <section className="painel" id="transferencias">
        <h2>Transferências</h2>
        {d.transferencias.length === 0 && <p className="suave">Nenhuma transferência.</p>}
        {d.transferencias.map((t) => (
          <div key={t.id} className="painel" style={{ background: "var(--afundado)" }}>
            <div className="linha entre">
              <b>Nº {t.numero} · {t.origem} → {t.destino}</b>
              <Selo cor={COR[t.status]}>{STATUS_TRANSFERENCIA[t.status]}</Selo>
            </div>
            <div className="pequeno suave">
              Criada por {t.criada_nome ?? "—"} em {dataHora(t.criada_em)}
              {t.enviada_em && ` · enviada em ${dataHora(t.enviada_em)}`}
              {t.recebida_em && ` · recebida em ${dataHora(t.recebida_em)}`}
              {t.observacao && ` · ${t.observacao}`}
            </div>
            {t.status === "enviada" && t.opera_destino ? (
              <form action={receberTransferencia} className="campos">
                <input type="hidden" name="transferencia_id" value={t.id} />
                {(t.itens as { produto_id: string; codigo: string; nome: string; enviada: number }[]).map((i) => (
                  <label key={i.produto_id}>{i.codigo} · {i.nome} (enviado {Number(i.enviada)})
                    <input name={`recebido_${i.produto_id}`} inputMode="decimal" defaultValue={Number(i.enviada)} />
                  </label>
                ))}
                <label className="largo">Observação do recebimento<input name="observacao" /></label>
                <button className="principal">Confirmar recebimento</button>
              </form>
            ) : (
              <ul className="lista-simples pequeno">
                {(t.itens as { produto_id: string; codigo: string; nome: string; enviada: number; recebida: number | null }[]).map((i) => (
                  <li key={i.produto_id}>
                    {i.codigo} · {i.nome}: {Number(i.enviada)} enviado(s)
                    {i.recebida !== null && <>, {Number(i.recebida)} recebido(s){Number(i.recebida) < Number(i.enviada) && <> <Selo cor="erro">faltaram {Number(i.enviada) - Number(i.recebida)}</Selo></>}</>}
                  </li>
                ))}
              </ul>
            )}
            {t.status === "rascunho" && t.opera_origem && (
              <div className="linha">
                <form action={enviarTransferencia}><input type="hidden" name="transferencia_id" value={t.id} /><button className="principal">Enviar (tira da origem)</button></form>
                <form action={cancelarTransferencia}><input type="hidden" name="transferencia_id" value={t.id} /><button className="perigo">Cancelar</button></form>
              </div>
            )}
          </div>
        ))}

        {operaAlgum && (
          <details>
            <summary>Nova transferência</summary>
            <form action={criarTransferencia} className="campos" style={{ marginTop: 10 }}>
              <label>De
                <select name="origem_id" required>
                  {d.depositos.filter((x) => x.opera).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                </select>
              </label>
              <label>Para
                <select name="destino_id" required defaultValue={d.depositos[d.depositos.length - 1]?.id}>
                  {d.depositos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                </select>
              </label>
              {linhas.map((i) => (
                <div key={i} className="largo linha">
                  <div style={{ flex: 3, minWidth: 200 }}>{produtoSelect(i)}</div>
                  <input name={`qtd_${i}`} inputMode="decimal" placeholder="Qtd" style={{ flex: 1, minWidth: 80 }} aria-label={`Quantidade ${i + 1}`} />
                </div>
              ))}
              <label className="largo">Observação<input name="observacao" placeholder="Ex.: reposição semanal da loja" /></label>
              <button className="principal">Criar transferência</button>
            </form>
          </details>
        )}
      </section>

      {operaAlgum && (
        <div className="duas-colunas">
          <section className="painel" id="entrada">
            <h2>Entrada de mercadoria (compra)</h2>
            <form action={entradaCompra} className="campos">
              <label>Depósito
                <select name="deposito_id" required>
                  {d.depositos.filter((x) => x.opera).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                </select>
              </label>
              <label>Referência<input name="referencia" required placeholder="NF ou pedido do fornecedor" /></label>
              {linhas.map((i) => (
                <div key={i} className="largo linha">
                  <div style={{ flex: 3, minWidth: 200 }}>{produtoSelect(i)}</div>
                  <input name={`qtd_${i}`} inputMode="decimal" placeholder="Qtd" style={{ flex: 1, minWidth: 80 }} aria-label={`Quantidade ${i + 1}`} />
                </div>
              ))}
              <button className="principal">Registrar entrada</button>
            </form>
          </section>
          {ehGestao(u) && (
            <section className="painel" id="ajuste">
              <h2>Ajuste de inventário</h2>
              <form action={ajustarEstoque} className="campos">
                <label>Depósito
                  <select name="deposito_id" required>
                    {d.depositos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                  </select>
                </label>
                <label className="largo">Produto
                  <input name="produto" list="lista-produtos" required placeholder="Código ou nome do produto" autoComplete="off" />
                </label>
                <label>Quantidade contada<input name="contado" inputMode="decimal" required /></label>
                <label className="largo">Motivo<input name="motivo" required placeholder="Ex.: inventário mensal" /></label>
                <button className="principal">Ajustar</button>
              </form>
            </section>
          )}
        </div>
      )}
    </>
  );
}
