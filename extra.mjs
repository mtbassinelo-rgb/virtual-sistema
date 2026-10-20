// 1) Soltos que só saem em kit (shampoo/condicionador/máscara de kit ativo): fora do site (continuam no sistema para o estoque do kit).
// 2) Creme Hidratante Rosa Mosqueta (sem marca, com estoque) = Creme Facial Rosa Mosqueta 30g Maycrene: fica o que tem estoque,
//    herda foto/marca/caixa/preços, e os repetidos sem estoque são desativados.
import pg from "pg";
const SIMULAR = process.env.SIMULAR === "1";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await c.connect();
const q = async (s, p) => (await c.query(s, p)).rows;
const rel = { soltos_fora_do_site: 0, exemplos: [], rosa: {} };
try {
  await c.query("begin");
  const u = (await q(`update app.usuarios set ativo = true where email = 'sistema@importacao.local' returning id`))[0];
  await c.query("select set_config('app.usuario_id', $1, true), set_config('app.motivo', 'Soltos de kit fora do site; duplicado do creme rosa mosqueta 30g Maycrene', true)", [u.id]);
  const soltos = await q(`update app.produtos p set mostrar_no_site = false
     where p.mostrar_no_site and p.tipo::text <> 'kit' and app.nome_normal(p.nome) ~ '^(shampoo|condicionador|mascara)'
       and exists (select 1 from app.kit_componentes kc join app.produtos k on k.id = kc.kit_id where kc.componente_id = p.id and k.ativo)
     returning p.nome`);
  rel.soltos_fora_do_site = soltos.length; rel.exemplos = soltos.slice(0, 40).map((r) => r.nome);

  const fica = (await q("select * from app.produtos where codigo = '2407203014'"))[0];
  const doadores = await q("select p.*, exists (select 1 from app.kit_componentes k where k.componente_id = p.id) comp from app.produtos p where codigo in ('BOXCRMM', '1735554553605489763') order by ativo desc");
  const d = doadores[0];
  if (fica && d) {
    for (const campo of ["foto", "marca", "unidades_caixa", "estoque_minimo", "gtin"]) {
      const doador = doadores.find((x) => x[campo] != null);
      if (fica[campo] == null && doador) await c.query(`update app.produtos set ${campo} = $2 where id = $1`, [fica.id, doador[campo]]);
    }
    const temPreco = (await q("select 1 from app.precos where produto_id = $1 limit 1", [fica.id])).length > 0;
    if (!temPreco) {
      const pr = await q("select distinct on (tabela) tabela, valor from app.precos where produto_id = $1 and vigente_desde <= current_date order by tabela, vigente_desde desc", [d.id]);
      if (pr.length) await c.query("select app.importar_precos($1::jsonb)", [JSON.stringify(pr.map((p) => ({ codigo: fica.codigo, tabela: p.tabela, valor: Number(p.valor) })))]);
      rel.rosa.precos_copiados = pr.length;
    }
    for (const x of doadores) {
      const est = Number((await q("select coalesce(sum(quantidade),0) s from app.estoque_saldos where produto_id = $1", [x.id]))[0].s);
      if (est > 0 || x.comp) { rel.rosa[`mantido_${x.codigo}`] = est > 0 ? "tem estoque" : "é componente de kit"; continue; }
      await c.query("update app.produtos set ativo = false, grupo = null, variante = null where id = $1", [x.id]);
      rel.rosa[`desativado_${x.codigo}`] = x.nome;
    }
    rel.rosa.fica = (await q("select codigo, nome, marca, unidades_caixa, foto is not null as foto from app.produtos where id = $1", [fica.id]))[0];
  }
  await c.query("update app.usuarios set ativo = false where id = $1", [u.id]);
  await c.query(SIMULAR ? "rollback" : "commit");
  console.log(JSON.stringify({ simulado: SIMULAR, ...rel }, null, 1));
} catch (e) { await c.query("rollback"); console.error("Erro:", e.message); process.exitCode = 1; }
finally { await c.end(); }
