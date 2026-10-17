"use server";

import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { texto } from "@/lib/formato";
import { pastaFotos, pastaFotosCatalogo } from "@/lib/arquivos";

const ID = /^p[0-9]{2}-[0-9]{2}$/;
/** Só volta para a própria tela de fotos (evita redirecionar para outro site). */
const destino = (fd: FormData) => { const v = texto(fd, "volta"); return /^\/produtos\/fotos(\?[\w=&%-]*)?$/.test(v) ? v : "/produtos/fotos"; };

/** Usa a foto do catálogo no produto escolhido (substitui a foto atual, se houver). */
export async function aplicarFoto(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  const volta = destino(fd);
  let q: string;
  let novo: string | null = null;
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono confirma as fotos.");
    if (!ID.test(id)) throw new Error("Foto inválida.");
    // aceita o id do produto (botões de sugestão) ou "código — nome" (campo de busca)
    const escolha = texto(fd, "produto_id") || texto(fd, "produto").split(" — ")[0].trim();
    if (!escolha) throw new Error("Escolha o produto.");
    const nome = await comUsuario(u.id, async (c) => {
      const p = (await c.query(
        "select id, nome from app.produtos where id::text = $1 or codigo = $1 order by (id::text = $1) desc limit 1", [escolha])).rows[0];
      if (!p) throw new Error(`Produto "${escolha}" não encontrado. Escolha da lista.`);
      await mkdir(pastaFotos(), { recursive: true });
      const arq = `${p.id}-${Date.now()}.webp`;
      await copyFile(path.join(pastaFotosCatalogo(), `${id}.webp`), path.join(pastaFotos(), arq));
      novo = arq;
      const antiga = (await c.query("select app.definir_foto($1, $2) as antiga", [p.id, `/fotos/${arq}`])).rows[0].antiga as string | null;
      await c.query("select app.decidir_foto_catalogo($1, 'aplicar', $2)", [id, p.id]);
      if (antiga) await rm(path.join(pastaFotos(), path.basename(antiga)), { force: true });
      return String(p.nome);
    });
    q = "ok=" + encodeURIComponent(`Foto colocada em: ${nome}`);
  } catch (e) {
    if (novo) await rm(path.join(pastaFotos(), novo), { force: true });
    q = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  revalidatePath("/loja");
  revalidatePath("/produtos");
  redirect(`${volta}${volta.includes("?") ? "&" : "?"}${q}#f-${id}`);
}

export async function descartarFoto(fd: FormData) {
  await decidir(fd, "descartar", "Foto descartada.");
}

export async function reabrirFoto(fd: FormData) {
  await decidir(fd, "reabrir", "Foto voltou para conferir.");
}

async function decidir(fd: FormData, acao: string, msg: string) {
  const u = await exigirUsuario();
  const id = texto(fd, "id");
  const volta = destino(fd);
  let q = "ok=" + encodeURIComponent(msg);
  try {
    if (!ID.test(id)) throw new Error("Foto inválida.");
    await comUsuario(u.id, (c) => c.query("select app.decidir_foto_catalogo($1, $2, null)", [id, acao]));
  } catch (e) {
    q = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  redirect(`${volta}${volta.includes("?") ? "&" : "?"}${q}`);
}
