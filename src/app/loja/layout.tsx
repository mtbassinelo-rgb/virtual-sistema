import Link from "next/link";
import { clienteAtual } from "@/lib/portal";
import { pool } from "@/lib/db";
import { linkWhatsApp, telefone } from "@/lib/formato";
import { TEXTOS, idiomaAtual, textosCarrinho } from "@/lib/idioma";
import { LINHAS, interno, linhaDe, marcaDe } from "@/lib/vitrine";
import { BotaoCarrinho, Carrinho } from "./carrinho";
import "./loja.css";

export const metadata = {
  title: { default: "Virtual Cosméticos · Distribuidora direto de fábrica em Foz do Iguaçu", template: "%s · Virtual Cosméticos" },
  description: "Distribuidora de cosméticos direto de fábrica em Foz do Iguaçu. Atacado para salões, perfumarias e revendedores: matizadores, kits capilares, corpo e banho, maquiagem e unhas.",
  robots: { index: true, follow: true },
};

export default async function LayoutLoja({ children }: { children: React.ReactNode }) {
  const c = await clienteAtual();
  const idioma = await idiomaAtual();
  const t = TEXTOS[idioma];
  // Português: WhatsApp principal. Espanhol (clientes em guaranis): WhatsApp de vendas em Gs.
  const numero = c?.vendedora_whatsapp
    ?? String((await pool.query("select app.whatsapp_empresa($1) as w", [idioma === "es" ? "GS" : "BRL"])).rows[0]?.w ?? "");
  const zap = linkWhatsApp(numero, t.zapMsg);
  // Menu de categorias e marcas, com a quantidade de produtos de cada uma
  const produtos = (await pool.query("select nome, marca, tipo from app.vitrine_publica()")).rows as { nome: string; marca: string | null; tipo: string }[];
  const porLinha = new Map<string, number>(), porMarca = new Map<string, number>();
  for (const p of produtos) {
    if (interno(p.nome)) continue;
    const l = p.tipo === "kit" ? "kits" : linhaDe(p.nome);
    porLinha.set(l, (porLinha.get(l) ?? 0) + 1);
    const m = marcaDe(p.nome, p.marca);
    if (m) porMarca.set(m, (porMarca.get(m) ?? 0) + 1);
  }
  const marcas = [...porMarca.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));

  return (
    <div className="loja" lang={idioma === "es" ? "es" : "pt-BR"}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" precedence="default"
            href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=Figtree:wght@400;500;600;700&display=swap" />
      <Carrinho cliente={c ? { nome: c.nome, vendedora: c.vendedora, moeda: c.moeda } : null} t={textosCarrinho(t, c)}>
        <header className="topo">
          <div className="in topo-in">
            <Link href="/loja" className="marca" aria-label="Virtual Cosméticos">
              <img src="/marca/icone.png" width={42} height={40} alt="" />
              <span className="marca-txt"><b>Virtual</b>Cosméticos</span>
            </Link>
            <form action="/loja" className="busca" role="search">
              <input name="q" type="search" placeholder={t.buscar} aria-label={t.buscar} />
            </form>
            <nav className="nav" aria-label="Menu">
              <a className="idioma" href={`/loja/idioma?l=${t.idiomaCodigo}`} hrefLang={t.idiomaCodigo} lang={t.idiomaCodigo}>{t.idioma}</a>
              {c ? <Link href="/loja/pedidos">{t.meusPedidos}</Link> : <Link href="/loja/cadastro">{t.querSerCliente}</Link>}
              <BotaoCarrinho />
            </nav>
          </div>
        </header>
        <nav className="subnav" aria-label={t.catalogo}>
          <div className="in">
            <details className="menu-cair">
              <summary>{t.categorias}</summary>
              <div className="menu-painel">
                {LINHAS.filter((l) => porLinha.get(l.chave)).map((l) => (
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
            </div>
          </div>
        </nav>

        <main className="principal">{children}</main>

        <footer className="rodape">
          <div className="in rodape-in">
            <div>
              <img className="rodape-logo" src="/marca/logo.png" width={202} height={116} alt="Virtual Cosméticos" />
              <p>{t.rodapeTexto}</p>
            </div>
            <div>
              <h3>{t.atendimento}</h3>
              {zap && <a href={zap} target="_blank" rel="noopener noreferrer">WhatsApp {telefone(numero)}</a>}
              <p>{t.rodapeZap}</p>
            </div>
            <div>
              <h3>{c ? c.nome : t.clientes}</h3>
              {c ? (
                <>
                  <p>{t.atendimentoDe(c.vendedora)}</p>
                  <Link href="/loja/sair">{t.sair}</Link>
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
