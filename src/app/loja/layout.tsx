import Link from "next/link";
import { headers } from "next/headers";
import { clienteAtual } from "@/lib/portal";
import { pool } from "@/lib/db";
import { linkWhatsApp, telefone } from "@/lib/formato";
import { TEXTOS, idiomaAtual, textosCarrinho } from "@/lib/idioma";
import { precisaBoasVindas, retiradaDoCliente } from "./acoes";
import { BoasVindas } from "./boas-vindas";
import { interno, marcaDe, categoriasDe, linhasEfetivas, type CategoriaDb } from "@/lib/vitrine";
import { BotaoCarrinho, Carrinho } from "./carrinho";
import { ehPrincipal, unidadeLoja } from "@/lib/unidade";
import { vendedoraDoLink } from "@/lib/vendedora-link";
import { FecharMenus, MenuSite } from "./menu-site";
import "./loja.css";

export const metadata = {
  title: { default: "Virtual Cosméticos · Distribuidora direto de fábrica em Foz do Iguaçu", template: "%s · Virtual Cosméticos" },
  description: "Distribuidora de cosméticos direto de fábrica em Foz do Iguaçu. Atacado para salões, perfumarias e revendedores: matizadores, kits capilares, corpo e banho, maquiagem e unhas.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "Virtual Cosméticos · Distribuidora de cosméticos em Foz do Iguaçu",
    description: "Atacado de cosméticos para salões, perfumarias e revendedores: matizadores, kits capilares, corpo e banho, maquiagem e unhas.",
    images: [{ url: "/marca/logo.png" }], type: "website", locale: "pt_BR",
  },
};

// Dados da empresa para o Google (aparece com nome, logo, cidade e redes sociais)
const DADOS_EMPRESA = JSON.stringify({
  "@context": "https://schema.org", "@type": "Store", name: "Virtual Cosméticos", url: "https://distribuidoravirtualcosmeticos.com/loja",
  logo: "https://distribuidoravirtualcosmeticos.com/marca/logo.png", image: "https://distribuidoravirtualcosmeticos.com/marca/logo.png",
  description: "Distribuidora de cosméticos direto de fábrica em Foz do Iguaçu. Atacado para salões, perfumarias e revendedores.",
  address: { "@type": "PostalAddress", addressLocality: "Foz do Iguaçu", addressRegion: "PR", addressCountry: "BR" },
  sameAs: ["https://www.instagram.com/distribuidoravirtualcosmeticos", "https://www.facebook.com/share/1BHjxdgnRH/"],
});

const INSTAGRAM = "https://www.instagram.com/distribuidoravirtualcosmeticos";
const FACEBOOK = "https://www.facebook.com/share/1BHjxdgnRH/";

function Redes() {
  return (
    <div className="redes">
      <a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor" /></svg>
        Instagram
      </a>
      <a href={FACEBOOK} target="_blank" rel="noopener noreferrer" aria-label="Facebook">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M14 8.5V7c0-.8.5-1.2 1.2-1.2H17V2.5h-2.6C11.6 2.5 10.5 4.3 10.5 7v1.5H8V12h2.5v9.5H14V12h2.7l.4-3.5H14Z" fill="currentColor" /></svg>
        Facebook
      </a>
    </div>
  );
}

export default async function LayoutLoja({ children }: { children: React.ReactNode }) {
  const c = await clienteAtual();
  const unidade = await unidadeLoja();
  // entrada da equipe: o sistema fica em app.<domínio do site>
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").replace(/^www\./, "").replace(/^app\./, "");
  const urlSistema = host && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) && !/^\d/.test(host) ? `https://app.${host}/login` : "/login";
  const principal = ehPrincipal(unidade);
  const idioma = await idiomaAtual();
  const CATS = linhasEfetivas((await pool.query("select * from app.categorias_publicas()").catch(() => ({ rows: [] }))).rows as CategoriaDb[], idioma === "es");
  const t = { ...TEXTOS[idioma], linhas: { ...TEXTOS[idioma].linhas, ...CATS.nomes } };
  // Português: WhatsApp principal. Espanhol (clientes em guaranis): WhatsApp de vendas em Gs.
  const vend = c ? null : await vendedoraDoLink();
  const descontos = (await pool.query("select * from app.descontos_quantidade_ativos()")).rows
    .map((d) => ({ marca: d.marca, min_qtd: Number(d.min_qtd), desconto_pct: Number(d.desconto_pct), pais: d.pais }));
  const numero = c?.vendedora_whatsapp ?? vend?.whatsapp
    ?? String((await pool.query("select app.whatsapp_empresa($1) as w", [idioma === "es" ? "GS" : "BRL"])).rows[0]?.w ?? "");
  const zap = linkWhatsApp(numero, t.zapMsg);
  // Menu de categorias e marcas, com a quantidade de produtos de cada uma
  const produtos = (await pool.query("select produto_id, nome, marca, tipo from app.vitrine_publica_unidade($1)", [unidade.id])).rows as { produto_id: string; nome: string; marca: string | null; tipo: string }[];
  const catManual = new Map<string, string[] | null>(((await pool.query("select produto_id, categorias from app.vitrine_categorias()").catch(() => ({ rows: [] }))).rows as { produto_id: string; categorias: string[] | null }[]).map((r) => [r.produto_id, r.categorias]));
  const porLinha = new Map<string, number>(), porMarca = new Map<string, number>();
  for (const p of produtos) {
    if (interno(p.nome)) continue;
    const l = categoriasDe(p.nome, p.marca, p.tipo, catManual.get(p.produto_id)).linha;
    porLinha.set(l, (porLinha.get(l) ?? 0) + 1);
    const m = marcaDe(p.nome, p.marca);
    if (m) porMarca.set(m, (porMarca.get(m) ?? 0) + 1);
  }
  const marcas = [...porMarca.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));

  return (
    <div className="loja" lang={idioma === "es" ? "es" : "pt-BR"}>
      {principal && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: DADOS_EMPRESA }} />}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" precedence="default"
            href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=Figtree:wght@400;500;600;700&display=swap" />
      <Carrinho cliente={c ? { nome: c.nome, vendedora: c.vendedora, moeda: c.moeda, retirada: await retiradaDoCliente() } : null} t={textosCarrinho(t, c)} unidade={unidade.codigo} descontos={descontos}>
        {c && await precisaBoasVindas() && <BoasVindas nome={c.nome} vendedora={c.vendedora} es={idioma === "es" || c.moeda === "GS"} />}
        <div className="fixo">
        <header className="topo">
          <div className="in topo-in">
            <MenuSite rotulo={t.menu} fechar={t.fechar} grupos={[
              { links: [
                { href: "/loja", texto: t.inicio },
                { href: "/loja?promocao=1#catalogo", texto: t.promocoes },
                { href: "/loja?novidade=1#catalogo", texto: t.novidades },
                { href: "/loja#mais-vendidos", texto: t.maisVendidos },
                { href: "/loja/quem-somos", texto: t.quemSomos },
              ] },
              { titulo: t.categorias, links: CATS.lista.filter((l) => porLinha.get(l.chave)).map((l) => ({ href: `/loja?linha=${l.chave}#catalogo`, texto: t.linhas[l.chave], qtd: porLinha.get(l.chave) })) },
              { titulo: t.marcas, links: [...marcas.slice().sort((a, b) => b[1] - a[1]).slice(0, 12).map(([m, n]) => ({ href: `/loja?marca=${encodeURIComponent(m)}#catalogo`, texto: m, qtd: n })),
                { href: "/loja/marcas", texto: t.verTodasMarcas }] },
              { titulo: c ? c.nome : t.clientes, links: c
                ? [{ href: "/loja/conta", texto: t.minhaConta }, { href: "/loja/reposicao", texto: t.reposicao }, { href: "/loja/pedidos", texto: t.meusPedidos }, { href: "/loja/sair", texto: t.sair }]
                : [{ href: "/loja/cadastro", texto: t.querSerCliente }, { href: "/loja/acesso", texto: t.jaSouCliente }] },
              { linha: true, links: [{ href: urlSistema, texto: t.acessoEquipe }, { href: `/loja/idioma?l=${t.idiomaCodigo}`, texto: t.idioma }, { href: INSTAGRAM, texto: "Instagram" }, { href: FACEBOOK, texto: "Facebook" }] },
            ]} />
            <Link href="/loja" className="marca" aria-label={unidade.loja_nome}>
              <img src="/marca/icone.png" width={42} height={40} alt="" />
              <span className="marca-txt"><b>Virtual</b>Cosméticos{!principal && <em className="marca-unidade">{unidade.codigo === "loja-cde" ? "CDE" : unidade.nome}</em>}</span>
            </Link>
            <form action="/loja" className="busca" role="search">
              <input name="q" type="search" placeholder={t.buscar} aria-label={t.buscar} />
            </form>
            <nav className="nav" aria-label="Menu">
              <a className="admin-equipe" href={urlSistema} title={t.acessoEquipe} rel="nofollow">Admin</a>
              <a className="idioma" href={`/loja/idioma?l=${t.idiomaCodigo}`} hrefLang={t.idiomaCodigo} lang={t.idiomaCodigo}>{t.idioma}</a>
              {c ? <Link href="/loja/conta">{t.minhaConta}</Link> : (
                <details className="menu-cair area-cliente">
                  <summary>{t.areaCliente}</summary>
                  <div className="menu-painel">
                    <a href="/loja/acesso">{t.entrarCliente}</a>
                    <a href="/loja/cadastro">{t.querSerCliente}</a>
                    <a href={urlSistema} rel="nofollow">{t.acessoEquipe}</a>
                  </div>
                </details>
              )}
              <BotaoCarrinho />
            </nav>
          </div>
        </header>
        <nav className="subnav" aria-label={t.catalogo}>
          <div className="in">
            <details className="menu-cair">
              <summary>{t.categorias}</summary>
              <div className="menu-painel">
                {CATS.lista.filter((l) => porLinha.get(l.chave)).map((l) => (
                  <a key={l.chave} href={`/loja?linha=${l.chave}#catalogo`}>{t.linhas[l.chave]}<span>{porLinha.get(l.chave)}</span></a>
                ))}
              </div>
            </details>
            <details className="menu-cair">
              <summary>{t.marcas}</summary>
              <div className="menu-painel" style={{ ["--colunas" as string]: marcas.length > 10 ? 2 : 1 }}>
                {marcas.map(([m, n]) => <a key={m} href={`/loja?marca=${encodeURIComponent(m)}#catalogo`}>{m}<span>{n}</span></a>)}
                <a className="todas" href="/loja/marcas">{t.verTodasMarcas}</a>
              </div>
            </details>
            <div className="subnav-rolagem">
              <Link href="/loja?promocao=1#catalogo" className="promo">{t.promocoes}</Link>
              <Link href="/loja?novidade=1#catalogo">{t.novidades}</Link>
              <Link href="/loja#mais-vendidos">{t.maisVendidos}</Link>
              <Link href="/loja?linha=kits#catalogo">{t.linhas.kits}</Link>
              <Link href="/loja/quem-somos">{t.quemSomos}</Link>
            </div>
          </div>
        </nav>
        </div>
        <FecharMenus />

        <main className="principal">{children}</main>

        <footer className="rodape">
          <div className="in rodape-in">
            <div>
              <img className="rodape-logo" src="/marca/logo.png" width={202} height={116} alt="Virtual Cosméticos" />
              <p>{t.rodapeTexto}</p>
              <Link href="/loja/quem-somos">{t.quemSomos}</Link>
            </div>
            <div>
              <h3>{t.atendimento}</h3>
              {zap && <a href={zap} target="_blank" rel="noopener noreferrer">WhatsApp {telefone(numero)}</a>}
              <p>{t.rodapeZap}</p>
              <Redes />
            </div>
            <div>
              <h3>{c ? c.nome : t.clientes}</h3>
              {c ? (
                <>
                  <p>{t.atendimentoDe(c.vendedora)}</p>
                  {/* <a> e não <Link>: o Link pré-carrega a rota em segundo plano e isso deslogava o cliente sozinho */}
                  <a href="/loja/sair" rel="nofollow">{t.sair}</a>
                </>
              ) : (
                <>
                  <p>{t.rodapeClientes}</p>
                  <Link href="/loja/cadastro">{t.querSerCliente}</Link>{" · "}
                  <Link href="/loja/acesso">{t.jaSouCliente}</Link>
                </>
              )}
            </div>
          </div>
        </footer>
      </Carrinho>
    </div>
  );
}
