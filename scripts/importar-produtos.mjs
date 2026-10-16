#!/usr/bin/env node
// Importa no servidor um lote de produtos já convertido da planilha do Bling (JSON, opcionalmente .gz),
// pelo mesmo caminho da tela Estoque → Importar (função app.importar_produtos_bling).
// Fica registrado na auditoria como o usuário técnico "Sistema (importação)", que não faz login.
//
//   DATABASE_URL_ADMIN=... node scripts/importar-produtos.mjs <lote.json[.gz]> [codigo-deposito|-] [tabela-preco|-]
//   ex.: node scripts/importar-produtos.mjs /tmp/lote.json.gz cd-foz br_normal

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import pg from "pg";

const [arquivo, deposito = "-", tabela = "-"] = process.argv.slice(2);
if (!arquivo) { console.error("Uso: node scripts/importar-produtos.mjs <lote.json[.gz]> [deposito|-] [tabela|-]"); process.exit(1); }
let bruto = readFileSync(arquivo);
if (arquivo.endsWith(".gz")) bruto = gunzipSync(bruto);
const linhas = JSON.parse(bruto.toString("utf8"));
if (!Array.isArray(linhas) || linhas.length === 0) { console.error("Lote vazio."); process.exit(1); }

const c = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await c.connect();
try {
  await c.query("begin");
  const u = await c.query(
    `insert into app.usuarios (email, nome, perfil, ativo) values ('sistema@importacao.local', 'Sistema (importação)', 'gerente', true)
     on conflict (email) do update set ativo = true returning id`);
  await c.query("select set_config('app.usuario_id', $1, true)", [u.rows[0].id]);
  let depId = null;
  if (deposito !== "-") {
    depId = (await c.query("select id from app.depositos where codigo = $1", [deposito])).rows[0]?.id;
    if (!depId) throw new Error(`Depósito ${deposito} não existe.`);
  }
  const r = await c.query("select app.importar_produtos_bling($1::jsonb, $2, $3, $4) as r",
    [JSON.stringify(linhas), depId, tabela === "-" ? null : tabela, "planilha do Bling (servidor)"]);
  // o usuário técnico fica inativo: não entra no sistema, só assina a importação na auditoria
  await c.query("update app.usuarios set ativo = false where id = $1", [u.rows[0].id]);
  await c.query("commit");
  console.log("Importação concluída:", JSON.stringify(r.rows[0].r));
} catch (e) {
  await c.query("rollback");
  console.error("Erro:", e.message);
  process.exit(1);
} finally {
  await c.end();
}
