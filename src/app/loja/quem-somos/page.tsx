import Link from "next/link";
import { pool } from "@/lib/db";
import { clienteAtual } from "@/lib/portal";
import { linkWhatsApp } from "@/lib/formato";
import { TEXTOS, idiomaAtual } from "@/lib/idioma";
import { LINHAS, interno, linhaDe, marcaDe } from "@/lib/vitrine";

export const metadata = {
  title: "Quem somos",
  description: "Virtual Cosméticos: distribuidora de cosméticos direto de fábrica em Foz do Iguaçu, atacado para salões, perfumarias e revendedores.",
};

const CONTEUDO = {
  pt: {
    chapeu: "Quem somos",
    titulo: "Distribuidora de cosméticos direto de fábrica em Foz do Iguaçu",
    intro: "A Virtual Cosméticos leva as marcas que mais vendem direto da fábrica para o seu negócio. Atendemos no atacado salões de beleza, perfumarias, farmácias e revendedores, com preço de distribuidora e atendimento próximo.",
    numeros: (p: number, m: number, l: number) => [[p, "produtos no catálogo"], [m, "marcas"], [l, "linhas de produtos"]] as [number, string][],
    pilaresTitulo: "Como trabalhamos",
    pilares: [
      ["Direto de fábrica", "Compramos direto dos fabricantes, sem intermediários. Assim o preço chega mais justo para quem revende."],
      ["Atacado em caixa fechada", "Os pedidos são por caixa fechada, e você vê sempre o preço da caixa e o da unidade para calcular a sua margem."],
      ["Atendimento pelo WhatsApp", "Cada cliente tem uma vendedora que acompanha o pedido do começo ao fim, pelo WhatsApp."],
      ["Catálogo sempre atualizado", "Novidades, promoções e os mais vendidos ficam no site para você montar o pedido quando quiser."],
    ],
    linhasTitulo: "O que você encontra aqui",
    chamadaTitulo: "Quer revender as nossas marcas?",
    chamadaTexto: "Faça o seu cadastro e uma vendedora entra em contato com a tabela de preços para o seu negócio.",
    cadastro: "Quero ser cliente", catalogo: "Ver o catálogo", zap: "Falar no WhatsApp", redes: "Siga a Virtual",
  },
  es: {
    chapeu: "Nosotros",
    titulo: "Distribuidora de cosméticos directo de fábrica en Foz do Iguaçu",
    intro: "Virtual Cosméticos lleva las marcas que más venden directo de fábrica a su negocio. Atendemos al por mayor a salones de belleza, perfumerías, farmacias y revendedores, con precio de distribuidora y atención cercana.",
    numeros: (p: number, m: number, l: number) => [[p, "productos en el catálogo"], [m, "marcas"], [l, "líneas de productos"]] as [number, string][],
    pilaresTitulo: "Cómo trabajamos",
    pilares: [
      ["Directo de fábrica", "Compramos directo a los fabricantes, sin intermediarios. Así el precio llega más justo a quien revende."],
      ["Mayorista en caja cerrada", "Los pedidos son por caja cerrada, y usted ve siempre el precio de la caja y el de la unidad para calcular su margen."],
      ["Atención por WhatsApp", "Cada cliente tiene una vendedora que acompaña el pedido de principio a fin, por WhatsApp."],
      ["Catálogo siempre actualizado", "Novedades, promociones y los más vendidos están en el sitio para que arme su pedido cuando quiera."],
    ],
    linhasTitulo: "Lo que encuentra aquí",
    chamadaTitulo: "¿Quiere revender nuestras marcas?",
    chamadaTexto: "Regístrese y una vendedora se comunicará con usted con la lista de precios para su negocio.",
    cadastro: "Quiero ser cliente", catalogo: "Ver el catálogo", zap: "Hablar por WhatsApp", redes: "Siga a Virtual",
  },
};

export default async function QuemSomos() {
  const idioma = await idiomaAtual();
  const t = TEXTOS[idioma];
  const x = CONTEUDO[idioma];
  const c = await clienteAtual();
  const numero = c?.vendedora_whatsapp
    ?? String((await pool.query("select app.whatsapp_empresa($1) as w", [idioma === "es" ? "GS" : "BRL"])).rows[0]?.w ?? "");
  const zap = linkWhatsApp(numero, t.zapMsg);

  const rows = (await pool.query("select nome, marca, tipo from app.vitrine_publica()")).rows as { nome: string; marca: string | null; tipo: string }[];
  const marcas = new Set<string>(), linhas = new Map<string, number>();
  let produtos = 0;
  for (const r of rows) {
    if (interno(r.nome)) continue;
    produtos++;
    const m = marcaDe(r.nome, r.marca);
    if (m) marcas.add(m);
    const l = linhaDe(r.nome, r.marca, r.tipo);
    linhas.set(l, (linhas.get(l) ?? 0) + 1);
  }
  const listaLinhas = LINHAS.filter((l) => linhas.get(l.chave) && l.chave !== "outros");

  return (
    <div className="sobre">
      <section className="sobre-topo">
        <div className="in">
          <span className="sobre-chapeu">{x.chapeu}</span>
          <h1>{x.titulo}</h1>
          <p>{x.intro}</p>
          <dl className="sobre-numeros">
            {x.numeros(produtos, marcas.size, listaLinhas.length).map(([n, r]) => (
              <div key={r}><dt>{n.toLocaleString(idioma === "es" ? "es-PY" : "pt-BR")}</dt><dd>{r}</dd></div>
            ))}
          </dl>
        </div>
      </section>

      <section className="in sobre-bloco">
        <h2>{x.pilaresTitulo}</h2>
        <ol className="sobre-pilares">
          {x.pilares.map(([h, p]) => <li key={h}><h3>{h}</h3><p>{p}</p></li>)}
        </ol>
      </section>

      <section className="in sobre-bloco">
        <h2>{x.linhasTitulo}</h2>
        <div className="linhas">
          {listaLinhas.map((l) => <Link key={l.chave} href={`/loja?linha=${l.chave}#catalogo`}>{t.linhas[l.chave]}</Link>)}
          <Link href="/loja/marcas">{t.verTodasMarcas}</Link>
        </div>
      </section>

      <section className="in sobre-bloco">
        <div className="sobre-chamada">
          <div>
            <h2>{x.chamadaTitulo}</h2>
            <p>{x.chamadaTexto}</p>
          </div>
          <div className="sobre-botoes">
            {!c && <Link className="sobre-botao principal" href="/loja/cadastro">{x.cadastro}</Link>}
            <Link className="sobre-botao" href="/loja#catalogo">{x.catalogo}</Link>
            {zap && <a className="sobre-botao" href={zap} target="_blank" rel="noopener noreferrer">{x.zap}</a>}
          </div>
        </div>
      </section>
    </div>
  );
}
