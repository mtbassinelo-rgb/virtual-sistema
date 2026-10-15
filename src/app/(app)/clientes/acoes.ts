"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { texto } from "@/lib/formato";

function campos(fd: FormData) {
  return [
    texto(fd, "nome"), texto(fd, "telefone"), texto(fd, "whatsapp"), texto(fd, "cidade"), texto(fd, "departamento"),
    texto(fd, "pais") || null, texto(fd, "categoria_preco") || "normal", texto(fd, "perfil_comercial"),
    texto(fd, "preferencias"), texto(fd, "observacoes"),
  ];
}

export async function criarCliente(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  let id = "";
  try {
    if (!texto(fd, "nome")) throw new Error("Informe o nome do cliente.");
    const vendedora = texto(fd, "vendedora_id") || u.vendedora_id;
    if (!vendedora) throw new Error("Escolha a vendedora responsável.");
    id = await comUsuario(u.id, async (c) => (await c.query(
      `insert into app.clientes (nome, telefone, whatsapp, cidade, departamento, pais, categoria_preco,
                                 perfil_comercial, preferencias, observacoes, vendedora_id)
       values ($1, nullif($2,''), nullif($3,''), nullif($4,''), nullif($5,''), $6::app.pais, $7::app.categoria_preco,
               nullif($8,''), nullif($9,''), nullif($10,''), $11) returning id`,
      [...campos(fd), vendedora])).rows[0].id);
  } catch (e) {
    erro = mensagemErro(e);
  }
  if (erro) redirect(`/clientes?erro=${encodeURIComponent(erro)}`);
  revalidatePath("/clientes");
  redirect(`/clientes/${id}?ok=${encodeURIComponent("Cliente cadastrado.")}`);
}

export async function salvarCliente(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query(
      `update app.clientes set nome = $1, telefone = nullif($2,''), whatsapp = nullif($3,''), cidade = nullif($4,''),
              departamento = nullif($5,''), pais = coalesce($6::app.pais, pais), categoria_preco = $7::app.categoria_preco,
              perfil_comercial = nullif($8,''), preferencias = nullif($9,''), observacoes = nullif($10,'')
        where id = $11`,
      [...campos(fd), id]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/clientes/${id}`);
  redirect(`/clientes/${id}?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Cadastro salvo.")}`);
}

export async function atendimentoCliente(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query(
      `insert into app.atendimentos (cliente_id, tipo, resultado, nota, usuario_id)
       values ($1, $2::app.tipo_atendimento, nullif($3,''), nullif($4,''), app.uid())`,
      [id, texto(fd, "tipo"), texto(fd, "resultado"), texto(fd, "nota")]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/clientes/${id}`);
  redirect(`/clientes/${id}?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Atendimento registrado.")}`);
}
