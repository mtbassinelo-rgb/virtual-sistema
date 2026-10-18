"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { avisarEquipe } from "@/lib/email";
import { numero, texto } from "@/lib/formato";

function voltar(erro: string | null, ok: string) {
  revalidatePath("/procuras");
  redirect(`/procuras?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
}

/** Vendedora (ou gerente) registra um produto que o cliente pediu e não temos. */
export async function registrarProcura(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    const produto = texto(fd, "produto").trim();
    if (produto.length < 2) throw new Error("Informe o produto que o cliente pediu.");
    const q = numero(fd, "quantidade");
    if (q !== null && q <= 0) throw new Error("Quantidade inválida.");
    const nome = await comUsuario(u.id, async (c) => {
      // reconhece o produto cadastrado pelo código ("COD · nome" da lista) ou pela descrição igual
      const cod = produto.split(" · ")[0].trim();
      const achado = (await c.query(
        `select id, nome from app.produtos where codigo = $1 or app.nome_normal(nome) = app.nome_normal($2)
          order by (codigo = $1) desc limit 1`, [cod, produto])).rows[0];
      const cliente = texto(fd, "cliente_id") || null;
      await c.query(
        `insert into app.procuras (produto_id, descricao, quantidade, cliente_id, origem, observacao, criado_por)
         values ($1, $2, $3, $4, 'vendedora', nullif($5, ''), app.uid())`,
        [achado?.id ?? null, achado ? null : produto.slice(0, 200), q, cliente, texto(fd, "observacao").slice(0, 500)]);
      return (achado?.nome as string | undefined) ?? produto;
    });
    await avisarEquipe(`Produto procurado sem estoque: ${nome}`,
      `${u.nome} registrou que um cliente pediu: ${nome}${q ? ` (${q} un.)` : ""}.\nVeja em Relatórios → Procurados sem estoque.`);
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar(erro, "Registrado. O gerente vê na lista de procurados para as próximas compras.");
}

/** Gerente marca as procuras de um produto como vistas (some do contador). */
export async function marcarVisto(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    const chave = texto(fd, "chave");
    const r = await comUsuario(u.id, (c) => c.query(
      `update app.procuras set visto_em = now(), visto_por = app.uid()
        where visto_em is null and coalesce(produto_id::text, 'x:' || app.nome_normal(descricao)) = $1`, [chave]));
    if (r.rowCount === 0) throw new Error("Nada para marcar (ou sem permissão).");
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar(erro, "Marcado como visto.");
}

/** "Chegou": a vendedora avisou o cliente pelo WhatsApp que o produto voltou ao estoque. */
export async function marcarAvisado(fd: FormData) {
  const u = await exigirUsuario();
  const id = String(fd.get("id") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(id)) await comUsuario(u.id, (c) => c.query("select app.marcar_procura_avisada($1)", [id]));
  revalidatePath("/procuras");
}
