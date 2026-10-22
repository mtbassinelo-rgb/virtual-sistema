"use server";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { pool, mensagemErro } from "@/lib/db";
import { clienteAtual, exigirCliente, sha256, tokenCliente } from "@/lib/portal";
import { linkWhatsApp, numero, texto } from "@/lib/formato";
import { TEXTOS, idiomaAtual } from "@/lib/idioma";
import { avisarEquipe } from "@/lib/email";
import { pastaArquivos } from "@/lib/arquivos";
import { vendedoraDoLink } from "@/lib/vendedora-link";
import { unidadeLoja } from "@/lib/unidade";

const TIPOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

export async function enviarPedido(fd: FormData) {
  const { sessao } = await exigirCliente();
  const itens: { produto_id: string; quantidade: number }[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("q_")) continue;
    const q = Number(String(v).replace(",", "."));
    if (Number.isFinite(q) && q > 0) itens.push({ produto_id: k.slice(2), quantidade: q });
  }
  let erro: string | null = null;
  try {
    if (itens.length === 0) throw new Error("Escolha a quantidade de pelo menos um produto.");
    await pool.query("select app.portal_criar_pedido($1, $2, $3)", [sessao, JSON.stringify(itens), texto(fd, "observacao")]);
  } catch (e) {
    erro = mensagemErro(e);
  }
  if (erro) redirect(`/loja?erro=${encodeURIComponent(erro)}`);
  redirect(`/loja/pedidos?novo=1&ok=${encodeURIComponent("Pedido enviado! Sua vendedora vai confirmar e avisar o total para pagamento.")}`);
}

export async function enviarComprovante(fd: FormData) {
  const { sessao } = await exigirCliente();
  let erro: string | null = null;
  try {
    const arquivo = fd.get("comprovante");
    if (!(arquivo instanceof File) || arquivo.size === 0) throw new Error("Anexe a foto ou o PDF do comprovante.");
    const ext = TIPOS[arquivo.type];
    if (!ext) throw new Error("O comprovante deve ser foto (JPG, PNG, WEBP) ou PDF.");
    if (arquivo.size > 10 * 1024 * 1024) throw new Error("Arquivo maior que 10 MB.");
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new Error("Informe o valor pago.");
    const bytes = Buffer.from(await arquivo.arrayBuffer());
    const sha = createHash("sha256").update(bytes).digest("hex");
    await mkdir(pastaArquivos(), { recursive: true });
    await writeFile(path.join(pastaArquivos(), `${sha}.${ext}`), bytes);
    await pool.query(
      "select app.portal_enviar_pagamento($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [sessao, texto(fd, "pedido_id"), valor, texto(fd, "data") || null, texto(fd, "modalidade") || "transferencia",
       `${sha}.${ext}`, arquivo.name, arquivo.type, arquivo.size, sha],
    );
  } catch (e) {
    erro = mensagemErro(e);
  }
  redirect(`/loja/pedidos?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Comprovante enviado. Assim que for conferido, o pedido aparece como pago.")}`);
}

export type RespostaCarrinho = { erro?: string; url?: string; alternativa?: string };

type Linha = { produto_id: string; quantidade: number; caixas?: number | null; encomenda?: boolean };

function lerItens(fd: FormData): Linha[] {
  try {
    const v = JSON.parse(String(fd.get("itens") ?? "[]"));
    if (!Array.isArray(v)) return [];
    return v.filter((i) => typeof i?.produto_id === "string" && /^[0-9a-f-]{36}$/.test(i.produto_id) && Number(i.quantidade) > 0)
            .slice(0, 200).map((i) => ({ produto_id: i.produto_id, quantidade: Math.floor(Number(i.quantidade)),
              caixas: Number(i.caixas) > 0 ? Math.floor(Number(i.caixas)) : null, encomenda: i.encomenda === true }));
  } catch {
    return [];
  }
}

async function listaTexto(itens: Linha[]): Promise<string> {
  const { rows } = await pool.query("select produto_id, nome from app.vitrine_publica() where produto_id = any($1::uuid[])",
    [itens.map((i) => i.produto_id)]);
  const nome = new Map(rows.map((r) => [String(r.produto_id), String(r.nome)]));
  return itens.filter((i) => nome.has(i.produto_id))
    .map((i) => `• ${i.caixas ? `${i.caixas} cx (${i.quantidade} un.)` : `${i.quantidade}×`} ${nome.get(i.produto_id)}${i.encomenda ? " (encomenda)" : ""}`).join("\n");
}

/** Envia o carrinho: cliente com acesso → pedido no sistema; visitante → pedido do site + WhatsApp da empresa. */
export async function enviarCarrinho(_: RespostaCarrinho, fd: FormData): Promise<RespostaCarrinho> {
  const itens = lerItens(fd);
  if (itens.length === 0) return { erro: "O pedido está vazio." };
  const obs = texto(fd, "observacao").slice(0, 500);
  const cliente = await clienteAtual();

  if (cliente) {
    const t = await tokenCliente();
    // produto com caixa só sai por unidade se o cliente for liberado (ou a unidade vender por unidade)
    const soltos = itens.filter((i) => !i.caixas);
    if (soltos.length) {
      const pode = Boolean((await pool.query("select app.portal_compra_unidade($1) as ok", [sha256(t!)])).rows[0]?.ok);
      if (!pode) {
        const comCaixa = (await pool.query("select nome from app.produtos where id = any($1::uuid[]) and coalesce(unidades_caixa, 0) > 1",
          [soltos.map((i) => i.produto_id)])).rows;
        if (comCaixa.length) return { erro: `${comCaixa[0].nome}: vendido só em caixa fechada. Fale com a sua vendedora para liberar a compra por unidade.` };
      }
    }
    try {
      const ped = (await pool.query("select app.portal_criar_pedido($1, $2, $3) as id",
        [sha256(t!), JSON.stringify(itens.map(({ produto_id, quantidade, encomenda }) => ({ produto_id, quantidade, encomenda: !!encomenda }))), obs])).rows[0].id;
      // desconto por quantidade (levando N caixas da marca) e registro para o funil de vendas
      await pool.query("select app.portal_aplicar_desconto_quantidade($1, $2)", [sha256(t!), ped]).catch(() => undefined);
      // Retire em Foz: o cliente local escolheu retirar no CD Foz → desconto por caixa
      const retirar = texto(fd, "entrega") === "retirar";
      const descRet = retirar ? Number((await pool.query("select app.portal_aplicar_retirada_foz($1, $2) as d", [sha256(t!), ped]).catch(() => ({ rows: [{ d: 0 }] }))).rows[0]?.d ?? 0) : 0;
      await pool.query("select app.registrar_evento_site('pedido', null, $1, null, null, null, null)", [sha256(t!)]).catch(() => undefined);
      await avisarEquipe(`Pedido novo pela área do cliente: ${cliente.nome}`,
        `Cliente: ${cliente.nome}\nVendedora: ${cliente.vendedora}${retirar ? `\nRETIRA EM FOZ (desconto Gs ${Math.round(descRet).toLocaleString("es-PY")})` : ""}\n\n${await listaTexto(itens)}${obs ? "\n\nObs.: " + obs : ""}`).catch(() => undefined);
      return { url: "/loja/pedidos?novo=1&ok=" + encodeURIComponent("Pedido enviado! A vendedora confere e avisa o total para pagamento.") };
    } catch (e) {
      const msg = `Olá, ${cliente.vendedora}! Sou ${cliente.nome}. Quero fazer este pedido:\n${await listaTexto(itens)}${obs ? "\nObs.: " + obs : ""}`;
      return { erro: mensagemErro(e), alternativa: linkWhatsApp(cliente.vendedora_whatsapp, msg) ?? undefined };
    }
  }

  // Quem navega em espanhol é atendido pelo WhatsApp de vendas em guaranis; em português, pelo principal
  const idioma = await idiomaAtual();
  const es = idioma === "es";
  // A tela foi aberta como cliente, mas a sessão já não vale (expirou, senha nova, acesso bloqueado):
  // o formulário não tem os campos de visitante. Leva para entrar de novo; o carrinho fica guardado.
  if (!fd.has("nome")) {
    const aviso = es ? "Su sesión terminó. Ingrese de nuevo para enviar el pedido (su carrito sigue guardado)."
                     : "Sua sessão terminou. Entre de novo para enviar o pedido (o carrinho continua guardado).";
    return { url: "/loja/acesso?erro=" + encodeURIComponent(aviso) };
  }
  const nome = texto(fd, "nome"), zap = texto(fd, "whatsapp"), pais = es ? "PY" : "BR", cidade = texto(fd, "cidade");
  if (nome.trim().length < 2) return { erro: es ? "Escriba su nombre." : "Informe o seu nome." };
  if (zap.replace(/\D/g, "").length < 8) return { erro: es ? "Escriba un WhatsApp válido, con código de área." : "Informe um WhatsApp válido, com DDD." };
  try {
    const r = await pool.query("select app.registrar_pedido_site($1, $2, $3, $4, $5, $6) as numero",
      [nome, zap, pais, cidade, JSON.stringify(itens), obs]);
    const lista = await listaTexto(itens);
    const msg = TEXTOS[idioma].msgVisitante(nome, cidade, lista, obs);
    await avisarEquipe(`Pedido pelo site: ${nome}`, `Pedido de visitante pelo site\n\nNome: ${nome}\nWhatsApp: ${zap}\nCidade: ${cidade}\n\n${lista}${obs ? "\n\nObs.: " + obs : ""}`);
    // entrou pelo link da vendedora: o pedido vai para a carteira dela e o WhatsApp é o dela
    const vend = await vendedoraDoLink();
    const zapVend = vend ? (await pool.query("select app.site_atribuir_vendedora('pedido', $1, $2) as z", [zap, vend.slug])).rows[0]?.z as string | null : null;
    await pool.query("select app.registrar_evento_site('pedido', null, null, null, null, null, null)").catch(() => undefined);
    const url = linkWhatsApp(zapVend || String(r.rows[0].numero), msg);
    return url ? { url } : { erro: "WhatsApp da empresa não configurado." };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

export type RetiradaFoz = { desconto: number; fora: string[]; t: { titulo: string; entrega: string; entregaNota: string; retirar: string; economia: string; nota: string; total: string } };

/** Retire em Foz: só para o cliente local (Paraguai) com a opção ligada. null = a opção não aparece. */
export async function retiradaDoCliente(): Promise<RetiradaFoz | null> {
  const tk = await tokenCliente();
  if (!tk) return null;
  const r = (await pool.query("select app.portal_retirada_foz($1) as d, app.retirada_foz_marcas_fora() as fora", [sha256(tk)]).catch(() => ({ rows: [] }))).rows[0];
  if (!r?.d) return null;
  const es = (await idiomaAtual()) === "es";
  return {
    desconto: Number(r.d), fora: (r.fora ?? []) as string[],
    t: es ? { titulo: "¿Cómo quiere recibir?", entrega: "Envío (pasero)", entregaNota: "Llevamos hasta usted", retirar: "Retirar en Foz", economia: "ahorre 9999",
              nota: "Retire en el CD de Foz do Iguaçu y gane descuento por caja. Su vendedora le avisa cuándo está listo.", total: "Total con descuento" }
       : { titulo: "Como quer receber?", entrega: "Entrega (pasero)", entregaNota: "Levamos até você", retirar: "Retirar em Foz", economia: "economize 9999",
              nota: "Retire no CD de Foz do Iguaçu e ganhe desconto por caixa. A vendedora avisa quando estiver pronto.", total: "Total com desconto" },
  };
}

/** Cliente logado agora (o carrinho confere ao abrir, para não pedir nome/WhatsApp de quem já entrou). */
export async function clienteDoCarrinho(): Promise<{ nome: string; vendedora: string; moeda: "GS" | "BRL"; retirada: RetiradaFoz | null } | null> {
  const c = await clienteAtual();
  return c ? { nome: c.nome, vendedora: c.vendedora, moeda: c.moeda as "GS" | "BRL", retirada: await retiradaDoCliente() } : null;
}

export type RespostaProcura = { ok?: string; erro?: string };

/** "Quero este produto" num produto esgotado: registra a procura e avisa o gerente. */
export async function registrarProcura(_: RespostaProcura, fd: FormData): Promise<RespostaProcura> {
  const es = (await idiomaAtual()) === "es";
  const produto = texto(fd, "produto_id");
  if (!/^[0-9a-f-]{36}$/i.test(produto)) return { erro: es ? "Producto no encontrado." : "Produto não encontrado." };
  const t = await tokenCliente();
  const cliente = t ? await clienteAtual() : null;
  const q = numero(fd, "quantidade");
  try {
    const nova = (await pool.query("select app.registrar_procura_site($1, $2, $3, $4, $5) as nova",
      [produto, q && q > 0 ? Math.floor(q) : null, texto(fd, "nome"), texto(fd, "whatsapp"), cliente ? sha256(t!) : null])).rows[0].nova;
    if (nova) {
      const nome = (await pool.query("select nome from app.produtos where id = $1", [produto])).rows[0]?.nome ?? "";
      const quem = cliente ? `${cliente.nome} (cliente de ${cliente.vendedora})` : `${texto(fd, "nome")} · WhatsApp ${texto(fd, "whatsapp")}`;
      await avisarEquipe(`Produto procurado sem estoque: ${nome}`,
        `${quem} quer: ${nome}${q ? ` (${q} un.)` : ""}.\nVeja todos em Relatórios → Procurados sem estoque, para as próximas compras.`);
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  return { ok: es ? "¡Listo! Le avisamos cuando llegue." : "Pronto! Avisamos quando chegar." };
}

/** "Pedir de novo": itens de um pedido antigo com o preço e a caixa de hoje (só o que continua no catálogo). */
export async function itensParaRepetir(pedidoId: string): Promise<{ id: string; nome: string; marca: string | null; preco: number | null; caixa: number | null; limite: number | null; qtd: number }[]> {
  const cliente = await clienteAtual();
  const t = await tokenCliente();
  if (!cliente || !t || !/^[0-9a-f-]{36}$/i.test(pedidoId)) return [];
  const sessao = sha256(t);
  const itens = (await pool.query("select produto_id, quantidade from app.portal_itens_pedido($1, $2)", [sessao, pedidoId])).rows as { produto_id: string; quantidade: string }[];
  if (!itens.length) return [];
  const vit = new Map((await pool.query("select produto_id, nome, marca, unidades_caixa from app.vitrine_publica() where produto_id = any($1::uuid[])",
    [itens.map((i) => i.produto_id)])).rows.map((r) => [String(r.produto_id), r]));
  const precos = new Map((await pool.query("select produto_id, preco, limite_qtd from app.portal_catalogo($1)", [sessao])).rows.map((r) => [String(r.produto_id), r]));
  return itens.filter((i) => vit.has(i.produto_id)).map((i) => {
    const v = vit.get(i.produto_id), pr = precos.get(i.produto_id);
    const caixa = v.unidades_caixa ? Number(v.unidades_caixa) : null;
    return { id: i.produto_id, nome: String(v.nome), marca: v.marca ?? null, preco: pr ? Number(pr.preco) : null,
             caixa, limite: pr?.limite_qtd ? Number(pr.limite_qtd) : null,
             qtd: caixa ? Math.max(1, Math.ceil(Number(i.quantidade) / caixa)) : Math.max(1, Math.round(Number(i.quantidade))) };
  });
}

/** Guarda o carrinho do cliente logado (a vendedora vê os carrinhos parados e pode chamar o cliente). */
export async function guardarCarrinho(itens: { produto_id: string; qtd: number }[]): Promise<void> {
  const t = await tokenCliente();
  if (!t) return;
  await pool.query("select app.portal_salvar_carrinho($1, $2::jsonb)", [sha256(t), JSON.stringify(itens.slice(0, 200))]).catch(() => undefined);
}


export type Sugestao = { id: string; nome: string; marca: string | null; foto: string | null; caixa: number | null; preco: number | null };

/** "Compre junto": o que os clientes costumam levar com os produtos do carrinho (e a mesma linha da marca). */
export async function sugestoesCompreJunto(ids: string[]): Promise<Sugestao[]> {
  const lista = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50);
  if (!lista.length) return [];
  const unidade = await unidadeLoja();
  const r = (await pool.query(`select v.produto_id, v.nome, v.marca, v.foto, v.unidades_caixa
      from app.compre_junto($1::uuid[], 12) cj join app.vitrine_publica_unidade($2) v on v.produto_id = cj.produto_id
     where v.tem_estoque limit 4`, [lista, unidade.id])).rows;
  if (!r.length) return [];
  const t = await tokenCliente();
  const precos = t ? new Map((await pool.query("select produto_id, preco from app.portal_catalogo($1) where produto_id = any($2::uuid[])",
    [sha256(t), r.map((x) => x.produto_id)])).rows.map((x) => [String(x.produto_id), Number(x.preco)])) : new Map<string, number>();
  return r.map((x) => ({ id: String(x.produto_id), nome: x.nome, marca: x.marca, foto: x.foto, caixa: x.unidades_caixa, preco: precos.get(String(x.produto_id)) ?? null }));
}

/** Lista de reposição: o que o cliente costuma comprar, com a quantidade de costume (em caixas quando o produto tem caixa). */
export async function itensReposicao(): Promise<{ id: string; nome: string; marca: string | null; preco: number | null; caixa: number | null; qtd: number }[]> {
  const t = await tokenCliente();
  if (!t) return [];
  const sessao = sha256(t);
  const rep = (await pool.query("select produto_id, quantidade_media from app.portal_reposicao($1)", [sessao])).rows;
  if (!rep.length) return [];
  const unidade = await unidadeLoja();
  const vit = new Map((await pool.query("select produto_id, nome, marca, unidades_caixa from app.vitrine_publica_unidade($1) where produto_id = any($2::uuid[])",
    [unidade.id, rep.map((x) => x.produto_id)])).rows.map((x) => [String(x.produto_id), x]));
  const precos = new Map((await pool.query("select produto_id, preco from app.portal_catalogo($1)", [sessao])).rows.map((x) => [String(x.produto_id), Number(x.preco)]));
  return rep.filter((x) => vit.has(String(x.produto_id))).map((x) => {
    const v = vit.get(String(x.produto_id)); const caixa = v.unidades_caixa ? Number(v.unidades_caixa) : null;
    return { id: String(x.produto_id), nome: v.nome, marca: v.marca, preco: precos.get(String(x.produto_id)) ?? null, caixa,
             qtd: caixa ? Math.max(1, Math.round(Number(x.quantidade_media) / caixa)) : Math.max(1, Math.round(Number(x.quantidade_media))) };
  });
}

/** O cliente fechou a mensagem de boas-vindas: não mostra mais. */
export async function marcarBoasVindas(): Promise<void> {
  const t = await tokenCliente();
  if (t) await pool.query("select app.portal_marcar_mensagem($1)", [sha256(t)]).catch(() => undefined);
}

/** Mensagem ao abrir a loja (editável no sistema): só se o cliente ainda não viu a versão atual. */
export async function mensagemDoCliente(es: boolean, nome: string, vendedora: string): Promise<{ titulo: string; texto: string; botao: string } | null> {
  const t = await tokenCliente();
  if (!t) return null;
  const m = (await pool.query("select * from app.portal_mensagem($1)", [sha256(t)]).catch(() => ({ rows: [] }))).rows[0];
  if (!m) return null;
  const primeiro = nome.split(" ")[0] ?? nome;
  const troca = (s: string) => s.replace(/\{(nome|nombre)\}/gi, primeiro).replace(/\{vendedora\}/gi, vendedora || "");
  return es ? { titulo: troca(m.titulo_es), texto: troca(m.texto_es), botao: m.botao_es } : { titulo: troca(m.titulo_pt), texto: troca(m.texto_pt), botao: m.botao_pt };
}
