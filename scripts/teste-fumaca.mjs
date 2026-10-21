#!/usr/bin/env node
// Teste de fumaça: abre cada tela como gerente e como vendedora e confere
// que carregam e que a vendedora não vê pedido de outra vendedora.
// Uso: DATABASE_URL_ADMIN=... node scripts/teste-fumaca.mjs http://localhost:3000

import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const base = process.argv[2] ?? "http://localhost:3000";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await db.connect();
let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? "ok" : "FALHOU"} - ${msg}`); if (!cond) falhas++; };

async function sessao(email) {
  const token = randomBytes(32).toString("base64url");
  const sha = createHash("sha256").update(token).digest("hex");
  await db.query(
    `insert into app.sessoes (token_hash, usuario_id, expira_em) select $1, id, now() + interval '1 hour' from app.usuarios where email = $2`,
    [sha, email]);
  return `vc_sessao=${token}`;
}

async function abrir(caminho, cookie) {
  const r = await fetch(base + caminho, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  const html = r.status === 200 ? await r.text() : "";
  return { status: r.status, html, local: r.headers.get("location") ?? "" };
}

// Sem login
const login = await abrir("/login");
ok(login.status === 200 && login.html.includes("Entrar"), "Tela de login abre");
const semLogin = await abrir("/");
ok([302, 303, 307, 308].includes(semLogin.status) && semLogin.local.includes("/login"), "Sem login, o sistema manda para o login");
ok((await abrir("/comprovantes/00000000-0000-0000-0000-000000000000")).status === 401, "Comprovante exige login");

const pedidoKeila = (await db.query(
  "select p.id from app.pedidos p join app.vendedoras v on v.id = p.vendedora_id where v.nome = 'Keila' limit 1")).rows[0].id;
const pedidoYessica = (await db.query(
  "select p.id from app.pedidos p join app.vendedoras v on v.id = p.vendedora_id where v.nome = 'Yessica' limit 1")).rows[0].id;
const clienteKeila = (await db.query(
  "select c.id from app.clientes c join app.vendedoras v on v.id = c.vendedora_id where v.nome = 'Keila' limit 1")).rows[0].id;

for (const [email, quem] of [["gerente@teste.local", "Gerente"], ["keila@teste.local", "Keila"]]) {
  const cookie = await sessao(email);
  for (const tela of ["/", "/pedidos", "/pedidos?pagamento=aguardando", "/pedidos/novo", "/caixa", "/estoque/inventario", "/pedidos?desconto=pendente", "/catalogo?marca=Rhenuks", "/relatorios?aba=site", "/loja/esqueci", `/pedidos/${pedidoKeila}`,
                      "/clientes", `/clientes/${clienteKeila}`, "/metas", "/estoque", "/estoque?situacao=zerado", "/estoque?situacao=com"]) {
    const r = await abrir(tela, cookie);
    ok(r.status === 200 && !r.html.includes("Application error"), `${quem}: ${tela} abre`);
  }
  const outro = await abrir(`/pedidos/${pedidoYessica}`, cookie);
  if (quem === "Keila") ok(outro.status === 404, "Keila não abre pedido da Yessica");
  else ok(outro.status === 200, "Gerente abre pedido de qualquer vendedora");
}
for (const tela of [`/pedidos/${pedidoKeila}/resumo`, "/comissoes", "/comissoes?mes=2026-01", "/procuras", "/procuras?dias=365"]) {
  for (const email of ["gerente@teste.local", "keila@teste.local"]) {
    const r = await abrir(tela, await sessao(email));
    ok(r.status === 200 && !r.html.includes("Application error"), `${email}: ${tela} abre`);
  }
}
for (const tela of ["/produtos/kits", "/produtos/kits?marca=Maycrene", "/despesas", "/despesas?ver=todas", "/parametros", "/relatorios?aba=lucro", "/relatorios?aba=resultado", "/relatorios?aba=envios"]) {
  const r = await abrir(tela, await sessao("gerente@teste.local"));
  ok(r.status === 200 && !r.html.includes("Application error"), `Gerente: ${tela} abre`);
}
for (const tela of ["/despesas", "/parametros"]) {
  const r = await abrir(tela, await sessao("keila@teste.local"));
  ok([302, 303, 307, 308].includes(r.status) || !r.html.includes("Lançar conta"), `Vendedora não vê ${tela}`);
}
// Recompra: gerente e vendedora abrem (cada uma vê os seus clientes)
for (const tela of ["/clientes/recompra", "/clientes/recompra?s=inativo", "/clientes/recompra?s=recuperado"]) {
  for (const email of ["gerente@teste.local", "keila@teste.local"]) {
    const r = await abrir(tela, await sessao(email));
    ok(r.status === 200 && !r.html.includes("Application error") && r.html.includes("Recompra"), `${email}: ${tela} abre`);
  }
}
// Inteligência comercial: gestão vê as três abas; vendedora não entra.
for (const tela of ["/inteligencia", "/inteligencia?aba=rentabilidade", "/inteligencia?aba=custos", "/inteligencia?aba=rentabilidade&alerta=sem_frete", "/inteligencia?aba=classificacao", "/inteligencia?aba=classificacao&cat=parado", "/inteligencia?aba=compras", "/inteligencia?aba=retirada", "/inteligencia?aba=marcas", "/inteligencia?aba=sugestoes"]) {
  const r = await abrir(tela, await sessao("gerente@teste.local"));
  ok(r.status === 200 && !r.html.includes("Application error") && r.html.includes("Inteligência comercial"), `Gerente: ${tela} abre`);
}
{
  const r = await abrir("/inteligencia?aba=rentabilidade", await sessao("keila@teste.local"));
  ok([302, 303, 307, 308].includes(r.status) || !r.html.includes("Contribuição VIP"), "Vendedora não vê a rentabilidade");
}
// Saúde financeira: área do dono. Gerente e vendedora não entram; gerente liberado pelo dono entra.
for (const email of ["gerente@teste.local", "keila@teste.local"]) {
  const r = await abrir("/saude-financeira", await sessao(email));
  ok([302, 303, 307, 308].includes(r.status) || !r.html.includes("Plano de ação"), `${email}: não vê /saude-financeira sem liberação`);
}
await db.query(`update app.usuarios set permissoes = permissoes || '{"saude_financeira": true}' where email = 'gerente@teste.local'`);
{
  const r = await abrir("/saude-financeira", await sessao("gerente@teste.local"));
  ok(r.status === 200 && r.html.includes("Plano de ação") && !r.html.includes("Application error"), "Gerente liberado: /saude-financeira abre");
}
await db.query(`update app.usuarios set permissoes = permissoes - 'saude_financeira' where email = 'gerente@teste.local'`);
ok((await fetch(base + "/comissoes/planilha", { headers: { cookie: await sessao("keila@teste.local") } })).status === 403,
  "Vendedora não baixa a planilha de comissões");
ok((await abrir("/loja/pedido/token-que-nao-existe-123456")).html.includes("inv"), "Link de pedido inválido é recusado");
{
  const token = randomBytes(24).toString("base64url");
  await db.query("insert into app.pedido_links (token_hash, pedido_id, expira_em) values ($1, $2, now() + interval '1 day')",
    [createHash("sha256").update(token).digest("hex"), pedidoKeila]);
  const r = await abrir(`/loja/pedido/${token}`);
  ok(r.status === 200 && !r.html.includes("Application error") && !r.html.includes("Link inválido") && !r.html.includes("Link inválido"),
    "Cliente abre o pedido pelo link, sem login");
}

for (const tela of ["/estoque/historico", "/estoque/historico?ver=itens&marca=Maycrene", "/estoque/historico?usuario=sistema&tipo=ajuste_entrada", "/relatorios/compra", "/relatorios/compra?marca=Maycrene", "/relatorios/compra?marca=Maycrene&todos=1&dias=60&prazo=10", "/promocoes", "/estoque/importar", "/estoque/precos", "/produtos", "/produtos/novo", "/produtos?filtro=sem-foto", "/site"]) {
  const r = await abrir(tela, await sessao("gerente@teste.local"));
  ok(r.status === 200 && !r.html.includes("Application error"), `Gerente: ${tela} abre`);
}

const impKeila = await abrir("/estoque/importar", await sessao("keila@teste.local"));
const semAcesso = (r) => (r.status >= 300 && r.status < 400 && r.local.includes("/sem-permissao")) || r.html.includes("Sem acesso a esta área") || r.html.includes("Só gerente ou dono");
ok(semAcesso(impKeila), "Vendedora não importa produtos");
ok(semAcesso(await abrir("/equipe", await sessao("keila@teste.local"))), "Vendedora não abre Equipe e acessos");
const semPerm = await abrir("/sem-permissao?area=equipe", await sessao("keila@teste.local"));
ok(semPerm.status === 200 && semPerm.html.includes("Sem acesso a esta área"), "Tela de sem acesso abre");

const modelo = await fetch(base + "/estoque/precos/modelo", { headers: { cookie: await sessao("gerente@teste.local") } });
ok(modelo.status === 200 && (await modelo.text()).includes("PY Normal (Gs)"), "Gerente baixa a planilha de preços");
ok((await fetch(base + "/estoque/precos/modelo", { headers: { cookie: await sessao("keila@teste.local") } })).status === 403,
  "Vendedora não baixa a planilha de preços");
ok((await abrir("/primeiro-acesso/token-invalido")).html.includes("já foi usado ou expirou"), "Link de primeiro acesso inválido é recusado");

// Área do cliente (atacado)
const vitrine = await abrir("/loja");
ok(vitrine.status === 200 && vitrine.html.includes("Categorias") && !vitrine.html.includes("Gs "), "Vitrine pública abre sem login e sem preços");
ok((await abrir("/loja?linha=kits")).status === 200 && (await abrir("/loja?q=shampoo")).status === 200, "Filtro por linha e busca funcionam");
ok((await abrir("/loja/marcas")).status === 200 && (await abrir("/loja?promocao=1")).status === 200 && (await abrir("/loja?marca=Soul")).status === 200,
  "Marcas, promoções e filtro por marca abrem");
ok((await abrir("/loja/cadastro")).html.includes("Quero ser cliente"), "Cadastro de novo cliente abre");
const es = await fetch(base + "/loja", { headers: { cookie: "vc_idioma=es" } });
const htmlEs = await es.text();
ok(htmlEs.includes("Distribuidora de cosméticos directo de fábrica") && !htmlEs.includes("Paraguai"), "Site em espanhol e sem citar Paraguai");
ok(!vitrine.html.includes("Ciudad del Este") && !vitrine.html.includes("Paraguai"), "Site em português sem citar CDE/Paraguai");
ok([302, 303, 307, 308].includes((await abrir("/loja/pedidos")).status), "Meus pedidos sem link manda para a tela de acesso");
ok((await fetch(base + "/marca/icone.png")).status === 200, "Logo é servido");
ok((await fetch(base + "/fotos/..%2Fetc%2Fpasswd")).status === 404, "Rota de fotos não aceita caminho estranho");
const umProduto = (await db.query("select id from app.produtos limit 1")).rows[0]?.id;
if (umProduto) ok((await abrir(`/produtos/${umProduto}`, await sessao("gerente@teste.local"))).status === 200, "Ficha do produto abre");
const convite = randomBytes(32).toString("base64url");
await db.query(
  `insert into app.portal_convites (token_hash, cliente_id, expira_em)
   select $1, id, now() + interval '1 day' from app.clientes where nome = 'Salão Exemplo da Loja'`,
  [createHash("sha256").update(convite).digest("hex")]);
const previa = await fetch(`${base}/loja/entrar/${convite}`, { redirect: "manual", headers: { "user-agent": "WhatsApp/2.23.20.0 A" } });
ok(previa.status === 200 && !(previa.headers.get("set-cookie") ?? "").includes("vc_cliente"), "Pré-visualização do WhatsApp não gasta o link");
const entrada = await fetch(`${base}/loja/entrar/${convite}`, { redirect: "manual" });
const cookieCliente = (entrada.headers.get("set-cookie") ?? "").split(";")[0];
ok(entrada.status === 303 && cookieCliente.startsWith("vc_cliente="), "Link de acesso abre a sessão do cliente");
const reuso = await fetch(`${base}/loja/entrar/${convite}`, { redirect: "manual" });
ok((reuso.headers.get("location") ?? "").includes("motivo=link"), "Link usado de novo é recusado");
const cat = await abrir("/loja", cookieCliente);
ok(cat.status === 200 && cat.html.includes("Kit Platinum") && cat.html.includes("Gs "), "Catálogo do cliente abre com preços em Gs e o kit");
ok(cat.html.includes("marca-unidade") && cat.html.includes('lang="es"'), "Cliente da loja de CDE cai no site de CDE (em espanhol), não no principal");
const entradaCde = await fetch(`${base}/loja/cde`, { redirect: "manual" });
const cookieCde = (entradaCde.headers.get("set-cookie") ?? "").split(";")[0];
ok(entradaCde.status === 303 && cookieCde.startsWith("vc_unidade=loja-cde"), "Endereço /cde guarda a loja de CDE para o visitante");
const vitCde = await abrir("/loja", cookieCde);
ok(vitCde.status === 200 && vitCde.html.includes("marca-unidade"), "Visitante da loja de CDE vê o site de CDE");
ok(cat.html.includes("wa.me/"), "Área do cliente mostra o WhatsApp da empresa");
ok((await abrir("/loja/acesso")).html.includes("wa.me/5545999972092"), "Sem login, o site mostra o WhatsApp principal (Brasil)");
ok((await abrir("/loja/acesso")).html.includes("CPF, CNPJ, CI ou RUC"), "Tela de acesso pede documento e senha");
{
  const r = await fetch(base + "/loja/acesso/entrar", { method: "POST", redirect: "manual", body: new URLSearchParams({ documento: "000", senha: "errada" }) });
  ok(r.status === 303 && (r.headers.get("location") ?? "").includes("/loja/acesso?erro="), "Login errado volta para a tela de acesso com o aviso");
}
ok([302, 303, 307, 308].includes((await abrir("/loja/conta")).status), "Minha conta do cliente exige login");
ok((await abrir("/loja/conta", cookieCliente)).status === 200, "Cliente logado abre Minha conta");
ok((await abrir("/conta", await sessao("keila@teste.local"))).html.includes("Trocar senha"), "Equipe abre Minha conta");
ok((await abrir("/equipe", await sessao("gerente@teste.local"))).html.includes("Adicionar pessoa"), "Gerente abre a tela Equipe");
const meus = await abrir("/loja/pedidos", cookieCliente);
ok(meus.status === 200, "Meus pedidos abre");

const lista = await abrir("/pedidos", await sessao("keila@teste.local"));
ok(lista.html.includes("Salão Exemplo A") && !lista.html.includes("Revenda Exemplo C"), "Lista da Keila mostra só os clientes dela");

await db.end();
if (falhas) { console.error(`${falhas} verificação(ões) falharam.`); process.exit(1); }
console.log("Teste de fumaça passou.");
