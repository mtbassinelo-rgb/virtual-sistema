"use server";

import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";
import { pastaArquivos } from "@/lib/arquivos";

const TIPOS_COMPROVANTE: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
};
const MAX_COMPROVANTE = 10 * 1024 * 1024;

async function executar(pedidoId: string, ok: string, fn: (uid: string) => Promise<void>) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    await fn(u.id);
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/pedidos/${pedidoId}`);
  const destino = `/pedidos/${pedidoId}?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`;
  redirect(destino);
}

export async function registrarPagamento(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Pagamento registrado. Aguardando conferência do gerente.", async (uid) => {
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new Error("Informe o valor do pagamento.");
    const arquivo = fd.get("comprovante");
    let comp: { nome: string; mime: string; tamanho: number; sha: string; caminho: string } | null = null;
    if (arquivo instanceof File && arquivo.size > 0) {
      const ext = TIPOS_COMPROVANTE[arquivo.type];
      if (!ext) throw new Error("Comprovante deve ser foto (JPG, PNG, WEBP) ou PDF.");
      if (arquivo.size > MAX_COMPROVANTE) throw new Error("Comprovante maior que 10 MB.");
      const bytes = Buffer.from(await arquivo.arrayBuffer());
      const sha = createHash("sha256").update(bytes).digest("hex");
      const nome = `${sha}.${ext}`;
      await mkdir(pastaArquivos(), { recursive: true });
      await writeFile(path.join(pastaArquivos(), nome), bytes);
      comp = { nome: arquivo.name, mime: arquivo.type, tamanho: arquivo.size, sha, caminho: nome };
    }
    await comUsuario(uid, async (c) => {
      const { rows } = await c.query(
        `insert into app.pagamentos (pedido_id, valor, data, modalidade, banco, observacao)
         values ($1, $2, $3, $4, nullif($5,''), nullif($6,'')) returning id`,
        [pedido, valor, texto(fd, "data"), texto(fd, "modalidade"), texto(fd, "banco"), texto(fd, "observacao")],
      );
      if (comp) {
        await c.query(
          `insert into app.comprovantes (pagamento_id, arquivo, nome_original, mime, tamanho, sha256, enviado_por)
           values ($1, $2, $3, $4, $5, $6, app.uid())`,
          [rows[0].id, comp.caminho, comp.nome, comp.mime, comp.tamanho, comp.sha],
        );
      }
    });
  });
}

export async function anexarComprovante(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Comprovante anexado.", async (uid) => {
    const arquivo = fd.get("comprovante");
    if (!(arquivo instanceof File) || arquivo.size === 0) throw new Error("Escolha o arquivo do comprovante.");
    const ext = TIPOS_COMPROVANTE[arquivo.type];
    if (!ext) throw new Error("Comprovante deve ser foto (JPG, PNG, WEBP) ou PDF.");
    if (arquivo.size > MAX_COMPROVANTE) throw new Error("Comprovante maior que 10 MB.");
    const bytes = Buffer.from(await arquivo.arrayBuffer());
    const sha = createHash("sha256").update(bytes).digest("hex");
    await mkdir(pastaArquivos(), { recursive: true });
    await writeFile(path.join(pastaArquivos(), `${sha}.${ext}`), bytes);
    await comUsuario(uid, (c) => c.query(
      `insert into app.comprovantes (pagamento_id, arquivo, nome_original, mime, tamanho, sha256, enviado_por)
       values ($1, $2, $3, $4, $5, $6, app.uid())`,
      [texto(fd, "pagamento_id"), `${sha}.${ext}`, arquivo.name, arquivo.type, arquivo.size, sha],
    ));
  });
}

export async function conferirPagamento(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Pagamento conferido.", async (uid) => {
    const nBling = texto(fd, "bling_numero").replace(/\D/g, "");
    if (!nBling) throw new Error("Informe o número do pedido no Bling para conferir.");
    await comUsuario(uid, (c) => c.query("select app.conferir_pagamento($1, $2)", [texto(fd, "pagamento_id"), nBling]));
  });
}

export async function recusarPagamento(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Pagamento recusado. A vendedora verá o motivo.", async (uid) => {
    await comUsuario(uid, (c) => c.query("select app.recusar_pagamento($1, $2)", [texto(fd, "pagamento_id"), texto(fd, "motivo")]));
  });
}

export async function atualizarPedido(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Pedido atualizado.", async (uid) => {
    const credito = fd.get("credito_concedido") === "on";
    const status = texto(fd, "status_comercial");
    await comUsuario(uid, async (c) => {
      await c.query("select set_config('app.motivo', $1, true)", [texto(fd, "motivo")]);
      await c.query(
        `update app.pedidos set
           status_comercial = $2::app.status_comercial,
           previsao_envio = nullif($3,'')::date,
           vencimento = nullif($4,'')::date,
           credito_concedido = $5,
           observacoes = nullif($6,''),
           deposito_id = coalesce(nullif($7,'')::uuid, deposito_id),
           enviado_em = case when $2 = 'enviado' and status_comercial <> 'enviado' then current_date else enviado_em end,
           entregue_em = case when $2 = 'entregue' and status_comercial <> 'entregue' then current_date else entregue_em end
         where id = $1`,
        [pedido, status, texto(fd, "previsao_envio"), texto(fd, "vencimento"), credito, texto(fd, "observacoes"), texto(fd, "deposito_id")],
      );
    });
  });
}

export async function reconhecerBling(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Versão do Bling marcada como revisada.", async (uid) => {
    await comUsuario(uid, (c) => c.query("select app.reconhecer_mudanca_bling($1)", [pedido]));
  });
}

export async function registrarAtendimento(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Atendimento registrado.", async (uid) => {
    await comUsuario(uid, async (c) => {
      const { rows } = await c.query(
        `insert into app.atendimentos (cliente_id, pedido_id, tipo, resultado, nota, usuario_id)
         values ($1, $2, $3::app.tipo_atendimento, nullif($4,''), nullif($5,''), app.uid()) returning id`,
        [texto(fd, "cliente_id"), pedido, texto(fd, "tipo"), texto(fd, "resultado"), texto(fd, "nota")],
      );
      if (fd.get("vincular") === "on") {
        await c.query("update app.pedidos set atendimento_id = $2 where id = $1", [pedido, rows[0].id]);
      }
    });
  });
}

export async function criarPedido(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  let id: string | null = null;
  try {
    const cliente = texto(fd, "cliente_id");
    if (!cliente) throw new Error("Escolha o cliente.");
    const itens: { produto_id: string; quantidade?: number; caixas?: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const produto = texto(fd, `produto_${i}`);
      const cx = numero(fd, `cx_${i}`);
      const qtd = numero(fd, `qtd_${i}`);
      if (!produto) continue;
      if (qtd && qtd > 0) itens.push({ produto_id: produto, quantidade: qtd });
      else if (cx && cx > 0) itens.push({ produto_id: produto, caixas: cx });
    }
    if (itens.length === 0) throw new Error("Inclua pelo menos um produto com caixas ou peças.");
    const moeda = ["GS", "BRL"].includes(texto(fd, "moeda")) ? texto(fd, "moeda") : null;
    id = await comUsuario(u.id, async (c) => (await c.query(
      `select app.criar_pedido_vendedora($1, $2::app.moeda, nullif($3,'')::uuid, nullif($4,'')::date, $5, $6::jsonb, $7) as id`,
      [cliente, moeda, texto(fd, "deposito_id"), texto(fd, "previsao_envio"), texto(fd, "observacoes"), JSON.stringify(itens),
       texto(fd, "para_cliente") === "1"])).rows[0].id as string);
  } catch (e) {
    erro = mensagemErro(e);
  }
  if (erro || !id) redirect(`/pedidos/novo?erro=${encodeURIComponent(erro ?? "Não foi possível criar o pedido.")}`);
  revalidatePath("/pedidos");
  if (texto(fd, "para_cliente") === "1") {
    let token: string | null = null;
    try { token = await novoLinkPedido(u.id, id); } catch { token = null; }
    redirect(`/pedidos/${id}?ok=${encodeURIComponent("Pedido criado. Envie o link para o cliente confirmar.")}${token ? "&link=" + token : ""}`);
  }
  redirect(`/pedidos/${id}?ok=${encodeURIComponent("Pedido criado.")}`);
}

/** Cria o link do pedido para o cliente (só o hash fica no banco) e devolve o token. */
async function novoLinkPedido(uid: string, pedido: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  await comUsuario(uid, (c) => c.query("select app.gerar_link_pedido($1, $2)", [pedido, hash]));
  return token;
}

export async function gerarLinkPedido(fd: FormData) {
  const u = await exigirUsuario();
  const pedido = texto(fd, "pedido_id");
  let token: string | null = null;
  let erro: string | null = null;
  try {
    token = await novoLinkPedido(u.id, pedido);
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath(`/pedidos/${pedido}`);
  redirect(`/pedidos/${pedido}?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Link novo gerado: o anterior deixou de valer.") + "&link=" + token}`);
}

/** Volumes (caixas de envio) do pedido: usado no resumo semanal do passeiro. */
export async function definirVolumes(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Volumes do envio salvos.", async (uid) => {
    const v = numero(fd, "volumes");
    await comUsuario(uid, (c) => c.query("select app.definir_volumes($1, $2)", [pedido, v === null ? null : Math.trunc(v)]));
  });
}

export async function decidirPedidoPortal(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  const aprovar = texto(fd, "decisao") === "aprovar";
  await executar(pedido, aprovar ? "Pedido aprovado e enviado para separação." : "Pedido recusado.", async (uid) => {
    await comUsuario(uid, (c) => c.query("select app.decidir_pedido_portal($1, $2, nullif($3,''))", [pedido, aprovar, texto(fd, "motivo")]));
  });
}

export async function conferirSeparacao(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Separação conferida e total recalculado.", async (uid) => {
    const itens: { item_id: string; quantidade: number }[] = [];
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("sep_")) continue;
      // "Não tem": a expedição marca para tirar da lista (vira indisponível para o cliente)
      const q = fd.get(`falta_${k.slice(4)}`) === "on" ? 0 : Number(String(v).replace(",", "."));
      if (!Number.isFinite(q)) throw new Error("Quantidade separada inválida.");
      itens.push({ item_id: k.slice(4), quantidade: q });
    }
    await comUsuario(uid, (c) => c.query("select app.conferir_separacao($1, $2)", [pedido, JSON.stringify(itens)]));
  });
}

export async function confirmarTotal(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Total confirmado. Envie o WhatsApp para o cliente.", async (uid) => {
    await comUsuario(uid, (c) => c.query("select app.confirmar_total($1, $2)", [pedido, texto(fd, "conta")]));
  });
}

/** Acompanhamento da entrega: em transporte → aguardando retirada (local) → entregue/retirado. */
export async function avancarEntrega(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  const etapa = texto(fd, "etapa");
  const msg = etapa === "transporte" ? "Pedido despachado: em transporte." : etapa === "retirada" ? "Pedido chegou: aguardando retirada do cliente." : "Pedido entregue / retirado.";
  await executar(pedido, msg, async (uid) => {
    await comUsuario(uid, (c) => c.query("select app.avancar_entrega($1, $2, nullif($3,''))", [pedido, etapa, texto(fd, "local")]));
  });
}

/** Gerente libera (ou não) o desconto por quantidade que o pedido do site atingiu. */
export async function decidirDescontoQuantidade(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  const liberar = texto(fd, "liberar") === "1";
  await executar(pedido, liberar ? "Desconto liberado: os preços do pedido já estão com o desconto." : "Desconto não liberado: o pedido segue com o preço normal.", async (uid) => {
    await comUsuario(uid, (c) => c.query("select app.decidir_desconto_quantidade($1, $2)", [pedido, liberar]));
  });
}
