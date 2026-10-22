import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario, ehGestao, podeEscrever } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { hojeISO } from "@/lib/formato";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { Avisos } from "../../avisos";
import { salvarOrcamento } from "../acoes";

export const metadata = { title: "Orçamento" };

export default async function NovoOrcamento({ searchParams }: { searchParams: Promise<{ id?: string; cliente?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  if (!podeEscrever(u)) redirect("/orcamentos");
  const f = await searchParams;
  const { atual } = await unidadeSistema(u);
  const id = f.id && /^[0-9a-f-]{36}$/i.test(f.id) ? f.id : null;
  const d = await comUsuario(u.id, async (c) => ({
    orc: id ? (await c.query("select * from app.orcamentos where id = $1 and status = 'aberto'", [id])).rows[0] ?? null : null,
    itens: id ? (await c.query("select i.*, p.codigo from app.orcamento_itens i join app.produtos p on p.id = i.produto_id where orcamento_id = $1 order by ordem", [id])).rows : [],
    clientes: (await c.query(`select c.id, c.nome, c.tabela_preco, v.nome vendedora from app.clientes c join app.vendedoras v on v.id = c.vendedora_id
      where c.mesclado_em is null and c.ativo order by c.nome`)).rows,
    tabelas: (await c.query("select codigo, nome from app.tabelas_preco order by pais desc, codigo")).rows as { codigo: string; nome: string }[],
    produtos: (await c.query("select codigo, nome, unidades_caixa from app.produtos where ativo and codigo is not null order by nome")).rows,
    depositos: (await c.query(ehGestao(u) ? "select id, nome, prefixo_tabela from app.depositos where ativo order by nome"
      : `select d.id, d.nome, d.prefixo_tabela from app.depositos d join app.vendedora_depositos vd on vd.deposito_id = d.id where vd.vendedora_id = $1 and d.ativo order by vd.padrao desc`,
      ehGestao(u) ? [] : [u.vendedora_id])).rows,
  }));
  if (id && !d.orc) redirect(`/orcamentos/${id}?erro=${encodeURIComponent("Só orçamento aberto pode ser editado.")}`);
  const o = d.orc;
  const tabelaPadrao = o?.tabela ?? (atual && d.depositos.find((x) => x.id === atual.id)?.prefixo_tabela ? `${d.depositos.find((x) => x.id === atual.id)!.prefixo_tabela}_normal` : "py_normal");
  const linhas = Array.from({ length: Math.max(15, d.itens.length + 5) }, (_, i) => i);
  return (
    <>
      <section>
        <Link href="/orcamentos">← Orçamentos</Link>
        <h1 style={{ marginTop: 4 }}>{o ? `Editar orçamento #${o.numero}` : "Novo orçamento"}</h1>
        <div className="suave pequeno">Para cliente cadastrado, os preços são os da tabela dele. Para quem ainda não é cliente, escolha a tabela de preço. Digite o código ou o nome do produto e escolha da lista.</div>
      </section>
      <Avisos erro={f.erro} />
      <form action={salvarOrcamento} className="painel campos">
        {o && <input type="hidden" name="id" value={o.id} />}
        <label className="largo">Cliente cadastrado (opcional)
          <select name="cliente_id" defaultValue={o?.cliente_id ?? f.cliente ?? ""}>
            <option value="">Ainda não é cliente: usar nome e WhatsApp abaixo</option>
            {d.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}{ehGestao(u) ? ` · ${c.vendedora}` : ""}</option>)}
          </select>
        </label>
        <label>Nome do contato<input name="contato_nome" maxLength={120} defaultValue={o?.contato_nome ?? ""} placeholder="Ex.: Ana - Perfumaria Sol" /></label>
        <label>WhatsApp<input name="contato_whatsapp" maxLength={30} defaultValue={o?.contato_whatsapp ?? ""} placeholder="595981000000" /></label>
        <label>Tabela de preço (sem cliente)
          <select name="tabela" defaultValue={tabelaPadrao}>{d.tabelas.map((t) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}</select>
        </label>
        <label>Depósito
          <select name="deposito_id" defaultValue={o?.deposito_id ?? atual?.id ?? ""}>
            <option value="">Padrão</option>{d.depositos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </label>
        <label>Válido até<input type="date" name="validade" defaultValue={o?.validade ? new Date(o.validade).toISOString().slice(0, 10) : hojeISO(7)} /></label>
        <datalist id="orc-produtos">{d.produtos.map((p) => <option key={p.codigo} value={`${p.codigo} · ${p.nome}${p.unidades_caixa ? ` · cx ${p.unidades_caixa}` : ""}`} />)}</datalist>
        <div className="largo tabela">
          <table style={{ minWidth: 520 }}>
            <thead><tr><th>Produto</th><th style={{ width: 100 }}>Caixas</th><th style={{ width: 100 }}>ou peças</th></tr></thead>
            <tbody>{linhas.map((i) => {
              const it = d.itens[i];
              return (
                <tr key={i}>
                  <td><input name={`p_${i}`} list="orc-produtos" defaultValue={it ? `${it.codigo} · ${it.descricao}` : ""} placeholder={i === 0 ? "código ou nome do produto" : ""} aria-label={`Produto ${i + 1}`} style={{ width: "100%" }} /></td>
                  <td><input name={`cx_${i}`} inputMode="numeric" aria-label={`Caixas ${i + 1}`} /></td>
                  <td><input name={`q_${i}`} inputMode="decimal" defaultValue={it ? String(Number(it.quantidade)) : ""} aria-label={`Peças ${i + 1}`} /></td>
                </tr>);
            })}</tbody>
          </table>
        </div>
        <label className="largo">Observações (aparece no orçamento)<textarea name="observacoes" defaultValue={o?.observacoes ?? ""} maxLength={1000} placeholder="Ex.: frete por conta do cliente; entrega em 3 dias" /></label>
        <button className="principal">Salvar orçamento</button>
      </form>
    </>
  );
}
