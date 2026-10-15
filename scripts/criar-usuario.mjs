#!/usr/bin/env node
// Cria ou atualiza um usuário do sistema. Roda no servidor, com a conexão de ADMINISTRADOR do banco.
//
// Uso:
//   DATABASE_URL_ADMIN=postgres://... node scripts/criar-usuario.mjs <email> "<nome>" <perfil> [vendedora]
//   perfil: dono | gerente | vendedora | consulta
//   vendedora: nome da vendedora (obrigatório para o perfil vendedora; é criada se não existir)
// A senha é pedida no terminal (ou pela variável SENHA, para automação de testes).

import { hash } from "@node-rs/argon2";
import pg from "pg";
import readline from "node:readline";

const [email, nome, perfil, vendedora] = process.argv.slice(2);
const PERFIS = ["dono", "gerente", "vendedora", "consulta"];
if (!email || !nome || !PERFIS.includes(perfil) || (perfil === "vendedora" && !vendedora)) {
  console.error('Uso: node scripts/criar-usuario.mjs <email> "<nome>" <dono|gerente|vendedora|consulta> [nome da vendedora]');
  process.exit(1);
}
const url = process.env.DATABASE_URL_ADMIN;
if (!url) { console.error("Defina DATABASE_URL_ADMIN (conexão de administrador do banco)."); process.exit(1); }

async function perguntarSenha() {
  if (process.env.SENHA) return process.env.SENHA;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const muted = { on: false };
  rl._writeToOutput = (s) => { if (!muted.on) rl.output.write(s); };
  const pergunta = (q) => new Promise((r) => { rl.question(q, (a) => r(a)); muted.on = true; });
  const s1 = await pergunta("Senha (mín. 10 caracteres): "); muted.on = false; console.log();
  const s2 = await pergunta("Repita a senha: "); muted.on = false; console.log();
  rl.close();
  if (s1 !== s2) throw new Error("As senhas não conferem.");
  return s1;
}

const senha = await perguntarSenha();
if (senha.length < 10) { console.error("Senha curta demais: use pelo menos 10 caracteres."); process.exit(1); }
const senhaHash = await hash(senha, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query("begin");
  let vendedoraId = null;
  if (vendedora) {
    const r = await c.query("select id from app.vendedoras where lower(nome) = lower($1)", [vendedora]);
    vendedoraId = r.rows[0]?.id ?? null;
    if (!vendedoraId) { console.error(`Vendedora "${vendedora}" não cadastrada. Cadastre antes (país e moeda).`); process.exit(1); }
  }
  const r = await c.query(
    `insert into app.usuarios (email, nome, perfil, vendedora_id, senha_hash)
     values (lower($1), $2, $3::app.perfil, $4, $5)
     on conflict (email) do update set nome = excluded.nome, perfil = excluded.perfil,
        vendedora_id = excluded.vendedora_id, senha_hash = excluded.senha_hash, ativo = true
     returning id, (xmax = 0) as novo`,
    [email, nome, perfil, vendedoraId, senhaHash]);
  await c.query("delete from app.sessoes where usuario_id = $1", [r.rows[0].id]);
  await c.query("commit");
  console.log(`${r.rows[0].novo ? "Usuário criado" : "Usuário atualizado"}: ${email} (${perfil}).`);
} catch (e) {
  await c.query("rollback");
  console.error("Erro:", e.message);
  process.exit(1);
} finally {
  await c.end();
}
