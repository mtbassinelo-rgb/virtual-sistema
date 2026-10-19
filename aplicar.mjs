// Fotos que faltavam dos mousses e do spray Mary Life (catálogo Bio Instinto 15/09). Só onde não há foto.
import { copyFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import pg from "pg";
const SIMULAR = process.env.SIMULAR === "1";
const plano = JSON.parse(readFileSync("/carga/plano.json", "utf8"));
const fotos = path.join(path.dirname(process.env.ARQUIVOS_DIR ?? path.join(process.cwd(), "dados", "comprovantes")), "fotos");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await c.connect();
const criados = [], rel = { fotos: 0, ja_tinha_foto: [], nao_achou: [] };
const q = async (s, p) => (await c.query(s, p)).rows;
let seq = Date.now();
try {
  await c.query("begin");
  const u = (await q(`update app.usuarios set ativo = true where email = 'sistema@importacao.local' returning id`))[0];
  await c.query("select set_config('app.usuario_id', $1, true), set_config('app.motivo', 'Fotos Mary Life do catálogo Bio Instinto (15/09)', true)", [u.id]);
  for (const f of plano.fotos) {
    const p = (await q("select id, foto from app.produtos where codigo = $1", [f.codigo]))[0];
    if (!p) { rel.nao_achou.push(f.codigo); continue; }
    if (p.foto) { rel.ja_tinha_foto.push(f.codigo); continue; }
    const nome = `${p.id}-${seq++}.jpg`;
    if (!SIMULAR) { copyFileSync(path.join("/carga/fotos", f.arquivo), path.join(fotos, nome)); criados.push(path.join(fotos, nome)); }
    await c.query("select app.definir_foto($1, $2)", [p.id, `/fotos/${nome}`]);
    rel.fotos++;
  }
  await c.query("update app.usuarios set ativo = false where id = $1", [u.id]);
  await c.query(SIMULAR ? "rollback" : "commit");
  console.log(JSON.stringify({ simulado: SIMULAR, ...rel }));
} catch (e) {
  await c.query("rollback"); for (const f of criados) rmSync(f, { force: true });
  console.error("Erro:", e.message); process.exitCode = 1;
} finally { await c.end(); }
