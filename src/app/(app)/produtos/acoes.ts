"use server";

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";
import { pastaFotos, tipoImagem } from "@/lib/arquivos";

const TABELAS = ["py_normal", "py_vip", "br_normal", "br_vip"] as const;

/** Cria ou edita um produto: dados, preços (valem a partir de hoje) e foto, numa única ida. */
export async function salvarProduto(fd: FormData) {
  const u = await exigirUsuario();
  const idAtual = texto(fd, "id") || null;
  let destino: string;
  let fotoNova: string | null = null;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono cadastra produtos.");

    // Foto: confere o conteúdo antes de gravar qualquer coisa
    const arq = fd.get("foto");
    let bytes: Buffer | null = null, ext: string | null = null;
    if (arq instanceof File && arq.size > 0) {
      if (arq.size > 5 * 1024 * 1024) throw new Error("Foto grande demais: máximo 5 MB.");
      bytes = Buffer.from(await arq.arrayBuffer());
      ext = tipoImagem(bytes);
      if (!ext) throw new Error("A foto precisa ser JPG, PNG ou WEBP.");
    }

    const id = await comUsuario(u.id, async (c) => {
      const r = await c.query("select app.salvar_produto($1, $2, $3, $4, $5, $6, $7, $8) as id", [
        idAtual, texto(fd, "codigo"), texto(fd, "nome"), texto(fd, "marca"), texto(fd, "unidade"), texto(fd, "gtin"),
        numero(fd, "custo"), fd.get("ativo") === "on"]);
      const pid = String(r.rows[0].id);
      await c.query("select app.definir_destaque($1, $2)", [pid, fd.get("destaque") === "on"]);
      await c.query("select app.definir_novidade($1, $2)", [pid, fd.get("novidade") === "on"]);
      const cod = (await c.query("select codigo from app.produtos where id = $1", [pid])).rows[0].codigo;
      const precos = TABELAS.map((t) => ({ codigo: cod, tabela: t, valor: numero(fd, t) })).filter((p) => p.valor != null);
      if (precos.length) await c.query("select app.importar_precos($1::jsonb)", [JSON.stringify(precos)]);
      if (bytes && ext) {
        await mkdir(pastaFotos(), { recursive: true });
        const nome = `${pid}-${Date.now()}.${ext}`;
        await writeFile(path.join(pastaFotos(), nome), bytes);
        fotoNova = nome;
        const antiga = (await c.query("select app.definir_foto($1, $2) as antiga", [pid, `/fotos/${nome}`])).rows[0].antiga as string | null;
        if (antiga) await rm(path.join(pastaFotos(), path.basename(antiga)), { force: true });
      }
      return pid;
    });
    destino = `/produtos/${id}?ok=${encodeURIComponent(idAtual ? "Produto salvo." : "Produto criado.")}`;
  } catch (e) {
    if (fotoNova) await rm(path.join(pastaFotos(), fotoNova), { force: true });   // a transação voltou atrás: some o arquivo também
    destino = `${idAtual ? `/produtos/${idAtual}` : "/produtos/novo"}?erro=${encodeURIComponent(mensagemErro(e))}`;
  }
  revalidatePath("/produtos");
  revalidatePath("/loja");
  redirect(destino);
}

export async function removerFoto(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  let q = "ok=" + encodeURIComponent("Foto removida.");
  try {
    const antiga = await comUsuario(u.id, async (c) => (await c.query("select app.definir_foto($1, null) as antiga", [id])).rows[0].antiga as string | null);
    if (antiga) await rm(path.join(pastaFotos(), path.basename(antiga)), { force: true });
  } catch (e) {
    q = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  revalidatePath("/loja");
  redirect(`/produtos/${id}?${q}`);
}
