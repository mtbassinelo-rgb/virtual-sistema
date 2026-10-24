import { usuarioAtual } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { hojeISO } from "@/lib/formato";
import { pode } from "@/lib/permissoes";
import { contatoLegivel, resumoMsg } from "@/lib/whatsapp";

/**
 * Planilha (CSV) com todas as mensagens do período, uma por linha, para abrir no Excel / Google Planilhas
 * ou mandar para análise. Respeita as permissões: a vendedora só baixa as do número dela.
 */
export async function GET(req: Request) {
  const u = await usuarioAtual();
  if (!u || !pode(u, "whatsapp")) return new Response("Sem permissão.", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const valida = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const de = valida(sp.get("de")) ?? hojeISO(-6);
  const ate = valida(sp.get("ate")) ?? hojeISO();
  const w = /^[0-9a-f-]{36}$/i.test(sp.get("w") ?? "") ? sp.get("w") : null;

  const rows = await comUsuario(u.id, async (c) => (await c.query(`
    with per as (select ($1::date)::timestamp at time zone 'America/Asuncion' as ini, ($2::date + 1)::timestamp at time zone 'America/Asuncion' as fim)
    select w.nome as conexao, v.nome as vendedora_numero, m.contato, k.nome as contato_nome, k.primeira_em,
           cli.nome as cliente, vc.nome as vendedora_cliente,
           to_char(m.em at time zone 'America/Asuncion', 'DD/MM/YYYY') as dia,
           to_char(m.em at time zone 'America/Asuncion', 'HH24:MI') as hora,
           m.enviada, m.tipo, m.texto
      from app.whatsapp_mensagens m
      join app.whatsapp_conexoes w on w.id = m.conexao_id
      left join app.vendedoras v on v.id = w.vendedora_id
      join app.whatsapp_contatos k on k.conexao_id = m.conexao_id and k.contato = m.contato
      left join lateral (
        select c.nome, c.vendedora_id from app.clientes c
         where m.contato not like 'lid:%' and c.mesclado_em is null
           and (app.zap8(c.whatsapp) = app.zap8(m.contato) or app.zap8(c.telefone) = app.zap8(m.contato))
         order by c.ativo desc, c.criado_em limit 1) cli on true
      left join app.vendedoras vc on vc.id = cli.vendedora_id, per
     where m.em >= per.ini and m.em < per.fim and ($3::uuid is null or m.conexao_id = $3)
     order by w.nome, m.contato, m.em`, [de, ate, w])).rows);

  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ⏎ ")}"`;
  const inicio = new Date(`${de}T00:00:00-03:00`).getTime();
  const linhas = [
    ["Número da empresa", "Vendedora do número", "Contato", "Telefone", "Cadastro", "Contato novo no período", "Data", "Hora", "Quem escreveu", "Tipo", "Mensagem"].map(q).join(";"),
    ...rows.map((r) => [
      q(r.conexao), q(r.vendedora_numero), q(r.cliente ?? r.contato_nome ?? ""), q(contatoLegivel(r.contato)),
      q(r.cliente ? `Cliente${r.vendedora_cliente ? " de " + r.vendedora_cliente : ""}` : "Lead (não cadastrado)"),
      q(new Date(r.primeira_em).getTime() >= inicio ? "Sim" : "Não"),
      q(r.dia), q(r.hora), q(r.enviada ? "Vendedora" : "Contato"), q(r.tipo), q(resumoMsg(r.tipo, r.texto)),
    ].join(";")),
  ];
  return new Response("﻿" + linhas.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="whatsapp-${de}-a-${ate}.csv"`,
      "cache-control": "no-store",
    },
  });
}
