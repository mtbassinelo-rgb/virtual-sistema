"use server";

import { createHash } from "node:crypto";
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
    const itens: { produto: string; qtd: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const produto = texto(fd, `produto_${i}`);
      const qtd = numero(fd, `qtd_${i}`);
      if (produto && qtd && qtd > 0) itens.push({ produto, qtd });
    }
    if (itens.length === 0) throw new Error("Inclua pelo menos um produto com quantidade.");
    id = await comUsuario(u.id, async (c) => {
      const cli = (await c.query("select id, vendedora_id, moeda from app.clientes where id = $1", [cliente])).rows[0];
      if (!cli) throw new Error("Cliente não encontrado.");
      const ped = (await c.query(
        `insert into app.pedidos (origem, canal, cliente_id, vendedora_id, data_pedido, moeda, valor_total,
                                  previsao_envio, deposito_id, observacoes, criado_por)
         values ('manual', 'direto', $1, $2, current_date, $3, 0, nullif($4,'')::date, nullif($5,'')::uuid, nullif($6,''), app.uid())
         returning id`,
        [cli.id, cli.vendedora_id, cli.moeda, texto(fd, "previsao_envio"), texto(fd, "deposito_id"), texto(fd, "observacoes")],
      )).rows[0].id as string;
      let total = 0;
      for (const it of itens) {
        const pr = (await c.query(
          `select p.codigo, p.nome, x.valor, x.tabela from app.produtos p
             left join lateral app.preco_para_cliente($1, p.id) x on true where p.id = $2`, [cli.id, it.produto])).rows[0];
        if (!pr?.valor) throw new Error(`Produto ${pr?.codigo ?? ""} sem preço na tabela deste cliente.`);
        await c.query(
          `insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario, tabela_preco)
           values ($1, $2, $3, $4, $5, $6, $7)`, [ped, it.produto, pr.codigo, pr.nome, it.qtd, pr.valor, pr.tabela]);
        total += it.qtd * Number(pr.valor);
      }
      await c.query("update app.pedidos set valor_total = $2 where id = $1", [ped, Math.round(total * 100) / 100]);
      return ped;
    });
  } catch (e) {
    erro = mensagemErro(e);
  }
  if (erro || !id) redirect(`/pedidos/novo?erro=${encodeURIComponent(erro ?? "Não foi possível criar o pedido.")}`);
  revalidatePath("/pedidos");
  redirect(`/pedidos/${id}?ok=${encodeURIComponent("Pedido criado.")}`);
}
