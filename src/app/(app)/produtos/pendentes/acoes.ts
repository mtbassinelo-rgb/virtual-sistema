"use server";

import { createHash } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";
import { pastaArquivos, pastaFotos, tipoImagem } from "@/lib/arquivos";

const UUID = /^[0-9a-f-]{36}$/i;
const MAX = 10 * 1024 * 1024;

function voltar(erro: string | null, ok: string) {
  revalidatePath("/produtos/pendentes");
  redirect(`/produtos/pendentes?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
}
/** "20.000" → 20000 · "39,90" → 39.9 */
function preco(fd: FormData, campo: string): number | null {
  let t = texto(fd, campo).replace(/\s|R\$|Gs/gi, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Preço inválido: "${texto(fd, campo)}"`);
  return n;
}

/** Vendedora envia o produto: foto, quantidade e preço ofertado. */
export async function enviarPendente(fd: FormData) {
  let erro: string | null = null;
  try {
    const u = await exigirUsuario();
    const arq = fd.get("foto");
    const temFoto = arq instanceof File && arq.size > 0;
    let desc = texto(fd, "descricao").trim();
    const qtd = numero(fd, "quantidade");
    if (!qtd || qtd <= 0) throw new Error("Informe a quantidade (em unidades).");
    const normal = preco(fd, "preco_normal");
    if (!normal) throw new Error("Informe o preço ofertado.");
    const vip = preco(fd, "preco_vip");
    const dep = texto(fd, "deposito_id");
    if (!UUID.test(dep)) throw new Error("Escolha a unidade.");
    const existente = texto(fd, "produto").split(" · ")[0].trim();
    await comUsuario(u.id, async (c) => {
      let prodId: string | null = null;
      if (existente) {
        const p = (await c.query(
          `select p.id, p.nome from app.produtos p where p.codigo = $1
           union all select p.id, p.nome from app.produto_codigos x join app.produtos p on p.id = x.produto_id where x.codigo = $1 limit 1`, [existente])).rows[0];
        if (!p) throw new Error(`Produto "${existente}" não encontrado. Escolha da lista ou deixe vazio se for produto novo.`);
        prodId = String(p.id);
        if (desc.length < 2) desc = String(p.nome);
      }
      if (desc.length < 2) throw new Error("Escreva o nome do produto.");
      if (!temFoto && !prodId) throw new Error("Tire a foto do produto (ou escolha o produto que já existe no sistema).");
      let nome = "", mime = "";
      if (temFoto) {
        if (arq.size > MAX) throw new Error("Foto maior que 10 MB.");
        const bytes = Buffer.from(await arq.arrayBuffer());
        const ext = tipoImagem(bytes);
        if (!ext) throw new Error("A foto precisa ser JPG, PNG ou WEBP.");
        nome = `pend-${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${ext}`;
        mime = `image/${ext === "jpg" ? "jpeg" : ext}`;
        await mkdir(pastaArquivos(), { recursive: true });
        await writeFile(path.join(pastaArquivos(), nome), bytes);
      }
      await c.query("select app.enviar_produto_pendente($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        [dep, desc.slice(0, 200), texto(fd, "marca").slice(0, 80), qtd, normal, vip, nome, mime || null, texto(fd, "observacao").slice(0, 500), prodId]);
    });
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar(erro, "Enviado! O gerente confere e o produto entra no catálogo.");
}

/** Gerente/dono: "Atualizar" — produto entra no estoque, com preço e foto, e aparece no catálogo. */
export async function aprovarPendente(fd: FormData) {
  let erro: string | null = null;
  let ok = "";
  try {
    const u = await exigirUsuario();
    if (!ehGestao(u)) throw new Error("Só gerente ou dono atualiza.");
    const id = texto(fd, "id");
    if (!UUID.test(id)) throw new Error("Pendente inválido.");
    const qtd = numero(fd, "quantidade");
    const normal = preco(fd, "preco_normal");
    const vip = preco(fd, "preco_vip");
    const existente = texto(fd, "produto").split(" · ")[0].trim();
    ok = await comUsuario(u.id, async (c) => {
      let prodId: string | null = null;
      if (existente) {
        const p = (await c.query(
          `select id from app.produtos where codigo = $1 union all select produto_id from app.produto_codigos where codigo = $1 limit 1`, [existente])).rows[0];
        if (!p) throw new Error(`Produto "${existente}" não encontrado. Escolha da lista ou deixe vazio para criar um novo.`);
        prodId = String(p.id);
      }
      const pend = (await c.query("select foto, descricao from app.produtos_pendentes where id = $1", [id])).rows[0];
      const r = (await c.query("select app.aprovar_produto_pendente($1, $2, $3, $4, $5, $6, $7) r",
        [id, prodId, texto(fd, "descricao").slice(0, 200), texto(fd, "marca").slice(0, 80), qtd, normal, vip])).rows[0].r as
        { produto_id: string; codigo: string; sem_foto: boolean };
      if (r.sem_foto && pend?.foto) {
        const orig = path.join(pastaArquivos(), path.basename(String(pend.foto)));
        const ext = path.extname(orig).replace(".", "") || "jpg";
        const nome = `${r.produto_id}-${Date.now()}.${ext}`;
        await mkdir(pastaFotos(), { recursive: true });
        await copyFile(orig, path.join(pastaFotos(), nome));
        await c.query("select app.definir_foto($1, $2)", [r.produto_id, `/fotos/${nome}`]);
      }
      return `${pend?.descricao ?? "Produto"} atualizado (${r.codigo}): estoque, preço e foto no catálogo.`;
    });
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/produtos");
  revalidatePath("/loja");
  voltar(erro, ok);
}

export async function recusarPendente(fd: FormData) {
  let erro: string | null = null;
  try {
    const u = await exigirUsuario();
    if (!ehGestao(u)) throw new Error("Só gerente ou dono decide.");
    const id = texto(fd, "id");
    if (!UUID.test(id)) throw new Error("Pendente inválido.");
    await comUsuario(u.id, (c) => c.query("select app.recusar_produto_pendente($1, $2)", [id, texto(fd, "motivo")]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar(erro, "Pendente recusado.");
}
