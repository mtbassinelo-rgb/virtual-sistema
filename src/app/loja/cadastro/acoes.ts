"use server";

import { pool, mensagemErro } from "@/lib/db";
import { linkWhatsApp, texto } from "@/lib/formato";
import { TEXTOS, idiomaAtual } from "@/lib/idioma";
import { avisarEquipe } from "@/lib/email";
import { vendedoraDoLink } from "@/lib/vendedora-link";

export type RespostaCadastro = { erro?: string; url?: string };

export async function enviarCadastro(_: RespostaCadastro, fd: FormData): Promise<RespostaCadastro> {
  const idioma = await idiomaAtual();
  const t = TEXTOS[idioma];
  const d = {
    nome: texto(fd, "nome"), contato: texto(fd, "contato"), whatsapp: texto(fd, "whatsapp"), email: texto(fd, "email"),
    cidade: texto(fd, "cidade"), tipo: texto(fd, "tipo"), documento: texto(fd, "documento"), mensagem: texto(fd, "mensagem"),
  };
  if (texto(fd, "site")) return { erro: "Não foi possível enviar." };   // campo-armadilha contra robôs
  try {
    const r = await pool.query("select app.registrar_cadastro_site($1,$2,$3,$4,$5,$6,$7,$8,$9) as numero",
      [d.nome, d.contato, d.whatsapp, d.email, d.cidade, d.tipo, d.documento, d.mensagem, idioma]);
    const tipoNome = t.cadTipos[d.tipo] ?? "";
    await avisarEquipe(`Novo cadastro no site: ${d.nome}`,
      `Novo cadastro pelo site (${idioma === "es" ? "espanhol" : "português"})\n\nEmpresa: ${d.nome}\nContato: ${d.contato}\nWhatsApp: ${d.whatsapp}\n` +
      `E-mail: ${d.email}\nCidade: ${d.cidade}\nTipo: ${tipoNome}\nDocumento: ${d.documento}\nMensagem: ${d.mensagem}\n\n` +
      `Atenda em https://app.${process.env.DOMINIO ?? "distribuidoravirtualcosmeticos.com"} (tela Hoje).`);
    const vend = await vendedoraDoLink();
    const zapVend = vend ? (await pool.query("select app.site_atribuir_vendedora('cadastro', $1, $2) as z", [d.whatsapp, vend.slug])).rows[0]?.z as string | null : null;
    const url = linkWhatsApp(zapVend || String(r.rows[0].numero), t.cadMsgZap({ ...d, tipo: tipoNome }));
    return url ? { url } : { erro: "WhatsApp da empresa não configurado." };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}
