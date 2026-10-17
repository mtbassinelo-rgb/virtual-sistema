#!/usr/bin/env node
// Carrega no servidor as fotos tiradas do catálogo em PDF.
// A pasta tem lote.json ([{id, pagina, nome, sugestao, sugestao2, confianca, auto}]) e um <id>.webp por cartão.
//  - todas as fotos vão para a fila "Fotos do catálogo" (a gerência confere em Produtos → Fotos do catálogo);
//  - as marcadas "auto" (nome do catálogo bate com certeza com o produto) já entram no produto, se ele ainda não tem foto.
// Fica registrado na auditoria como o usuário técnico "Sistema (importação)", que não faz login.
//
//   DATABASE_URL_ADMIN=... node scripts/importar-fotos-catalogo.mjs <pasta>

import { copyFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const pasta = process.argv[2];
if (!pasta) { console.error("Uso: node scripts/importar-fotos-catalogo.mjs <pasta>"); process.exit(1); }
const fotos = path.join(path.dirname(process.env.ARQUIVOS_DIR ?? path.join(process.cwd(), "dados", "comprovantes")), "fotos");
const catalogo = path.join(fotos, "catalogo");
mkdirSync(catalogo, { recursive: true });

const lote = JSON.parse(readFileSync(path.join(pasta, "lote.json"), "utf8"));
const ehWebp = (b) => b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP";
const validos = [];
for (const it of lote) {
  if (!/^p[0-9]{2}-[0-9]{2}$/.test(String(it.id))) { console.warn("ignorado (id):", it.id); continue; }
  const arq = path.join(pasta, `${it.id}.webp`);
  if (!existsSync(arq) || !ehWebp(readFileSync(arq))) { console.warn("ignorado (arquivo):", it.id); continue; }
  copyFileSync(arq, path.join(catalogo, `${it.id}.webp`));
  validos.push(it);
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await c.connect();
const criados = [];
try {
  await c.query("begin");
  const u = await c.query(
    `insert into app.usuarios (email, nome, perfil, ativo) values ('sistema@importacao.local', 'Sistema (importação)', 'gerente', true)
     on conflict (email) do update set ativo = true returning id`);
  await c.query("select set_config('app.usuario_id', $1, true)", [u.rows[0].id]);
  const n = (await c.query("select app.importar_fotos_catalogo($1::jsonb) as n", [JSON.stringify(validos)])).rows[0].n;
  let aplicadas = 0, jaTinham = 0, seq = Date.now();
  for (const it of validos.filter((x) => x.auto)) {
    const r = (await c.query(
      `select f.status, p.id, p.foto from app.fotos_catalogo f join app.produtos p on p.id = f.sugestao where f.id = $1`, [it.id])).rows[0];
    if (!r || r.status !== "pendente") continue;
    if (r.foto) { jaTinham++; continue; }
    const nome = `${r.id}-${seq++}.webp`;
    copyFileSync(path.join(catalogo, `${it.id}.webp`), path.join(fotos, nome));
    criados.push(path.join(fotos, nome));
    await c.query("select app.definir_foto($1, $2)", [r.id, `/fotos/${nome}`]);
    await c.query("select app.decidir_foto_catalogo($1, 'aplicar', $2)", [it.id, r.id]);
    aplicadas++;
  }
  await c.query("update app.usuarios set ativo = false where id = $1", [u.rows[0].id]);
  await c.query("commit");
  const pend = (await c.query("select count(*)::int n from app.fotos_catalogo where status = 'pendente'")).rows[0].n;
  console.log(`Fotos carregadas: ${n}. Colocadas direto nos produtos: ${aplicadas}. Produto já tinha foto: ${jaTinham}. Para conferir: ${pend}.`);
} catch (e) {
  await c.query("rollback");
  const { rmSync } = await import("node:fs");
  for (const f of criados) rmSync(f, { force: true });
  console.error("Erro:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
