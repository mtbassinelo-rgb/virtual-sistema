"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";

function campos(fd: FormData) {
  return [
    texto(fd, "nome"), texto(fd, "telefone"), texto(fd, "whatsapp"), texto(fd, "cidade"), texto(fd, "departamento"),
    texto(fd, "pais") || null, texto(fd, "categoria_preco") || "normal", texto(fd, "perfil_comercial"),
    texto(fd, "preferencias"), texto(fd, "observacoes"),
  ];
}

/** Volta para a ficha do cliente na mesma aba em que o formulário estava. */
function voltaCli(fd: FormData, id: string) {
  const aba = String(fd.get("aba") ?? "");
  return `/clientes/${id}?${/^[a-z]{3,12}$/.test(aba) ? `aba=${aba}&` : ""}`;
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
                                 perfil_comercial, preferencias, observacoes, vendedora_id, deposito_id)
       values ($1, nullif($2,''), nullif($3,''), nullif($4,''), nullif($5,''), $6::app.pais, $7::app.categoria_preco,
               nullif($8,''), nullif($9,''), nullif($10,''), $11, (select id from app.depositos where id::text = nullif($12, ''))) returning id`,
      [...campos(fd), vendedora, texto(fd, "deposito")])).rows[0].id);
  } catch (e) {
    erro = mensagemErro(e);
  }
  let extra = "";
  if (!erro && texto(fd, "pedir_unidade") === "1" && (texto(fd, "categoria_preco") || "normal") === "normal") {
    try {
      const r = await comUsuario(u.id, async (c) => String((await c.query("select app.sugerir_compra_unidade($1) r", [id])).rows[0].r));
      extra = r === "sugerido" ? " Compra por unidade enviada para o gerente aprovar." : " Compra por unidade liberada.";
    } catch (e) {
      extra = " Não foi possível pedir a compra por unidade: " + mensagemErro(e);
    }
  }
  if (erro) redirect(`/clientes?erro=${encodeURIComponent(erro)}`);
  revalidatePath("/clientes");
  redirect(`${voltaCli(fd, id)}ok=${encodeURIComponent("Cliente cadastrado." + extra)}`);
}

/** Gerente ou dono troca a vendedora responsável; pedidos em andamento podem passar junto. */
export async function trocarVendedoraCliente(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  const nova = texto(fd, "vendedora_id");
  const comPedidos = texto(fd, "pedidos_abertos") === "1";
  let erro: string | null = null, n = 0;
  try {
    n = await comUsuario(u.id, async (c) => Number((await c.query("select app.trocar_vendedora_cliente($1, $2::uuid, $3) n", [id, nova, comPedidos])).rows[0].n));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/clientes/${id}`);
  revalidatePath("/clientes");
  const volta = texto(fd, "volta");
  const destino = volta.startsWith("/clientes?") ? volta + "&" : `${voltaCli(fd, id)}`;
  redirect(`${destino}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Vendedora do cliente trocada." + (n ? ` ${n} pedido(s) em andamento passaram para ela.` : ""))}`);
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
    // e-mail do cliente: usado para ele mesmo redefinir a senha da loja
    await comUsuario(u.id, (c) => c.query("update app.clientes set email = nullif(lower(trim($1)), '') where id = $2", [texto(fd, "email"), id]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/clientes/${id}`);
  redirect(`${voltaCli(fd, id)}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Cadastro salvo.")}`);
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
  redirect(`${voltaCli(fd, id)}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Atendimento registrado.")}`);
}

export async function convidarCliente(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  const { headers } = await import("next/headers");
  const { novoToken, sha256, urlPortal } = await import("@/lib/portal");
  let erro: string | null = null;
  let link = "";
  try {
    const token = novoToken();
    await comUsuario(u.id, (c) => c.query("select app.gerar_convite_portal($1, $2)", [id, sha256(token)]));
    const h = await headers();
    link = `${urlPortal(h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto"))}/loja/entrar/${token}`;
  } catch (e) {
    erro = mensagemErro(e);
  }
  if (erro) redirect(`${voltaCli(fd, id)}erro=${encodeURIComponent(erro)}`);
  redirect(`${voltaCli(fd, id)}convite=${encodeURIComponent(link)}`);
}

export async function bloquearCliente(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.bloquear_portal($1)", [id]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/clientes/${id}`);
  redirect(`${voltaCli(fd, id)}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Acesso à área do cliente bloqueado.")}`);
}

export async function depositoCliente(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("update app.clientes set deposito_id = nullif($2,'')::uuid where id = $1", [id, texto(fd, "deposito_id")]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/clientes/${id}`);
  redirect(`${voltaCli(fd, id)}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Depósito do cliente atualizado.")}`);
}

/** Compra por unidade no site: a vendedora pede ao gerente; gerente ou dono libera direto. Só cliente de preço Normal (BR ou PY). */
export async function pedirCompraUnidade(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  let erro: string | null = null, r = "";
  try {
    r = await comUsuario(u.id, async (c) => String((await c.query("select app.sugerir_compra_unidade($1) r", [id])).rows[0].r));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/clientes/${id}`);
  revalidatePath("/clientes");
  redirect(`${voltaCli(fd, id)}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(r === "sugerido" ? "Pedido enviado ao gerente: ele aprova a compra por unidade." : "Cliente liberado para comprar por unidade no site.")}`);
}

/** Gestão aprova ou recusa o pedido da vendedora, ou volta o cliente para só caixa fechada. */
export async function decidirCompraUnidade(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  const liberar = texto(fd, "liberar") === "1";
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.decidir_compra_unidade($1, $2)", [id, liberar]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/clientes/${id}`);
  revalidatePath("/clientes");
  const destino = texto(fd, "volta") === "lista" ? "/clientes?compra=aguardando&" : `${voltaCli(fd, id)}`;
  redirect(`${destino}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(liberar ? "Compra por unidade liberada." : "Cliente compra só caixa fechada.")}`);
}

/** Retire em Foz: a vendedora sugere o cliente como local (da região); gerente ou dono marca direto. */
export async function sugerirClienteLocal(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  let erro: string | null = null, r = "";
  try {
    r = await comUsuario(u.id, async (c) => String((await c.query("select app.sugerir_cliente_local($1) r", [id])).rows[0].r));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/clientes/${id}`);
  redirect(`${voltaCli(fd, id)}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(r === "sugerido" ? "Sugestão enviada ao gerente." : "Cliente marcado como local: pode retirar em Foz.")}`);
}

/** Gestão aprova ou recusa a sugestão de cliente local, ou desmarca. */
export async function decidirClienteLocal(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  const local = texto(fd, "local") === "1";
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.decidir_cliente_local($1, $2)", [id, local]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  const volta = texto(fd, "volta");
  revalidatePath(`/clientes/${id}`);
  revalidatePath("/inteligencia");
  const destino = volta === "inteligencia" ? "/inteligencia?aba=retirada&" : `${voltaCli(fd, id)}`;
  redirect(`${destino}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(local ? "Cliente marcado como local." : "Cliente não é mais local.")}`);
}

export type RespostaAcesso = { erro?: string; login?: string; senha?: string; mensagem?: string; whatsapp?: string | null };

/** Cria (ou refaz) o acesso do cliente: documento + a senha que a vendedora digitar (ou 6 números sorteados se deixar em branco).
 *  O cliente usa essa senha normalmente; trocar por uma dele é opcional (Minha área). */
export async function criarAcessoCliente(_: RespostaAcesso, fd: FormData): Promise<RespostaAcesso> {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  const documento = texto(fd, "documento");
  try {
    const { randomInt } = await import("node:crypto");
    const { hash } = await import("@node-rs/argon2");
    const { headers } = await import("next/headers");
    const { urlPortal } = await import("@/lib/portal");
    const digitada = String(fd.get("senha") ?? "").trim();
    if (digitada && digitada.length < 6) return { erro: "A senha precisa ter pelo menos 6 caracteres." };
    if (digitada.length > 64) return { erro: "Senha longa demais." };
    const senha = digitada || String(randomInt(0, 1_000_000)).padStart(6, "0");
    const senhaHash = await hash(senha, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const cli = await comUsuario(u.id, async (c) => {
      await c.query("select app.definir_acesso_cliente($1, $2, $3)", [id, documento, senhaHash]);
      return (await c.query(
        "select c.nome, c.pais, c.whatsapp, c.telefone, v.nome as vendedora from app.clientes c join app.vendedoras v on v.id = c.vendedora_id where c.id = $1", [id])).rows[0];
    });
    const h = await headers();
    const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").replace(/^app\.|^teste\./, "");
    const site = `${urlPortal(host || null, h.get("x-forwarded-proto"))}/loja/acesso`;
    const mensagem = cli.pais === "PY"
      ? `¡Hola ${cli.nome}! Soy ${cli.vendedora}, de Virtual Cosméticos. Ya puede ver el catálogo con sus precios y hacer pedidos:\n${site}\nUsuario: ${documento}\nContraseña: ${senha}\nSi quiere, puede cambiar la contraseña en "Mi área".`
      : `Olá ${cli.nome}! Aqui é a ${cli.vendedora}, da Virtual Cosméticos. Agora você pode ver o catálogo com os seus preços e fazer pedidos:\n${site}\nUsuário: ${documento}\nSenha: ${senha}\nSe quiser, você pode trocar a senha em "Minha área".`;
    revalidatePath(`/clientes/${id}`);
    return { login: documento, senha, mensagem, whatsapp: cli.whatsapp ?? cli.telefone };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

/** Linha de crédito do cliente (vendedora da carteira ou gerência). */
export async function definirCredito(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  const num = (k: string) => { const v = texto(fd, k).replace(/\./g, "").replace(",", "."); return v ? Number(v) : null; };
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.definir_credito_cliente($1, $2, $3, $4)",
      [id, fd.get("credito") === "on", num("limite"), num("prazo")]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/clientes/${id}`);
  redirect(`${voltaCli(fd, id)}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Linha de crédito atualizada.")}`);
}

/** Vendedora sugere a linha de crédito; o gerente/dono decide. */
export async function sugerirCredito(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  const num = (k: string) => { const v = texto(fd, k).replace(/\./g, "").replace(",", "."); return v ? Number(v) : null; };
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.sugerir_credito_cliente($1, $2, $3, $4)", [id, num("limite"), num("prazo"), texto(fd, "obs")]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/clientes/${id}`);
  redirect(`${voltaCli(fd, id)}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Sugestão de crédito enviada para o gerente aprovar.")}`);
}

export async function recusarSugestaoCredito(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.recusar_sugestao_credito($1)", [id]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/clientes/${id}`);
  redirect(`${voltaCli(fd, id)}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Sugestão de crédito recusada.")}`);
}

/** Recompra: registra que a vendedora chamou o cliente (vira um atendimento por WhatsApp). */
export async function registrarContatoRecompra(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query(
      `insert into app.atendimentos (cliente_id, tipo, resultado, nota, usuario_id) values ($1, 'whatsapp', 'Recompra', nullif($2, ''), app.uid())`,
      [id, texto(fd, "nota")]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  const volta = texto(fd, "volta") || "/clientes/recompra";
  revalidatePath("/clientes/recompra");
  redirect(`${volta}${volta.includes("?") ? "&" : "?"}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Contato registrado.")}`);
}

/** Ativa ou desativa o cliente (só gerente ou dono). Inativo some das listas, mas continua no sistema e sendo atualizado. */
export async function ativarCliente(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  const ativo = texto(fd, "ativo") === "1";
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.ativar_cliente($1, $2, $3)", [id, ativo, texto(fd, "motivo") || null]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/clientes/${id}`);
  revalidatePath("/clientes");
  redirect(`${voltaCli(fd, id)}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ativo ? "Cliente ativado: volta a aparecer nas listas." : "Cliente desativado: sai das listas do dia a dia, mas continua no sistema e sendo atualizado.")}`);
}

/** Saldo anterior: dívida de antes do sistema, ou pagamento dela (lançado à mão). */
export async function lancarSaldoAnterior(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.lancar_saldo_anterior($1, $2, $3::app.moeda, $4, nullif($5, '')::date, nullif($6, '')::date, $7)",
      [id, texto(fd, "tipo") === "pagamento" ? "pagamento" : "divida", texto(fd, "moeda") === "BRL" ? "BRL" : "GS", numero(fd, "valor"),
       texto(fd, "data"), texto(fd, "vencimento"), texto(fd, "descricao") || null]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/clientes/${id}`);
  redirect(`${voltaCli(fd, id)}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(texto(fd, "tipo") === "pagamento" ? "Pagamento do saldo anterior lançado." : "Saldo anterior lançado.")}`);
}

export async function cancelarSaldoAnterior(fd: FormData) {
  const u = await exigirUsuario();
  const id = texto(fd, "cliente_id");
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.cancelar_saldo_anterior($1)", [texto(fd, "lancamento")]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/clientes/${id}`);
  redirect(`${voltaCli(fd, id)}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Lançamento cancelado.")}`);
}
