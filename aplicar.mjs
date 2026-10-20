// Pedido do Mateus (20/10): +96 no CD Foz para a lista; Talco Dolomita = 2; Papel Ecológico p/ Mechas: 1 ativo por tamanho com 180;
// depois, limpeza geral de duplicados (fica um ativo, com foto; os repetidos sem estoque são desativados).
import pg from "pg";
const SIMULAR = process.env.SIMULAR === "1";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await c.connect();
const q = async (s, p) => (await c.query(s, p)).rows;
const LISTA = ["be31a9d3-2282-41e4-985e-babd05167c8e","72dcd5da-60cd-473d-ba00-38a539eebf16","7dc6adde-e657-4212-801e-bbc1500a04e3",
 "038163bb-3536-4cb6-a15f-9ad6abcbc1ca","6f788224-b1e9-4326-a64a-a89179b64243","69203773-13a9-4a84-9f86-f6d1eee4d23e","05f84a7e-4f86-4287-9d36-e1540e8e71a6",
 "41061d46-9d87-40ee-8eda-430c6ca1c8d3","813363ba-6dc3-4aef-bade-89f94d8e2b87","ebaf2d30-3561-4691-a20d-d5ae1931a745","b1256c1f-4cb5-4235-be99-87ae29768d70",
 "65d6c156-3a35-4b1e-972d-eab7b350f978","20c8a925-9f80-4d0d-8f5d-b12271bc3c3f","559a1fa2-6467-482e-8844-e393a84191f8","34a00676-2db9-4b41-9555-7e318c6169fe",
 "085f780d-c184-4e99-9724-b58125a1bc27","3b3b320a-dcbb-4442-8a29-1927318515b3","2c22e609-1954-4248-9c44-f19e491e15f0","aaad7d17-4214-4416-969a-a3451808375a",
 "74c417fc-37fe-41a7-b9b3-8215c9722a09","fe7d71a4-0e0b-4b82-95ef-01b60b42a438","a39a6b98-fd66-4e1b-adb8-f7738dc24e49","c969edb1-76b5-44ca-97ee-b27b9f84a707",
 "bd1f9d51-47af-4432-a278-dad802c7e061","75c1bf73-287b-4e6c-b3bc-e8cc046af9a1","3b87ad42-e339-4cf8-82e1-830b11b1c2a5","eda60d59-42fd-49cf-9139-01e38ac95f33",
 "e3376356-b643-4735-99de-b8711fd16d47","6998adad-0d3b-46a7-bdc9-eae54b56f94a","2f392bcd-c0ac-44d3-996c-f9028aeb2681","68e325c2-8b1d-411e-a0bc-b316dd4ff92f",
 "8e78aa81-f10d-4ca6-ae76-427e54cd837a"];
const CODIGO_SEM_LINK = "2407203267"; // BTOX Óleo Supreme Argan Mary Life (veio sem link)
const TALCO = "4ce83d42-6ed2-4cc8-8abe-2d49ab9c813f";
const REF = "Pedido Mateus 20/10";
const rel = { lista: [], talco: null, papel: { produtos: [], acoes: [] }, dup: { grupos: 0, mantidos: [], desativados: [], ativados: [], fotos: 0, precos: 0, pulados: [] } };

// chave de duplicado: palavras do nome sem marca/ligações (igual à limpeza anterior), separando kit de produto
const CHAVES = `
create temp table pk on commit drop as
with marcas as (
  select distinct w from app.produtos, regexp_split_to_table(lower(coalesce(marca,'')), '[^a-z0-9]+') w
   where w <> '' and w not in ('leite','rosas','de','e','lua','neve','magic','color','real','love','super','poderes','fonte','da','beleza','salon','sexy','fantasy','maria','bonequinha','japonesa','kit')
  union select unnest(array['mary','life','bio','instinto','phalle','beauty','phallebeauty','soul','babasoul','rhenuks','rheunks','rhenunks'])
)
select p.id, p.codigo, p.nome, p.marca, p.ativo, p.foto, p.tipo::text as tipo, p.gtin, p.grupo, p.variante, p.unidades_caixa, p.estoque_minimo,
       coalesce((select sum(app.saldo_disponivel(d.id, p.id)) from app.depositos d), 0) as est,
       exists (select 1 from app.kit_componentes k where k.componente_id = p.id) as componente,
       exists (select 1 from app.kit_componentes k where k.kit_id = p.id) as tem_componentes,
       exists (select 1 from app.precos pr where pr.produto_id = p.id) as tem_preco,
       (case when p.tipo::text = 'kit' or exists (select 1 from app.kit_componentes k where k.kit_id = p.id) then 'KIT:' else '' end) ||
       (select string_agg(distinct w, ' ' order by w) from regexp_split_to_table(
          regexp_replace(regexp_replace(app.nome_normal(p.nome), '(\\d)\\s+(ml|g|kg|l|gr)\\M', '\\1\\2', 'g'), '[^a-z0-9]+', ' ', 'g'), ' ') w
         where w not in ('', 'de','da','do','das','dos','e','com','para','p','c','o','a','em','-') and w not in (select w from marcas)) as k,
       (select string_agg(distinct w, ' ' order by w) from regexp_split_to_table(regexp_replace(app.nome_normal(p.nome), '[^a-z0-9]+', ' ', 'g'), ' ') w
         where w in (select w from marcas)) as marca_nome
  from app.produtos p`;

try {
  await c.query("begin");
  const u = (await q(`update app.usuarios set ativo = true where email = 'sistema@importacao.local' returning id`))[0];
  await c.query("select set_config('app.usuario_id', $1, true), set_config('app.motivo', $2, true)", [u.id, "Entrada de estoque pedida pelo Mateus e limpeza de duplicados"]);
  const dep = (await q("select id from app.depositos where codigo = 'cd-foz'"))[0].id;
  await c.query(CHAVES);
  const pk = async (id) => (await q("select * from pk where id = $1", [id]))[0];
  const saldo = async (id) => Number((await q("select coalesce((select quantidade from app.estoque_saldos where deposito_id = $1 and produto_id = $2), 0) s", [dep, id]))[0].s);
  const lancar = async (id, qtd, obs) => { if (qtd > 0) await c.query("select app._lancar($1, $2, 'ajuste_entrada', $3, 'inventario', $4, $5)", [dep, id, qtd, REF, obs]);
                                          else if (qtd < 0) await c.query("select app._lancar($1, $2, 'ajuste_saida', $3, 'inventario', $4, $5)", [dep, id, -qtd, REF, obs]); };
  const ajustarPara = async (id, alvo, obs) => { const s = await saldo(id); await lancar(id, alvo - s, obs); return s; };

  // 1) +96 na lista
  const idSemLink = (await q("select id from app.produtos where codigo = $1", [CODIGO_SEM_LINK]))[0]?.id;
  for (const id of [idSemLink, ...LISTA]) {
    let p = await pk(id);
    if (!p) { rel.lista.push(`NÃO ACHEI ${id}`); continue; }
    const r = { produto: `${p.codigo} ${p.nome}`, ativo_antes: p.ativo };
    const NAX = { "BLING-16711843664": "nax-ruivo", "BLING-16707872483": "nax-black" };
    if (NAX[p.codigo]) {
      const kit = (await q("select * from pk where codigo = $1", [NAX[p.codigo]]))[0];
      if (!kit.foto && p.foto) await c.query("update app.produtos set foto = $2 where id = $1", [kit.id, p.foto]);
      await c.query("update app.produtos set ativo = false, grupo = null, variante = null where id = $1", [p.id]);
      r.naxos = `vai para o kit ${kit.codigo} ${kit.nome} (shampoo + máscara); cadastro do Bling desativado${!kit.foto && p.foto ? ", foto copiada" : ""}`;
      p = kit;
    }
    // se está inativo e há um repetido ativo (mesma chave e marca), a entrada vai para o ativo
    if (!p.ativo) {
      const irmao = (await q("select * from pk where k = $1 and id <> $2 and ativo and coalesce(marca,'') in (coalesce($3,''), '') order by est desc limit 1", [p.k, p.id, p.marca]))[0];
      if (irmao) { r.lancado_no_repetido_ativo = `${irmao.codigo} ${irmao.nome}`; p = irmao; }
      else { await c.query("update app.produtos set ativo = true where id = $1", [p.id]); r.ativado = true; }
    }
    const comps = await q("select k.componente_id, k.quantidade, c.codigo, c.nome from app.kit_componentes k join app.produtos c on c.id = k.componente_id where k.kit_id = $1", [p.id]);
    if (comps.length) {
      r.kit_componentes = [];
      for (const k of comps) { const qtd = 96 * Number(k.quantidade); await lancar(k.componente_id, qtd, "+96 kits " + p.codigo); r.kit_componentes.push(`+${qtd} ${k.codigo} ${k.nome} (agora ${await saldo(k.componente_id)})`); }
    } else if (p.tipo === "kit") { r.erro = "kit sem componentes: não recebe estoque"; }
    else { await lancar(p.id, 96, "+96"); r.saldo_cd_foz = await saldo(p.id); }
    rel.lista.push(r);
  }

  // 2) Talco Dolomita: 2 unidades
  { const p = await pk(TALCO); const antes = await ajustarPara(p.id, 2, "Talco: ficam 2 un");
    if (!p.ativo) await c.query("update app.produtos set ativo = true where id = $1", [p.id]);
    rel.talco = `${p.codigo} ${p.nome}: ${antes} -> ${await saldo(p.id)}`; }

  // 3) Papel para Mechas: fica 1 por tamanho (o cadastro com foto e estoque), com 180 no CD Foz; os demais papéis para mechas saem
  const FICA = { "30 folhas": "2407202683", "120 folhas": "papel120", "180 folhas": "papel180", "200 folhas": "papel200", "1kg": "papel1000" };
  const papeis = await q("select * from pk where app.nome_normal(nome) ~ 'papel.*mecha' order by codigo");
  const ficaCods = new Set(Object.values(FICA));
  for (const [t, cod] of Object.entries(FICA)) {
    const p = papeis.find((x) => x.codigo === cod);
    if (!p) { rel.papel.acoes.push(`${t}: NÃO ACHEI ${cod}`); continue; }
    if (!p.ativo) await c.query("update app.produtos set ativo = true where id = $1", [p.id]);
    const antes = await ajustarPara(p.id, 180, `Papel ${t}: 180`);
    rel.papel.acoes.push(`${t}: fica ${cod} ${p.nome} (CD Foz ${antes} -> 180)`);
  }
  for (const x of papeis.filter((x) => !ficaCods.has(x.codigo))) {
    if (x.componente || x.tem_componentes) { rel.papel.acoes.push(`${x.codigo} é kit/componente, não mexi`); continue; }
    const s = await saldo(x.id); if (s > 0) await lancar(x.id, -s, "Papel repetido retirado");
    await c.query("update app.produtos set ativo = false, grupo = null, variante = null where id = $1", [x.id]);
    rel.papel.acoes.push(`desativado ${x.codigo} ${x.nome.slice(0, 70)}${x.ativo ? "" : " (já inativo)"}${s > 0 ? ` (tinha ${s}, zerado)` : ""}`);
  }
  const papelIds = new Set(papeis.map((p) => p.id));

  // 4) Duplicados em geral (recalcula com o estoque novo)
  await c.query("drop table pk"); await c.query(CHAVES);
  const linhas = await q("select * from pk where k is not null and k <> '' and k <> 'KIT:' and k in (select k from pk group by k having count(*) > 1 and bool_or(ativo)) order by k");
  const grupos = new Map();
  for (const l of linhas) if (!papelIds.has(l.id)) grupos.set(l.k, [...(grupos.get(l.k) ?? []), l]);
  for (const [k, g] of grupos) {
    if (g.length < 2) continue;
    const marcas = new Set(g.map((x) => x.marca).filter(Boolean));
    if (marcas.size > 1) { rel.dup.pulados.push(`${g[0].nome} — marcas diferentes (${[...marcas].join(", ")})`); continue; }
    const mn = new Set(g.map((x) => x.marca_nome).filter(Boolean));
    if (mn.size > 1) { rel.dup.pulados.push(`${g[0].nome} — marcas diferentes no nome (${[...mn].join(" / ")})`); continue; }
    const comEst = g.filter((x) => Number(x.est) > 0);
    if (comEst.length > 1) { rel.dup.pulados.push(`${g[0].nome} — ${comEst.length} cadastros com estoque: ${comEst.map((x) => `${x.codigo}=${x.est}`).join(", ")}`); continue; }
    const ord = [...g].sort((a, b) => (Number(b.est) > 0) - (Number(a.est) > 0) || b.tem_componentes - a.tem_componentes || b.ativo - a.ativo || (b.foto != null) - (a.foto != null) || b.tem_preco - a.tem_preco);
    const fica = ord[0], sai = ord.slice(1);
    rel.dup.grupos++;
    for (const campo of ["foto", "marca", "unidades_caixa", "estoque_minimo", "gtin"]) {
      if (fica[campo] == null) { const d = sai.find((x) => x.ativo && x[campo] != null) ?? sai.find((x) => x[campo] != null);
        if (d) { await c.query(`update app.produtos set ${campo} = $2 where id = $1`, [fica.id, d[campo]]); if (campo === "foto") rel.dup.fotos++; } }
    }
    if (!fica.grupo) { const d = sai.find((x) => x.grupo); if (d) await c.query("update app.produtos set grupo = $2, variante = $3 where id = $1", [fica.id, d.grupo, d.variante]); }
    if (!fica.tem_preco) { const d = sai.find((x) => x.tem_preco && x.ativo) ?? sai.find((x) => x.tem_preco);
      if (d) { const pr = await q("select distinct on (tabela) tabela, valor from app.precos where produto_id = $1 and vigente_desde <= current_date order by tabela, vigente_desde desc", [d.id]);
        if (pr.length) { await c.query("select app.importar_precos($1::jsonb)", [JSON.stringify(pr.map((p) => ({ codigo: fica.codigo, tabela: p.tabela, valor: Number(p.valor) })))]); rel.dup.precos++; } } }
    if (!fica.ativo) { await c.query("update app.produtos set ativo = true where id = $1", [fica.id]); rel.dup.ativados.push(`${fica.codigo} ${fica.nome}`); }
    rel.dup.mantidos.push(`${fica.codigo} ${fica.est > 0 ? `(est ${fica.est})` : "(sem estoque)"} ${fica.nome}`);
    for (const x of sai) {
      if (x.componente) { if (x.ativo) rel.dup.pulados.push(`${x.codigo} ${x.nome} — componente de kit, fica`); continue; }
      if (!x.ativo && !x.grupo) continue;
      await c.query("update app.produtos set ativo = false, grupo = null, variante = null where id = $1", [x.id]);
      if (x.ativo) rel.dup.desativados.push(`${x.codigo} ${x.nome}`);
    }
  }
  await c.query("update app.usuarios set ativo = false where id = $1", [u.id]);
  await c.query(SIMULAR ? "rollback" : "commit");
  console.log(JSON.stringify({ simulado: SIMULAR, ...rel }, null, 1));
} catch (e) { await c.query("rollback"); console.error("Erro:", e.message, e.stack); process.exitCode = 1; }
finally { await c.end(); }
