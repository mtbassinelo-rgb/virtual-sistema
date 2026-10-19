// Naxos: kits shampoo + máscara (Black e Ruivo, como os de Blond e Marsala), soltos saem do site, grupos no site.
import pg from "pg";
const SIMULAR = process.env.SIMULAR === "1";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await c.connect();
const q = async (s, p) => (await c.query(s, p)).rows;
const id = async (codigo) => (await q("select id from app.produtos where codigo = $1", [codigo]))[0]?.id;
const rel = { kits_criados: [], escondidos: 0, grupos: 0, precos_modelo: null };
try {
  await c.query("begin");
  const u = (await q(`update app.usuarios set ativo = true where email = 'sistema@importacao.local' returning id`))[0];
  await c.query("select set_config('app.usuario_id', $1, true), set_config('app.motivo', 'Naxos: kits shampoo + máscara e grupos no site', true)", [u.id]);
  const modelo = await q(`select distinct on (tabela) tabela, valor from app.precos p join app.produtos x on x.id = p.produto_id
                           where x.codigo = 'nax-blond' and vigente_desde <= current_date order by tabela, vigente_desde desc`);
  rel.precos_modelo = Object.fromEntries(modelo.map((r) => [r.tabela, Number(r.valor)]));
  const custo = (await q("select custo from app.produtos where codigo = 'nax-blond'"))[0]?.custo ?? null;
  const novos = [
    { codigo: "nax-black", nome: "KIT ATIVADOR DE TONS BLACK NAXOS (SHAMPOO + MÁSCARA)", sh: "2407202983", ma: "2407202985" },
    { codigo: "nax-ruivo", nome: "KIT ATIVADOR DE TONS RUIVO NAXOS (SHAMPOO + MÁSCARA)", sh: "2407202980", ma: "2407202906" },
  ];
  for (const k of novos) {
    if (await id(k.codigo)) continue;
    const kit = (await q(`insert into app.produtos (codigo, nome, marca, custo, unidade, ativo, mostrar_no_site)
                          values ($1, $2, 'NAXOS', $3, 'KIT', true, true) returning id`, [k.codigo, k.nome, custo]))[0].id;
    await c.query("select app.definir_kit($1, $2::jsonb)", [kit, JSON.stringify([
      { produto_id: await id(k.sh), quantidade: 1 }, { produto_id: await id(k.ma), quantidade: 1 }])]);
    await c.query("select app.importar_precos($1::jsonb)", [JSON.stringify(modelo.map((r) => ({ codigo: k.codigo, tabela: r.tabela, valor: Number(r.valor) })))]);
    rel.kits_criados.push(k.codigo);
  }
  // soltos (shampoo e máscara das 4 cores) e os kits provisórios repetidos do Bling saem do site; continuam no sistema
  const esconder = ["2407202983", "2407202985", "2407202982", "2407202984", "2407203125", "2407202905", "2407202980", "2407202906",
    "BLING-16719761274", "BLING-16707872483", "BLING-16711843664"];
  rel.escondidos = (await c.query("update app.produtos set mostrar_no_site = false where codigo = any($1) and mostrar_no_site", [esconder])).rowCount;
  // grupos: um cartão para os kits (escolhe a cor) e um para os hidratantes (escolhe a fragrância)
  const g = async (grupo, itens) => {
    const linhas = [];
    for (const [codigo, variante] of itens) { const pid = await id(codigo); if (pid) linhas.push({ produto_id: pid, grupo, variante }); }
    rel.grupos += Number((await q("select app.definir_grupos($1::jsonb) as n", [JSON.stringify(linhas)]))[0].n);
  };
  await g("KIT ATIVADOR DE TONS NAXOS (SHAMPOO + MÁSCARA)", [["nax-blond", "Blond"], ["nax-marsala", "Marsala"], ["nax-black", "Black"], ["nax-ruivo", "Ruivo"]]);
  await g("HIDRATANTE CORPORAL NAXOS 250ML", [["2407202986", "Love Spell"], ["2407203132", "Pure Seduction"], ["2407203131", "Vanilla Lace"]]);
  await c.query("update app.usuarios set ativo = false where id = $1", [u.id]);
  await c.query(SIMULAR ? "rollback" : "commit");
  console.log(JSON.stringify({ simulado: SIMULAR, ...rel }));
} catch (e) { await c.query("rollback"); console.error("Erro:", e.message); process.exitCode = 1; }
finally { await c.end(); }
