"use server";

import path from "node:path";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { texto } from "@/lib/formato";
import { pastaFotos } from "@/lib/arquivos";

/** Salva as escolhas da lista e, com acao=lancar, já soma no estoque da unidade. */
export async function salvarLista(fd: FormData) {
  const u = await exigirUsuario();
  const lista = texto(fd, "lista");
  const lancar = texto(fd, "acao") === "lancar";
  let erro: string | null = null, ok = "";
  try {
    if (!ehGestao(u)) throw new Error("Só gerente ou dono confere a lista de inventário.");
    const linhas: { id: string; decisao: string; produto_id: string | null; quantidade: string }[] = [];
    for (const [k, v] of fd.entries()) {
      const m = k.match(/^d:([0-9a-f-]{36})$/);
      if (!m) continue;
      const escolha = String(v);
      const decisao = escolha.startsWith("p:") ? "existente" : escolha === "novo" || escolha === "ignorar" ? escolha : "pendente";
      linhas.push({ id: m[1], decisao, produto_id: escolha.startsWith("p:") ? escolha.slice(2) : null, quantidade: String(fd.get(`q:${m[1]}`) ?? "") });
    }
    const r = await comUsuario(u.id, async (c) => {
      await c.query("select app.inventario_lista_decidir($1::jsonb)", [JSON.stringify(linhas)]);
      if (!lancar) return null;
      return (await c.query("select app.inventario_lista_lancar($1) r", [lista])).rows[0].r as
        { existentes: number; novos: number; ignorados: number; fotos: { produto_id: string; foto_ref: string }[] };
    });
    if (!r) ok = "Escolhas salvas. Nada foi lançado no estoque ainda.";
    else {
      // a foto da lista vira a foto do produto que ainda não tinha
      let fotos = 0;
      await mkdir(pastaFotos(), { recursive: true });
      for (const f of r.fotos) {
        const origem = path.join(process.cwd(), "public", "inventario-cde", path.basename(f.foto_ref));
        const nome = `${f.produto_id}-${Date.now()}.jpg`;
        try {
          await copyFile(origem, path.join(pastaFotos(), nome));
          await comUsuario(u.id, (c) => c.query("select app.definir_foto($1, $2)", [f.produto_id, `/fotos/${nome}`]));
          fotos++;
        } catch {
          await rm(path.join(pastaFotos(), nome), { force: true });
        }
      }
      ok = `Lançado no estoque: ${r.existentes} item(ns) somado(s) em produtos que já existiam, ${r.novos} produto(s) novo(s) cadastrado(s)`
        + (r.ignorados ? `, ${r.ignorados} deixado(s) de fora` : "") + (fotos ? `. ${fotos} produto(s) ganharam a foto da lista` : "") + ".";
    }
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/estoque");
  revalidatePath("/estoque/inventario/lista");
  revalidatePath("/produtos");
  redirect(`/estoque/inventario/lista?l=${encodeURIComponent(lista)}&${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
}
