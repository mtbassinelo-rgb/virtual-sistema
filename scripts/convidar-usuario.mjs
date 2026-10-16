#!/usr/bin/env node
// Cadastra (ou reativa) uma pessoa da equipe e gera um LINK DE PRIMEIRO ACESSO de uso único.
// A própria pessoa cria a senha pelo link: quem roda este comando nunca conhece a senha.
// Roda no servidor, com a conexão de ADMINISTRADOR do banco.
//
//   DATABASE_URL_ADMIN=... APP_URL=https://app.dominio node scripts/convidar-usuario.mjs <email> "<nome>" <perfil> [vendedora]
//   perfil: dono | gerente | vendedora | consulta     (vendedora: nome da vendedora já cadastrada)
//   VALIDADE_HORAS (opcional, padrão 48)

import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const [email, nome, perfil, vendedora] = process.argv.slice(2);
const PERFIS = ["dono", "gerente", "vendedora", "consulta"];
if (!email || !nome || !PERFIS.includes(perfil) || (perfil === "vendedora" && !vendedora)) {
  console.error('Uso: node scripts/convidar-usuario.mjs <email> "<nome>" <dono|gerente|vendedora|consulta> [nome da vendedora]');
  process.exit(1);
}
const url = process.env.DATABASE_URL_ADMIN;
const app = (process.env.APP_URL ?? "").replace(/\/$/, "");
if (!url || !app) { console.error("Defina DATABASE_URL_ADMIN e APP_URL."); process.exit(1); }
const horas = Number(process.env.VALIDADE_HORAS ?? 48);

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query("begin");
  let vendedoraId = null;
  if (vendedora) {
    const r = await c.query("select id from app.vendedoras where lower(nome) = lower($1)", [vendedora]);
    vendedoraId = r.rows[0]?.id ?? null;
    if (!vendedoraId) throw new Error(`Vendedora "${vendedora}" não cadastrada. Cadastre antes (país e moeda).`);
  }
  // A senha antiga (se houver) continua valendo até a pessoa criar a nova pelo link.
  const u = await c.query(
    `insert into app.usuarios (email, nome, perfil, vendedora_id)
     values (lower($1), $2, $3::app.perfil, $4)
     on conflict (email) do update set nome = excluded.nome, perfil = excluded.perfil,
        vendedora_id = excluded.vendedora_id, ativo = true
     returning id`, [email, nome, perfil, vendedoraId]);
  const token = randomBytes(32).toString("base64url");
  await c.query(
    `insert into app.usuario_convites (token_hash, usuario_id, expira_em) values ($1, $2, now() + make_interval(hours => $3))`,
    [createHash("sha256").update(token).digest("hex"), u.rows[0].id, horas]);
  await c.query("commit");
  console.log(`\n${nome} <${email.toLowerCase()}> (${perfil})`);
  console.log(`Link de primeiro acesso (vale ${horas}h, uma única vez):`);
  console.log(`${app}/primeiro-acesso/${token}\n`);
} catch (e) {
  await c.query("rollback");
  console.error("Erro:", e.message);
  process.exit(1);
} finally {
  await c.end();
}
