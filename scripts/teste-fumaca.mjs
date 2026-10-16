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
  for (const tela of ["/", "/pedidos", "/pedidos?pagamento=aguardando", "/pedidos/novo", `/pedidos/${pedidoKeila}`,
                      "/clientes", `/clientes/${clienteKeila}`, "/metas", "/estoque"]) {
    const r = await abrir(tela, cookie);
    ok(r.status === 200 && !r.html.includes("Application error"), `${quem}: ${tela} abre`);
  }
  const outro = await abrir(`/pedidos/${pedidoYessica}`, cookie);
  if (quem === "Keila") ok(outro.status === 404, "Keila não abre pedido da Yessica");
  else ok(outro.status === 200, "Gerente abre pedido de qualquer vendedora");
}
for (const tela of ["/promocoes", "/estoque/importar", "/estoque/precos"]) {
  const r = await abrir(tela, await sessao("gerente@teste.local"));
  ok(r.status === 200 && !r.html.includes("Application error"), `Gerente: ${tela} abre`);
}

const impKeila = await abrir("/estoque/importar", await sessao("keila@teste.local"));
ok(impKeila.status === 200 && impKeila.html.includes("Só gerente ou dono"), "Vendedora não importa produtos");

const modelo = await fetch(base + "/estoque/precos/modelo", { headers: { cookie: await sessao("gerente@teste.local") } });
ok(modelo.status === 200 && (await modelo.text()).includes("PY Normal (Gs)"), "Gerente baixa a planilha de preços");
ok((await fetch(base + "/estoque/precos/modelo", { headers: { cookie: await sessao("keila@teste.local") } })).status === 403,
  "Vendedora não baixa a planilha de preços");
ok((await abrir("/primeiro-acesso/token-invalido")).html.includes("já foi usado ou expirou"), "Link de primeiro acesso inválido é recusado");

// Área do cliente (atacado)
ok([302, 303, 307, 308].includes((await abrir("/loja")).status), "Área do cliente sem link manda para a tela de acesso");
const convite = randomBytes(32).toString("base64url");
await db.query(
  `insert into app.portal_convites (token_hash, cliente_id, expira_em)
   select $1, id, now() + interval '1 day' from app.clientes where nome = 'Salão Exemplo da Loja'`,
  [createHash("sha256").update(convite).digest("hex")]);
const entrada = await fetch(`${base}/loja/entrar/${convite}`, { redirect: "manual" });
const cookieCliente = (entrada.headers.get("set-cookie") ?? "").split(";")[0];
ok(entrada.status === 303 && cookieCliente.startsWith("vc_cliente="), "Link de acesso abre a sessão do cliente");
const reuso = await fetch(`${base}/loja/entrar/${convite}`, { redirect: "manual" });
ok((reuso.headers.get("location") ?? "").includes("motivo=link"), "Link usado de novo é recusado");
const cat = await abrir("/loja", cookieCliente);
ok(cat.status === 200 && cat.html.includes("Kit Platinum") && cat.html.includes("Gs "), "Catálogo do cliente abre com preços em Gs e o kit");
ok(cat.html.includes("CD de Foz"), "Cliente da loja vê a opção de pedir do CD de Foz");
const meus = await abrir("/loja/pedidos", cookieCliente);
ok(meus.status === 200, "Meus pedidos abre");

const lista = await abrir("/pedidos", await sessao("keila@teste.local"));
ok(lista.html.includes("Salão Exemplo A") && !lista.html.includes("Revenda Exemplo C"), "Lista da Keila mostra só os clientes dela");

await db.end();
if (falhas) { console.error(`${falhas} verificação(ões) falharam.`); process.exit(1); }
console.log("Teste de fumaça passou.");
