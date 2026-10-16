#!/usr/bin/env node
// Importa no servidor uma lista de preços (JSON, opcionalmente .gz) pelo mesmo caminho da tela
// Estoque → Tabela de preços (função app.importar_precos). Assina como "Sistema (importação)".
//
//   DATABASE_URL_ADMIN=... node scripts/importar-precos.mjs <precos.json[.gz]> [--trocar-br-normal-do-bling]
//   precos.json: [{"codigo": "RHE-001", "tabela": "py_normal", "valor": 7000}, ...]
//   --trocar-br-normal-do-bling: antes, apaga os preços Brasil Normal que a importação do Bling criou
//   (só os criados pelo usuário técnico), para que valham apenas os preços da planilha.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import pg from "pg";

const [arquivo, opcao] = process.argv.slice(2);
if (!arquivo) { console.error("Uso: node scripts/importar-precos.mjs <precos.json[.gz]> [--trocar-br-normal-do-bling]"); process.exit(1); }
let bruto = readFileSync(arquivo);
if (arquivo.endsWith(".gz")) bruto = gunzipSync(bruto);
const linhas = JSON.parse(bruto.toString("utf8"));

const c = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await c.connect();
try {
  await c.query("begin");
  const u = await c.query(
    `insert into app.usuarios (email, nome, perfil, ativo) values ('sistema@importacao.local', 'Sistema (importação)', 'gerente', true)
     on conflict (email) do update set ativo = true returning id`);
  const sistema = u.rows[0].id;
  await c.query("select set_config('app.usuario_id', $1, true)", [sistema]);
  let apagados = 0;
  if (opcao === "--trocar-br-normal-do-bling") {
    apagados = (await c.query("delete from app.precos where tabela = 'br_normal' and definido_por = $1", [sistema])).rowCount ?? 0;
  }
  const r = await c.query("select app.importar_precos($1::jsonb) as r", [JSON.stringify(linhas)]);
  await c.query("update app.usuarios set ativo = false where id = $1", [sistema]);
  await c.query("commit");
  console.log("Preços importados:", JSON.stringify(r.rows[0].r), apagados ? `(removidos ${apagados} preços Brasil Normal vindos do Bling)` : "");
} catch (e) {
  await c.query("rollback");
  console.error("Erro:", e.message);
  process.exit(1);
} finally {
  await c.end();
}
