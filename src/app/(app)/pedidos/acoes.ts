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
import { avisarPagamento } from "@/lib/aviso-pagamento";
import type { PoolClient } from "pg";

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
    const pagId = await comUsuario(uid, async (c) => {
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
      return rows[0].id as string;
    });
    void avisarPagamento(uid, pagId, pedido);
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
  await executar(pedido, "Pagamento confirmado.", async (uid) => {
    // nº do Bling é opcional: quando o pedido já tem, confere; quando não tem, confirma só o recebimento
    const nBling = texto(fd, "bling_numero").replace(/\D/g, "") || null;
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
  const r = await criarPedidoSemPerder(fd);
  if (r?.erro) redirect(`/pedidos/novo?erro=${encodeURIComponent(r.erro)}`);
}

/**
 * Cria o pedido. Se der erro, devolve a mensagem SEM recarregar a página:
 * a vendedora não perde as quantidades que já digitou.
 */
export async function criarPedidoSemPerder(fd: FormData): Promise<{ erro?: string }> {
  const u = await exigirUsuario();
  let erro: string | null = null;
  let id: string | null = null;
  try {
    const cliente = texto(fd, "cliente_id");
    if (!cliente) throw new Error("Escolha o cliente.");
    const itens: { produto_id: string; quantidade?: number; caixas?: number; preco?: number }[] = [];
    for (let i = 0; i < 300; i++) {
      const produto = texto(fd, `produto_${i}`);
      const cx = numero(fd, `cx_${i}`);
      const qtd = numero(fd, `qtd_${i}`);
      const preco = numero(fd, `preco_${i}`);
      if (!produto) continue;
      const extra = preco && preco > 0 ? { preco } : {};
      if (qtd && qtd > 0) itens.push({ produto_id: produto, quantidade: qtd, ...extra });
      else if (cx && cx > 0) itens.push({ produto_id: produto, caixas: cx, ...extra });
    }
    if (itens.length === 0) throw new Error("Inclua pelo menos um produto com caixas ou peças.");
    const moeda = ["GS", "BRL"].includes(texto(fd, "moeda")) ? texto(fd, "moeda") : null;
    id = await comUsuario(u.id, async (c) => (await c.query(
      `select app.criar_pedido_vendedora($1, $2::app.moeda, nullif($3,'')::uuid, nullif($4,'')::date, $5, $6::jsonb, $7, $8) as id`,
      [cliente, moeda, texto(fd, "deposito_id"), texto(fd, "previsao_envio"), texto(fd, "observacoes"), JSON.stringify(itens),
       texto(fd, "para_cliente") === "1", numero(fd, "desconto")])).rows[0].id as string);
  } catch (e) {
    erro = mensagemErro(e);
  }
  if (erro || !id) return { erro: erro ?? "Não foi possível criar o pedido." };
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

/** Vendedora ajusta o pedido antes da separação: quantidades (q_<item>, 0 tira) e produtos novos (novo_k = "código · nome", novoq_k). */
export async function editarItens(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Pedido ajustado e total recalculado.", async (uid) => {
    await comUsuario(uid, async (c) => {
      const itens: Record<string, unknown>[] = [];
      for (const [k, v] of fd.entries()) {
        if (!k.startsWith("q_")) continue;
        const q = Number(String(v).replace(",", "."));
        if (!Number.isFinite(q) || q < 0) throw new Error("Quantidade inválida.");
        itens.push({ item_id: k.slice(2), quantidade: q });
      }
      for (let k = 0; k < 10; k++) {
        const nome = texto(fd, `novo_${k}`);
        if (!nome) continue;
        const q = Number(texto(fd, `novoq_${k}`).replace(",", "."));
        if (!(q > 0)) throw new Error(`Informe a quantidade de "${nome}".`);
        const cod = nome.split(" · ")[0].trim();
        const r = (await c.query("select id from app.produtos where codigo = $1 and ativo", [cod])).rows[0];
        if (!r) throw new Error(`Produto não encontrado: "${nome}". Escolha da lista.`);
        itens.push({ produto_id: r.id, quantidade: q });
      }
      await c.query("select app.editar_itens_pedido($1, $2::jsonb)", [pedido, JSON.stringify(itens)]);
    });
  });
}

/** Cancelar o pedido (motivo obrigatório). A regra do banco decide quem pode e até quando. */
export async function cancelarPedido(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Pedido cancelado.", async (uid) => {
    if (fd.get("confirmo") !== "on") throw new Error("Marque a confirmação para cancelar o pedido.");
    await comUsuario(uid, (c) => c.query("select app.cancelar_pedido($1, $2)", [pedido, texto(fd, "motivo")]));
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

/** Vendedora informa como o pedido sai: envio (meio e dados) ou retirada. O estoquista despacha depois. */
export async function definirEntrega(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Entrega informada. O pedido aparece para o estoquista despachar.", async (uid) => {
    await comUsuario(uid, (c) => c.query("select app.definir_entrega($1, $2, $3, nullif($4, ''))",
      [pedido, texto(fd, "tipo"), texto(fd, "meio"), texto(fd, "dados")]));
  });
}

/** Gerente finaliza o pedido (confirma os pagamentos informados, se marcado). */
export async function finalizarPedido(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  const ids = [...new Set([...(pedido ? [pedido] : []), ...fd.getAll("ids").map(String).filter(Boolean)])];
  const volta = texto(fd, "volta");
  const u = await exigirUsuario();
  const confirmar = fd.get("confirmar") !== null || fd.get("todos") === "1";
  const erros: string[] = [];
  let entregues = 0, pendentes = 0;
  for (const id of ids) {
    try {
      const r = await comUsuario(u.id, (c) => c.query("select app.finalizar_pedido($1, $2) as r", [id, confirmar]));
      if (r.rows[0]?.r === "pendente_entrega") pendentes++; else entregues++;
    } catch (e) {
      erros.push(mensagemErro(e));
    }
  }
  revalidatePath("/pedidos");
  for (const id of ids) revalidatePath(`/pedidos/${id}`);
  const base = volta.startsWith("/pedidos") ? volta : ids.length === 1 ? `/pedidos/${ids[0]}` : "/pedidos";
  const partes = [
    entregues ? `${entregues} pedido(s) finalizado(s).` : "",
    pendentes ? `${pendentes} finalizado(s): fecha(m) sozinho(s) quando sair(em) do estoque / a CDE entregar.` : "",
  ].filter(Boolean).join(" ");
  const q = ids.length === 0 ? "erro=" + encodeURIComponent("Marque pelo menos um pedido.")
    : erros.length && !partes ? "erro=" + encodeURIComponent(erros[0])
    : "ok=" + encodeURIComponent(partes + (erros.length ? ` ${erros.length} não finalizado(s): ${erros[0]}` : ""));
  redirect(`${base}${base.includes("?") ? "&" : "?"}${q}`);
}

/** Desconto em valor num pedido já criado (até o preço VIP; abaixo só gerente). */
export async function aplicarDesconto(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Desconto aplicado.", async (uid) => {
    const v = numero(fd, "desconto");
    if (!v || v <= 0) throw new Error("Informe o valor do desconto.");
    await comUsuario(uid, (c) => c.query("select app.aplicar_desconto_pedido($1, $2)", [pedido, v]));
  });
}

/** Loja CDE entregou o pedido de retirada ao cliente. */
export async function cdeClienteRetirou(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.cde_cliente_retirou($1)", [texto(fd, "pedido_id")]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/pedidos/envios-py");
  redirect(`/pedidos/envios-py?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Pedido entregue ao cliente.")}`);
}

/** Gerente confirma, direto da lista, os pagamentos informados de um pedido (✓ Pago). */
export async function confirmarPagamentosDaLista(fd: FormData) {
  const u = await exigirUsuario();
  const pedido = texto(fd, "pedido_id");
  const volta = texto(fd, "volta").startsWith("/pedidos") ? texto(fd, "volta") : "/pedidos";
  let erro: string | null = null, n = 0;
  try {
    await comUsuario(u.id, async (c) => {
      const pend = (await c.query("select g.id, p.bling_numero from app.pagamentos g join app.pedidos p on p.id = g.pedido_id where g.pedido_id = $1 and g.status_conferencia = 'pendente'", [pedido])).rows;
      for (const g of pend) { await c.query("select app.conferir_pagamento($1, $2)", [g.id, g.bling_numero ?? null]); n++; }
    });
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/pedidos");
  const sep = volta.includes("?") ? "&" : "?";
  redirect(`${volta}${sep}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(`${n} pagamento(s) confirmado(s).`)}`);
}

/** Loja CDE confirma que despachou pela transportadora o envio para o Paraguai. */
export async function confirmarEnvioPy(fd: FormData) {
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    await comUsuario(u.id, (c) => c.query("select app.confirmar_envio_py($1, nullif($2, ''))", [texto(fd, "pedido_id"), texto(fd, "guia")]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/pedidos/envios-py");
  redirect(`/pedidos/envios-py?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Envio confirmado. A vendedora já pode finalizar o pedido.")}`);
}

/** Gerente libera (ou não) o desconto por quantidade que o pedido do site atingiu. */
export async function decidirDescontoQuantidade(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  const liberar = texto(fd, "liberar") === "1";
  await executar(pedido, liberar ? "Desconto liberado: os preços do pedido já estão com o desconto." : "Desconto não liberado: o pedido segue com o preço normal.", async (uid) => {
    await comUsuario(uid, (c) => c.query("select app.decidir_desconto_quantidade($1, $2)", [pedido, liberar]));
  });
}

/** Código digitado na lista ("CÓDIGO · nome" ou só o código) → id do produto. */
async function produtoPorCodigo(c: PoolClient, valor: string) {
  const codigo = valor.split(" · ")[0].trim();
  if (!codigo) throw new Error("Escolha o produto substituto na lista.");
  const r = await c.query(
    `select id from app.produtos where codigo = $1
     union all select produto_id from app.produto_codigos where codigo = $1 limit 1`, [codigo]);
  if (!r.rows[0]) throw new Error(`Produto "${codigo}" não encontrado. Escolha um item da lista.`);
  return String(r.rows[0].id);
}

/** Troca de produto ou fragrância combinada com o cliente (print opcional). */
export async function trocarItem(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Produto trocado. O total do pedido foi recalculado.", async (uid) => {
    // Print da conversa é opcional: a vendedora combina com o cliente e troca direto
    const arquivo = fd.get("print");
    let nome = "", original = "", mime = "", tamanho = 0, sha = "";
    if (arquivo instanceof File && arquivo.size > 0) {
      const ext = TIPOS_COMPROVANTE[arquivo.type];
      if (!ext) throw new Error("O print deve ser foto (JPG, PNG, WEBP) ou PDF.");
      if (arquivo.size > MAX_COMPROVANTE) throw new Error("Arquivo maior que 10 MB.");
      const bytes = Buffer.from(await arquivo.arrayBuffer());
      sha = createHash("sha256").update(bytes).digest("hex");
      nome = `${sha}.${ext}`; original = arquivo.name; mime = arquivo.type; tamanho = arquivo.size;
      await mkdir(pastaArquivos(), { recursive: true });
      await writeFile(path.join(pastaArquivos(), nome), bytes);
    }
    const qtd = numero(fd, "quantidade");
    await comUsuario(uid, async (c) => {
      const produto = await produtoPorCodigo(c, texto(fd, "produto"));
      await c.query("select app.trocar_item_pedido($1, $2, $3, $4, $5, $6, $7, $8, nullif($9,''))",
        [texto(fd, "item_id"), produto, qtd, nome, original, mime, tamanho, sha, texto(fd, "observacao")]);
    });
  });
}

/** Cliente não quis trocar: pede à gerência para tirar o item (vai para os procurados sem estoque). */
export async function pedirRemocao(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  await executar(pedido, "Pedido de remoção enviado. Aguardando o gerente ou o dono autorizar.", async (uid) => {
    await comUsuario(uid, (c) => c.query("select app.pedir_remocao_item($1, $2)", [texto(fd, "item_id"), texto(fd, "motivo")]));
  });
}

/** Gerente/dono autoriza (item sai e vai para os procurados) ou recusa a remoção. */
export async function decidirRemocao(fd: FormData) {
  const pedido = texto(fd, "pedido_id");
  const aprovar = texto(fd, "decisao") === "aprovar";
  await executar(pedido, aprovar ? "Remoção autorizada: o item saiu do pedido e foi para a lista de procurados sem estoque." : "Remoção recusada.", async (uid) => {
    await comUsuario(uid, (c) => c.query("select app.decidir_remocao_item($1, $2, nullif($3,''))",
      [texto(fd, "remocao_id"), aprovar, texto(fd, "motivo_decisao")]));
  });
}

/** Preço de tabela (por peça) do produto para o cliente: o mínimo que a vendedora pode cobrar. */
export async function precoTabela(cliente: string, moeda: string, produto: string): Promise<{ preco: number | null; piso: number | null; moeda: "GS" | "BRL" | null }> {
  const u = await exigirUsuario();
  const ok = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
  if (!ok(cliente) || !ok(produto)) return { preco: null, piso: null, moeda: null };
  const r = await comUsuario(u.id, (c) => c.query(
    `select x.preco, x.moeda, app.preco_piso_vendedora($2, x.moeda, x.preco) as piso
       from (select app.preco_tabela_cliente($1, $2, nullif($3, '')::app.moeda) as preco,
                    coalesce(nullif($3, '')::app.moeda, (select moeda from app.clientes where id = $1)) as moeda) x`,
    [cliente, produto, ["GS", "BRL"].includes(moeda) ? moeda : ""]));
  const x = r.rows[0];
  return { preco: x?.preco == null ? null : Number(x.preco), piso: x?.piso == null ? null : Number(x.piso), moeda: x?.moeda ?? null };
}
