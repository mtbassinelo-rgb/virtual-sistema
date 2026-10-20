// Produtos duplicados: em cada grupo (mesmo nome, mesma marca), fica o que tem estoque; os outros (sem estoque) são desativados.
// O que fica herda dos desativados o que faltar: foto, preços, marca, peças por caixa, estoque mínimo e grupo de fragrância,
// e fica ativo se algum do grupo estava ativo. Componente de kit não é desativado (só listado).
import { readFileSync } from "node:fs";
import pg from "pg";
const SIMULAR = process.env.SIMULAR === "1";
const sqlGrupos = readFileSync("/carga/grupos.sql", "utf8");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await c.connect();
const q = async (s, p) => (await c.query(s, p)).rows;
const rel = { grupos: 0, desativados: [], mantidos: [], ativados: [], fotos: 0, precos: 0, pulados: [] };
try {
  await c.query("begin");
  const u = (await q(`update app.usuarios set ativo = true where email = 'sistema@importacao.local' returning id`))[0];
  await c.query("select set_config('app.usuario_id', $1, true), set_config('app.motivo', 'Produtos duplicados: fica o que tem estoque, os sem estoque são desativados', true)", [u.id]);
  await c.query(sqlGrupos);
  const linhas = await q("select * from dup order by k, est desc");
  const grupos = new Map();
  for (const l of linhas) grupos.set(l.k, [...(grupos.get(l.k) ?? []), l]);
  for (const [k, g] of grupos) {
    const marcas = new Set(g.map((x) => x.marca).filter(Boolean));
    const comEstoque = g.filter((x) => Number(x.est) > 0);
    if (marcas.size > 1) { rel.pulados.push(`${g[0].nome} (marcas diferentes)`); continue; }
    if (comEstoque.length !== 1) { rel.pulados.push(`${g[0].nome} (${comEstoque.length} com estoque)`); continue; }
    const fica = comEstoque[0];
    const sai = g.filter((x) => x.id !== fica.id);
    rel.grupos++;
    // herda o que faltar
    const doador = (campo) => sai.find((x) => x.ativo && x[campo] != null) ?? sai.find((x) => x[campo] != null);
    for (const campo of ["foto", "marca", "unidades_caixa", "estoque_minimo"]) {
      if (fica[campo] == null && doador(campo)) {
        await c.query(`update app.produtos set ${campo} = $2 where id = $1`, [fica.id, doador(campo)[campo]]);
        if (campo === "foto") rel.fotos++;
      }
    }
    if (!fica.grupo) { const d = sai.find((x) => x.grupo); if (d) await c.query("update app.produtos set grupo = $2, variante = $3 where id = $1", [fica.id, d.grupo, d.variante]); }
    const temPreco = (await q("select 1 from app.precos where produto_id = $1 limit 1", [fica.id])).length > 0;
    if (!temPreco) {
      const d = sai.find((x) => x.ativo) ?? sai[0];
      const pr = await q(`select distinct on (tabela) tabela, valor from app.precos where produto_id = $1 and vigente_desde <= current_date order by tabela, vigente_desde desc`, [d.id]);
      if (pr.length) { await c.query("select app.importar_precos($1::jsonb)", [JSON.stringify(pr.map((p) => ({ codigo: fica.codigo, tabela: p.tabela, valor: Number(p.valor) })))]); rel.precos++; }
    }
    if (!fica.ativo && g.some((x) => x.ativo)) { await c.query("update app.produtos set ativo = true where id = $1", [fica.id]); rel.ativados.push(fica.codigo); }
    rel.mantidos.push(`${fica.codigo} ${fica.nome}`);
    for (const x of sai) {
      if (x.componente) { rel.pulados.push(`${x.codigo} é componente de kit`); continue; }
      if (x.ativo || x.grupo) await c.query("update app.produtos set ativo = false, grupo = null, variante = null where id = $1", [x.id]);
      rel.desativados.push(`${x.codigo}${x.ativo ? "" : " (já inativo)"}`);
    }
  }
  await c.query("update app.usuarios set ativo = false where id = $1", [u.id]);
  await c.query(SIMULAR ? "rollback" : "commit");
  console.log(JSON.stringify({ simulado: SIMULAR, ...rel }, null, 1));
} catch (e) { await c.query("rollback"); console.error("Erro:", e.message); process.exitCode = 1; }
finally { await c.end(); }
