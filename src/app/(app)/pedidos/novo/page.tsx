import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario, ehGestao, podeEscrever } from "@/lib/auth";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { comUsuario } from "@/lib/db";
import { hojeISO } from "@/lib/formato";
import { Avisos } from "../../avisos";
import { criarPedido } from "../acoes";

export const metadata = { title: "Novo pedido" };

export default async function NovoPedido({ searchParams }: { searchParams: Promise<{ erro?: string; cliente?: string }> }) {
  const u = await exigirUsuario();
  if (!podeEscrever(u)) redirect("/pedidos");
  const f = await searchParams;
  const { atual: unidade } = await unidadeSistema(u);
  const d = await comUsuario(u.id, async (c) => ({
    clientes: (await c.query(
      `select c.id, c.nome, c.categoria_preco, c.moeda, v.nome as vendedora from app.clientes c
         join app.vendedoras v on v.id = c.vendedora_id where c.mesclado_em is null and c.ativo order by c.nome`)).rows,
    produtos: (await c.query("select id, codigo, nome, unidades_caixa from app.produtos where ativo order by nome")).rows,
    exigeEstoque: Number((await c.query("select app.param('pedido_exige_estoque') v")).rows[0].v ?? 0) === 1,
    depositos: (await c.query(
      ehGestao(u)
        ? "select id, nome, false as padrao from app.depositos where ativo order by nome"
        : `select d.id, d.nome, vd.padrao from app.depositos d join app.vendedora_depositos vd on vd.deposito_id = d.id
            where vd.vendedora_id = $1 and d.ativo order by vd.padrao desc, d.nome`,
      ehGestao(u) ? [] : [u.vendedora_id])).rows,
  }));
  const linhas = Array.from({ length: 10 }, (_, i) => i);

  return (
    <>
      <section>
        <Link href="/pedidos">← Pedidos</Link>
        <h1 style={{ marginTop: 4 }}>Novo pedido</h1>
        <div className="suave pequeno">Os preços vêm da tabela do cliente (Normal/VIP) na moeda escolhida e ficam congelados no pedido.
          {d.exigeEstoque ? " Só entra o que tem estoque no depósito." : ""}
          {" "}O cliente pediu algo que não temos? <Link href="/procuras">Registre aqui</Link> para o gerente comprar.</div>
      </section>
      <Avisos erro={f.erro} />
      {d.depositos.length === 0 && !ehGestao(u) && (
        <div className="aviso-caixa aviso">Você ainda não tem depósito liberado para vender. Peça ao gerente.</div>
      )}
      <form action={criarPedido} className="painel campos">
        <label className="largo">Cliente
          <select name="cliente_id" required defaultValue={f.cliente ?? ""}>
            <option value="">Escolha…</option>
            {d.clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} · {c.moeda === "GS" ? "Gs" : "R$"} {c.categoria_preco === "vip" ? "VIP" : "Normal"}
                {ehGestao(u) ? ` · ${c.vendedora}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>Moeda do pedido
          <select name="moeda" defaultValue="">
            <option value="">A do cliente</option>
            <option value="GS">Guaranis (Gs)</option>
            <option value="BRL">Reais (R$)</option>
          </select>
        </label>
        <label>Depósito
          <select name="deposito_id" defaultValue={(unidade && d.depositos.some((x) => x.id === unidade.id) ? unidade.id : d.depositos.find((x) => x.padrao)?.id) ?? ""}>
            <option value="">Padrão da vendedora</option>
            {d.depositos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </label>
        <label>Previsão de envio<input name="previsao_envio" type="date" defaultValue={hojeISO(2)} /></label>
        <div className="largo tabela">
          <table style={{ minWidth: 420 }}>
            <thead><tr><th>Produto</th><th style={{ width: 110 }}>Caixas</th><th style={{ width: 110 }}>ou peças</th></tr></thead>
            <tbody>
              {linhas.map((i) => (
                <tr key={i}>
                  <td>
                    <select name={`produto_${i}`} defaultValue="" aria-label={`Produto ${i + 1}`}>
                      <option value="">—</option>
                      {d.produtos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nome}{p.unidades_caixa ? ` · cx ${p.unidades_caixa}` : ""}</option>)}
                    </select>
                  </td>
                  <td><input name={`cx_${i}`} inputMode="numeric" aria-label={`Caixas ${i + 1}`} /></td>
                  <td><input name={`qtd_${i}`} inputMode="decimal" aria-label={`Peças ${i + 1}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="largo">Observações<textarea name="observacoes" /></label>
        <label className="largo linha"><input type="checkbox" name="para_cliente" value="1" />
          Mandar para o cliente conferir e confirmar as caixas por link (WhatsApp) antes de separar</label>
        <button className="principal">Criar pedido</button>
      </form>
    </>
  );
}
