// Real Love: fotos do catálogo do fornecedor (reallove.meucatalogodigital.com) onde falta, e grupos de cor no site.
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import pg from "pg";
const SIMULAR = process.env.SIMULAR === "1";
const fotos = path.join(path.dirname(process.env.ARQUIVOS_DIR ?? "/dados/comprovantes"), "fotos");
const CDN = "https://cdn.meucatalogodigital.com/reallove/";
const FOTO = { polygel: CDN + "2348874-3.png", glitter: CDN + "2348823-3.png", light: CDN + "2348132-3.png" };
const itens = [
  ["RLV-003t", "polygel", "POLYGEL REAL LOVE 30ML", "Transparente"],
  ["RLV-003b", "polygel", "POLYGEL REAL LOVE 30ML", "Branco"],
  ["RLV-003b2", "polygel", "POLYGEL REAL LOVE 30ML", "Branco (outro lote)"],
  ["RLV-003n", "polygel", "POLYGEL REAL LOVE 30ML", "Nude"],
  ["RLV-003n2", "polygel", "POLYGEL REAL LOVE 30ML", "Pink Nude"],
  ["RLV-004t", "glitter", "GEL DE MODELAGEM SCULPTING REAL LOVE 15ML", "Glitter Transparente"],
  ["RLV-004n", "glitter", "GEL DE MODELAGEM SCULPTING REAL LOVE 15ML", "Glitter Nude"],
  ["RLV-004p", "glitter", "GEL DE MODELAGEM SCULPTING REAL LOVE 15ML", "Glitter Nude Pink"],
  ["BLING-16718917455", "light", "GEL DE MODELAGEM SCULPTING REAL LOVE 15ML", "Light Nude"],
];
const c = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await c.connect();
const q = async (s, p) => (await c.query(s, p)).rows;
const criados = [], rel = { fotos: 0, ja_tinha_foto: [], nao_achou: [], grupos: 0 };
const baixado = {};
let seq = Date.now();
try {
  for (const [k, u] of Object.entries(FOTO)) {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`Foto ${k}: HTTP ${r.status}`);
    baixado[k] = Buffer.from(await r.arrayBuffer());
    if (baixado[k].length < 5000) throw new Error(`Foto ${k} pequena demais`);
  }
  await c.query("begin");
  const us = (await q(`update app.usuarios set ativo = true where email = 'sistema@importacao.local' returning id`))[0];
  await c.query("select set_config('app.usuario_id', $1, true), set_config('app.motivo', 'Real Love: fotos do catálogo do fornecedor e grupos de cor', true)", [us.id]);
  const linhas = [];
  for (const [codigo, foto, grupo, variante] of itens) {
    const p = (await q("select id, foto from app.produtos where codigo = $1", [codigo]))[0];
    if (!p) { rel.nao_achou.push(codigo); continue; }
    linhas.push({ produto_id: p.id, grupo, variante });
    if (p.foto) { rel.ja_tinha_foto.push(codigo); continue; }
    const nome = `${p.id}-${seq++}.png`;
    if (!SIMULAR) { writeFileSync(path.join(fotos, nome), baixado[foto]); criados.push(path.join(fotos, nome)); }
    await c.query("select app.definir_foto($1, $2)", [p.id, `/fotos/${nome}`]);
    rel.fotos++;
  }
  rel.grupos = Number((await q("select app.definir_grupos($1::jsonb) as n", [JSON.stringify(linhas)]))[0].n);
  await c.query("update app.usuarios set ativo = false where id = $1", [us.id]);
  await c.query(SIMULAR ? "rollback" : "commit");
  console.log(JSON.stringify({ simulado: SIMULAR, ...rel }));
} catch (e) {
  try { await c.query("rollback"); } catch {}
  for (const f of criados) rmSync(f, { force: true });
  console.error("Erro:", e.message); process.exitCode = 1;
} finally { await c.end(); }
