"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";

const uuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const ir = (url: string, erro: string | null, ok: string) => {
  revalidatePath("/orcamentos");
  redirect(`${url}${url.includes("?") ? "&" : "?"}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
};

/** Salva (novo ou edição). Produtos nos campos p_N ("código · nome"), cx_N (caixas) e q_N (peças). */
export async function salvarOrcamento(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  let erro: string | null = null, novo = "";
  try {
    const codigos: { i: number; codigo: string; cx: number | null; q: number | null }[] = [];
    for (let i = 0; i < 40; i++) {
      const p = texto(fd, `p_${i}`);
      if (!p) continue;
      codigos.push({ i, codigo: p.split(" · ")[0].trim(), cx: numero(fd, `cx_${i}`), q: numero(fd, `q_${i}`) });
    }
    novo = await comUsuario(u.id, async (c) => {
      const prods = codigos.length ? (await c.query("select id, codigo from app.produtos where ativo and codigo = any($1)", [codigos.map((x) => x.codigo)])).rows : [];
      const faltam = codigos.filter((x) => !prods.some((p) => p.codigo === x.codigo));
      if (faltam.length) throw new Error(`Produto não encontrado: ${faltam.map((x) => x.codigo).join(", ")}. Escolha da lista.`);
      const itens = codigos.map((x) => ({ produto_id: prods.find((p) => p.codigo === x.codigo)!.id, ...(x.q && x.q > 0 ? { quantidade: x.q } : { caixas: x.cx }) }));
      return (await c.query("select app.salvar_orcamento($1, $2::jsonb) id", [uuid(id) ? id : null, JSON.stringify({
        cliente_id: texto(fd, "cliente_id") || null, contato_nome: texto(fd, "contato_nome"), contato_whatsapp: texto(fd, "contato_whatsapp"),
        tabela: texto(fd, "tabela") || null, deposito_id: texto(fd, "deposito_id") || null, validade: texto(fd, "validade") || null,
        observacoes: texto(fd, "observacoes"), itens })])).rows[0].id as string;
    });
  } catch (e) {
    erro = mensagemErro(e);
  }
  if (erro) ir(`/orcamentos/novo${uuid(id) ? `?id=${id}` : ""}`, erro, "");
  ir(`/orcamentos/${novo}`, null, "Orçamento salvo. Envie pelo WhatsApp ou imprima.");
}

export async function vincularOrcamento(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  let erro: string | null = null;
  try {
    await comUsuario(u.id, async (c) => {
      let cliente = texto(fd, "cliente_id");
      if (fd.get("cadastrar") === "1") {
        // cadastra o contato do orçamento como cliente novo (da vendedora), com o país e a categoria da tabela usada
        const o = (await c.query(`select o.contato_nome, o.contato_whatsapp, o.vendedora_id, o.deposito_id, t.pais, o.tabela from app.orcamentos o
            join app.tabelas_preco t on t.codigo = o.tabela where o.id = $1`, [id])).rows[0];
        if (!o) throw new Error("Orçamento não encontrado.");
        if (!o.contato_nome) throw new Error("O orçamento não tem o nome do contato.");
        cliente = (await c.query(`insert into app.clientes (nome, whatsapp, pais, categoria_preco, vendedora_id, deposito_id, cidade)
            values ($1, $2, $3::app.pais, $4::app.categoria_preco, $5, $6, nullif($7, '')) returning id`,
          [o.contato_nome, o.contato_whatsapp, o.pais, String(o.tabela).endsWith("_vip") ? "vip" : "normal", o.vendedora_id,
           String(o.tabela).startsWith("cde_") ? o.deposito_id : null, texto(fd, "cidade")])).rows[0].id;
      }
      if (!uuid(cliente)) throw new Error("Escolha o cliente ou marque para cadastrar o contato como cliente.");
      await c.query("select app.vincular_orcamento($1, $2)", [id, cliente]);
    });
  } catch (e) {
    erro = mensagemErro(e);
  }
  ir(`/orcamentos/${id}`, erro, "Orçamento vinculado ao cliente: os preços agora são os da tabela dele.");
}

export async function converterOrcamento(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  let erro: string | null = null, ped = "";
  try {
    ped = await comUsuario(u.id, async (c) => (await c.query("select app.converter_orcamento($1, $2, $3, $4) id",
      [id, texto(fd, "deposito_id") || null, texto(fd, "previsao") || null, fd.get("para_cliente") === "1"])).rows[0].id as string);
  } catch (e) {
    erro = mensagemErro(e);
  }
  if (erro) ir(`/orcamentos/${id}`, erro, "");
  revalidatePath("/pedidos");
  redirect(`/pedidos/${ped}?ok=${encodeURIComponent("Orçamento virou pedido.")}`);
}

export async function cancelarOrcamento(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.cancelar_orcamento($1)", [id]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  ir(`/orcamentos/${id}`, erro, "Orçamento cancelado.");
}
