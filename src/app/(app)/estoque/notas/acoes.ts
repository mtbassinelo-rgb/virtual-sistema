"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";
import { casarProduto, lerDesconto, lerItens, lerNumeroPedido } from "@/lib/nota";

const ir = (url: string, erro: string | null, ok: string) => {
  revalidatePath("/estoque/notas");
  redirect(`${url}${url.includes("?") ? "&" : "?"}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
};

/** Lança a nota do fornecedor como "a caminho": lê os itens do texto colado e liga cada um a um produto já cadastrado da marca. */
export async function lancarNota(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null, id = "";
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono lança notas.");
    const txt = String(fd.get("itens") ?? "");
    const itens = lerItens(txt);
    if (!itens.length) throw new Error("Não achei itens no texto. Cole as linhas da nota (código, produto e os números da linha).");
    const marca = texto(fd, "marca");
    if (!marca) throw new Error("Escolha a marca da nota.");
    const desconto = texto(fd, "desconto") === "" ? lerDesconto(txt) : numero(fd, "desconto");
    id = await comUsuario(u.id, async (c) => {
      const prods = (await c.query("select id::text, nome from app.produtos where marca = $1 order by ativo desc", [marca])).rows as { id: string; nome: string }[];
      const linhas = itens.map((i) => ({ ...i, produto_id: casarProduto(i.descricao, prods)?.id ?? null }));
      return (await c.query("select app.lancar_nota($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) id",
        [texto(fd, "fornecedor"), texto(fd, "data") || null, texto(fd, "nfe") || lerNumeroPedido(txt), marca, numero(fd, "frete") ?? 0,
         desconto, numero(fd, "cambio"), JSON.stringify(linhas), texto(fd, "obs") || null])).rows[0].id as string;
    });
  } catch (e) {
    erro = mensagemErro(e);
  }
  if (erro) ir("/estoque/notas", erro, "");
  ir(`/estoque/notas/${id}`, null, "Nota lançada como a caminho. Confira os produtos ligados; o estoque só sobe quando confirmar a chegada.");
}

export async function ligarItens(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "compra");
  let erro: string | null = null;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono altera a nota.");
    await comUsuario(u.id, async (c) => {
      for (const [k, v] of fd.entries()) {
        const m = k.match(/^item:([0-9a-f-]{36})$/);
        if (m) await c.query("select app.ligar_item_nota($1, $2)", [m[1], String(v) || null]);
      }
    });
  } catch (e) {
    erro = mensagemErro(e);
  }
  ir(`/estoque/notas/${id}`, erro, "Produtos salvos.");
}

/** Chegou: sobe o estoque dos itens ligados e o frete entra na média da marca. */
export async function receberNota(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "compra");
  let erro: string | null = null, ok = "";
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono confirma a chegada.");
    const r = await comUsuario(u.id, async (c) => (await c.query("select app.receber_nota($1, $2, $3) r",
      [id, texto(fd, "deposito"), fd.get("atualizar_custo") === "1"])).rows[0].r as { produtos: number; sem_produto: number });
    ok = `Chegada confirmada: estoque de ${r.produtos} produto(s) atualizado` + (r.sem_produto ? `; ${r.sem_produto} item(ns) sem produto ficaram de fora.` : ".") + " Frete incluído na média da marca.";
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/estoque");
  ir(`/estoque/notas/${id}`, erro, ok);
}
