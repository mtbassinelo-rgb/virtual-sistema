"use server";

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { texto } from "@/lib/formato";
import { pastaFotos, tipoImagem } from "@/lib/arquivos";

async function executar(ok: string, fn: (uid: string) => Promise<unknown>) {
  const u = await exigirUsuario();
  let q = "ok=" + encodeURIComponent(ok);
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono altera o site.");
    await fn(u.id);
  } catch (e) {
    q = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  revalidatePath("/site");
  revalidatePath("/loja");
  redirect(`/site?${q}`);
}

/** Link do banner: uma busca/produto do próprio site ou um endereço https. */
function link(fd: FormData): string | null {
  const l = texto(fd, "link");
  if (!l) return null;
  if (l.startsWith("/loja") || l.startsWith("https://")) return l;
  const m = /^https?:\/\/(www\.)?distribuidoravirtualcosmeticos\.com(\/loja.*)$/.exec(l);
  if (m) return m[2];
  throw new Error("Link do banner: cole um endereço do site (ex.: /loja?linha=kits) ou um link https.");
}

export async function criarBanner(fd: FormData) {
  await executar("Banner criado.", async (uid) => {
    let imagem: string | null = null;
    const arq = fd.get("imagem");
    if (arq instanceof File && arq.size > 0) {
      if (arq.size > 8 * 1024 * 1024) throw new Error("Imagem grande demais: máximo 8 MB.");
      const bytes = Buffer.from(await arq.arrayBuffer());
      const ext = tipoImagem(bytes);
      if (!ext) throw new Error("A imagem precisa ser JPG, PNG ou WEBP.");
      await mkdir(pastaFotos(), { recursive: true });
      const nome = `${randomUUID()}-${Date.now()}.${ext}`;
      await writeFile(path.join(pastaFotos(), nome), bytes);
      imagem = `/fotos/${nome}`;
    }
    try {
      await comUsuario(uid, (c) => c.query(
        `insert into app.banners (titulo, subtitulo, imagem, link, idioma, ordem, inicio, fim, criado_por)
         values ($1, nullif($2,''), $3, $4, $5, coalesce(nullif($6,'')::int, 0), nullif($7,'')::date, nullif($8,'')::date, app.uid())`,
        [texto(fd, "titulo"), texto(fd, "subtitulo"), imagem, link(fd), texto(fd, "idioma") || "todos", texto(fd, "ordem"), texto(fd, "inicio"), texto(fd, "fim")]));
    } catch (e) {
      if (imagem) await rm(path.join(pastaFotos(), path.basename(imagem)), { force: true });
      throw e;
    }
  });
}

export async function alternarBanner(fd: FormData) {
  await executar("Banner atualizado.", (uid) => comUsuario(uid, (c) =>
    c.query("update app.banners set ativo = not ativo where id = $1", [texto(fd, "id")])));
}

export async function ordemBanner(fd: FormData) {
  await executar("Ordem atualizada.", (uid) => comUsuario(uid, (c) =>
    c.query("update app.banners set ordem = ordem + $2 where id = $1", [texto(fd, "id"), Number(texto(fd, "passo")) || 0])));
}

export async function apagarBanner(fd: FormData) {
  await executar("Banner apagado.", async (uid) => {
    const img = await comUsuario(uid, async (c) =>
      (await c.query("delete from app.banners where id = $1 returning imagem", [texto(fd, "id")])).rows[0]?.imagem as string | null);
    if (img) await rm(path.join(pastaFotos(), path.basename(img)), { force: true });
  });
}

export async function atenderCadastro(fd: FormData) {
  const u = await exigirUsuario();
  await comUsuario(u.id, (c) => c.query(
    "update app.cadastros_site set atendido_em = now(), atendido_por = app.uid() where id = $1 and atendido_em is null", [texto(fd, "id")]));
  revalidatePath("/");
  revalidatePath("/site");
}
