import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dataHora, STATUS_TRANSFERENCIA } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import {
  ajustarEstoque, cancelarTransferencia, criarTransferencia, entradaCompra, enviarTransferencia, receberTransferencia,
} from "./acoes";

export const metadata = { title: "Estoque" };

const COR: Record<string, string> = { rascunho: "", enviada: "aviso", recebida: "ok", recebida_com_divergencia: "erro", cancelada: "" };

export default async function Estoque({ searchParams }: { searchParams: Promise<{ q?: string; ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const d = await comUsuario(u.id, async (c) => {
    const depositos = (await c.query(
      "select id, nome, cidade, app.pode_operar_deposito(id) as opera from app.depositos where ativo order by tipo, nome")).rows;
    const par: unknown[] = [];
    let filtro = "";
    if (f.q) { par.push(`%${f.q}%`); filtro = "where codigo ilike $1 or produto ilike $1"; }
    const saldos = (await c.query(`select * from app.v_estoque ${filtro} order by produto, deposito`, par)).rows;
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
    return { depositos, saldos, transferencias, produtos };
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
  const operaAlgum = d.depositos.some((x) => x.opera);
  const linhas = Array.from({ length: 6 }, (_, i) => i);
  const produtoSelect = (i: number) => (
    <select name={`produto_${i}`} defaultValue="" aria-label={`Produto ${i + 1}`}>
      <option value="">—</option>
      {d.produtos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nome}</option>)}
    </select>
  );

  return (
    <>
      <section>
        <h1>Estoque</h1>
        <div className="suave pequeno">
          {d.depositos.map((x) => `${x.nome}${x.cidade ? " (" + x.cidade + ")" : ""}`).join(" · ")}. Na fase atual o estoque oficial continua no Bling; aqui roda em paralelo.
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <form className="painel linha" method="get">
        <label style={{ flex: 1 }}>Produto<input name="q" defaultValue={f.q} placeholder="Código ou nome" /></label>
        <button className="principal">Buscar</button>
      </form>

      {porProduto.size === 0 ? <div className="painel vazio">Nenhum produto cadastrado ainda.</div> : (
        <div className="tabela"><table>
          <thead><tr><th>Código</th><th>Produto</th>{d.depositos.map((x) => <th key={x.id}>{x.nome}</th>)}<th>Total</th></tr></thead>
          <tbody>{[...porProduto.values()].map((p) => {
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
          <section className="painel">
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
            <section className="painel">
              <h2>Ajuste de inventário</h2>
              <form action={ajustarEstoque} className="campos">
                <label>Depósito
                  <select name="deposito_id" required>
                    {d.depositos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                  </select>
                </label>
                <label className="largo">Produto
                  <select name="produto_id" required defaultValue="">
                    <option value="">Escolha…</option>
                    {d.produtos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nome}</option>)}
                  </select>
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
