"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";
import { casarProduto, lerDesconto, lerItens, lerNumeroPedido } from "@/lib/nota";
import { lerNfe, UNIDADE_PECA } from "@/lib/nfe";

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

/**
 * Importa um ou mais XML de NF-e do fornecedor: lança como "a caminho", liga os itens aos produtos
 * (EAN, código já usado com o fornecedor, nome dentro da marca) e cria as contas a pagar das duplicatas.
 */
export async function importarXml(fd: FormData) {
  const u = await exigirUsuario();
  const ok: string[] = [], erros: string[] = [];
  let ultimo = "";
  if (!ehGestao(u)) ir("/estoque/notas", "Só gerente ou dono importa notas.", "");
  const arquivos = fd.getAll("xml").filter((f): f is File => typeof f === "object" && "text" in f && f.size > 0);
  if (!arquivos.length) ir("/estoque/notas", "Escolha o arquivo XML da nota.", "");
  for (const arq of arquivos.slice(0, 20)) {
    try {
      if (arq.size > 3_000_000) throw new Error("arquivo grande demais");
      const n = lerNfe(await arq.text());
      if (!n.itens.length) throw new Error("a nota não tem itens");
      ultimo = await comUsuario(u.id, async (c) => {
        const prods = (await c.query("select id::text, nome, marca, gtin, unidades_caixa from app.produtos order by ativo desc")).rows as
          { id: string; nome: string; marca: string | null; gtin: string | null; unidades_caixa: number | null }[];
        const porId = new Map(prods.map((p) => [p.id, p]));
        const porEan = new Map(prods.filter((p) => p.gtin).map((p) => [p.gtin!, p]));
        // marca: a escolhida; senão a das notas anteriores do fornecedor; senão a mais comum entre os EAN achados
        let marca = texto(fd, "marca");
        if (!marca && n.fornecedor.cnpj) {
          marca = (await c.query(`select c.marca from app.compras c join app.fornecedores f on f.id = c.fornecedor_id
              where f.cnpj = $1 and c.marca is not null group by c.marca order by count(*) desc limit 1`, [n.fornecedor.cnpj.replace(/\D/g, "")])).rows[0]?.marca ?? "";
        }
        if (!marca) {
          const cont = new Map<string, number>();
          for (const i of n.itens) { const m = i.ean ? porEan.get(i.ean)?.marca : null; if (m) cont.set(m, (cont.get(m) ?? 0) + 1); }
          marca = [...cont.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
        }
        if (!marca) throw new Error("não consegui descobrir a marca: escolha a marca e importe de novo");
        const daMarca = prods.filter((p) => p.marca === marca);
        const itens = n.itens.map((i) => {
          const produto_id = (i.ean ? porEan.get(i.ean)?.id : null) ?? casarProduto(i.descricao, daMarca)?.id ?? null;
          // nota em caixa/fardo: converte para unidades pela quantidade por caixa do produto (o estoque é em unidades)
          const porCaixa = produto_id ? Number(porId.get(produto_id)?.unidades_caixa ?? 0) : 0;
          const emPeca = UNIDADE_PECA.test(i.unidade) || !i.unidade;
          const converte = !emPeca && porCaixa > 1;
          const descricao = emPeca ? i.descricao : converte ? `${i.descricao} [${i.quantidade} ${i.unidade} × ${porCaixa} un]`
            : `${i.descricao} [nota em ${i.unidade}: confira a quantidade]`;
          return {
            codigo: i.codigo, ean: i.ean, unidade: i.unidade, produto_id, descricao: descricao.slice(0, 200),
            quantidade: converte ? i.quantidade * porCaixa : i.quantidade,
            valor_unit: converte ? Math.round((i.valor_unit / porCaixa) * 10000) / 10000 : i.valor_unit,
          };
        });
        return (await c.query("select app.importar_nfe($1::jsonb) id", [JSON.stringify({
          fornecedor: n.fornecedor, numero: n.numero, chave: n.chave, data: n.data, marca,
          frete: n.frete, desconto: n.desconto, valor_produtos: n.itens.reduce((s, i) => s + i.total, 0), valor_nota: n.valor_nota,
          cambio: numero(fd, "cambio"), itens, duplicatas: n.duplicatas,
          gerar_contas: fd.get("gerar_contas") === "1", prazo_dias: numero(fd, "prazo") ?? 30,
        })])).rows[0].id as string;
      });
      ok.push(`NF ${n.numero ?? "?"} (${n.fornecedor.nome}, ${n.itens.length} itens${n.duplicatas.length ? `, ${n.duplicatas.length} parcela(s)` : ""})`);
    } catch (e) {
      erros.push(`${arq.name}: ${mensagemErro(e)}`);
    }
  }
  const msgOk = ok.length ? `Importada(s): ${ok.join("; ")}. Confira os produtos ligados e confirme a chegada para subir o estoque.` : "";
  if (ok.length === 1 && !erros.length) ir(`/estoque/notas/${ultimo}`, null, msgOk);
  ir("/estoque/notas", erros.length ? erros.join(" · ") + (msgOk ? " · " + msgOk : "") : null, msgOk);
}
