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

/** Grava a imagem enviada no formulário (JPG, PNG ou WEBP, até 8 MB) e devolve o endereço /fotos/... */
async function salvarImagem(fd: FormData, campo: string): Promise<string | null> {
  const arq = fd.get(campo);
  if (!(arq instanceof File) || arq.size === 0) return null;
  if (arq.size > 8 * 1024 * 1024) throw new Error("Imagem grande demais: máximo 8 MB.");
  const bytes = Buffer.from(await arq.arrayBuffer());
  const ext = tipoImagem(bytes);
  if (!ext) throw new Error("A imagem precisa ser JPG, PNG ou WEBP.");
  await mkdir(pastaFotos(), { recursive: true });
  const nome = `${randomUUID()}-${Date.now()}.${ext}`;
  await writeFile(path.join(pastaFotos(), nome), bytes);
  return `/fotos/${nome}`;
}
const apagarArquivo = (img: string | null | undefined) => img ? rm(path.join(pastaFotos(), path.basename(img)), { force: true }) : Promise.resolve();

export async function criarBanner(fd: FormData) {
  await executar("Banner criado.", async (uid) => {
    const imagem = await salvarImagem(fd, "imagem");
    let celular: string | null = null;
    try {
      celular = await salvarImagem(fd, "imagem_celular");
      await comUsuario(uid, (c) => c.query(
        `insert into app.banners (titulo, subtitulo, imagem, link, idioma, ordem, inicio, fim, criado_por, imagem_celular)
         values ($1, nullif($2,''), $3, $4, $5, coalesce(nullif($6,'')::int, 0), nullif($7,'')::date, nullif($8,'')::date, app.uid(), $9)`,
        [texto(fd, "titulo"), texto(fd, "subtitulo"), imagem, link(fd), texto(fd, "idioma") || "todos", texto(fd, "ordem"), texto(fd, "inicio"), texto(fd, "fim"), celular]));
    } catch (e) {
      await apagarArquivo(imagem); await apagarArquivo(celular);
      throw e;
    }
  });
}

/** Troca o idioma de um banner já cadastrado (quem vê: português, espanhol ou os dois). */
export async function idiomaBanner(fd: FormData) {
  const idioma = texto(fd, "idioma");
  await executar("Idioma do banner atualizado.", async (uid) => {
    if (!["todos", "pt", "es"].includes(idioma)) throw new Error("Idioma inválido.");
    await comUsuario(uid, (c) => c.query("update app.banners set idioma = $2 where id = $1", [texto(fd, "id"), idioma]));
  });
}

/** Coloca, troca ou tira a imagem para celular de um banner já cadastrado. */
export async function celularBanner(fd: FormData) {
  const tirar = texto(fd, "tirar") === "1";
  await executar(tirar ? "Imagem do celular removida." : "Imagem do celular salva.", async (uid) => {
    const nova = tirar ? null : await salvarImagem(fd, "imagem_celular");
    if (!tirar && !nova) throw new Error("Escolha a imagem para celular.");
    try {
      const antiga = await comUsuario(uid, async (c) => {
        const a = (await c.query("select imagem_celular from app.banners where id = $1", [texto(fd, "id")])).rows[0]?.imagem_celular as string | null;
        await c.query("update app.banners set imagem_celular = $2 where id = $1", [texto(fd, "id"), nova]);
        return a;
      });
      await apagarArquivo(antiga);
    } catch (e) {
      await apagarArquivo(nova);
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
    const r = await comUsuario(uid, async (c) =>
      (await c.query("delete from app.banners where id = $1 returning imagem, imagem_celular", [texto(fd, "id")])).rows[0] as { imagem: string | null; imagem_celular: string | null } | undefined);
    await apagarArquivo(r?.imagem); await apagarArquivo(r?.imagem_celular);
  });
}

export async function atenderCadastro(fd: FormData) {
  const u = await exigirUsuario();
  await comUsuario(u.id, (c) => c.query(
    "update app.cadastros_site set atendido_em = now(), atendido_por = app.uid() where id = $1 and atendido_em is null", [texto(fd, "id")]));
  revalidatePath("/");
  revalidatePath("/site");
}

/** "Quero ser cliente": aprova e cria o cliente (ou liga a um cliente que já existe com o mesmo WhatsApp/documento). */
export async function aprovarCadastro(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null, cli = "";
  try {
    cli = await comUsuario(u.id, async (c) => String((await c.query("select app.aprovar_cadastro_site($1, $2) id",
      [texto(fd, "id"), texto(fd, "vendedora_id") || null])).rows[0].id));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/"); revalidatePath("/site"); revalidatePath("/clientes");
  if (erro) redirect(`/site?erro=${encodeURIComponent(erro)}#cadastros`);
  redirect(`/clientes/${cli}?ok=${encodeURIComponent("Cliente criado a partir do cadastro do site. Confira os dados e crie o acesso dele à loja.")}`);
}

/** Mensagem que o cliente vê ao abrir a loja. "Mostrar de novo" faz todos os clientes verem a mensagem nova. */
export async function salvarMensagemCliente(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  const g = (k: string) => String(fd.get(k) ?? "");
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono muda a mensagem dos clientes.");
    await comUsuario(u.id, (c) => c.query("select app.salvar_mensagem_cliente($1, $2, $3, $4, $5, $6, $7, $8)",
      [fd.get("ativo") === "1", g("titulo_pt"), g("texto_pt"), g("botao_pt"), g("titulo_es"), g("texto_es"), g("botao_es"), fd.get("de_novo") === "1"]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/site"); revalidatePath("/loja", "layout");
  redirect(`/site?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(fd.get("de_novo") === "1" ? "Mensagem salva: todos os clientes vão ver na próxima vez que abrirem a loja." : "Mensagem salva.")}#mensagem`);
}
