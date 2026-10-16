import Link from "next/link";
import { pool } from "@/lib/db";
import { clienteAtual, sha256, tokenCliente } from "@/lib/portal";
import { dinheiro, data, type Moeda } from "@/lib/formato";
import { CARTELA, LINHAS, corMarca, corRotulo, interno, linhaDe, marcaDe, nomeCurto } from "@/lib/vitrine";
import { Quantidade } from "./carrinho";

export const metadata = { title: { absolute: "Virtual Cosméticos · Atacado de cosméticos para salões e revendas" } };

type Publico = { produto_id: string; codigo: string; nome: string; marca: string | null; tipo: string; foto: string | null; tem_estoque: boolean };
type Preco = {
  produto_id: string; preco: string; preco_tabela: string; desconto_pct: string | null; limite_qtd: string | null;
  disponibilidade: "disponivel" | "ultimas" | "indisponivel"; disponivel_abastecedor: boolean; prazo_abastecimento: string | null;
  ultima_compra: string | null; destaque: "promocao" | "recompra" | "sugestao" | null;
};
type Extra = { produto_id: string; vendidos_90d: string; promo_pct: string | null; promo_fim: string | null; destaque: boolean };
type Produto = Publico & { linha: string; marcaNome: string | null; p?: Preco; x?: Extra };

const POR_PAGINA = 48;
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default async function Vitrine({ searchParams }: { searchParams: Promise<{ q?: string; linha?: string; marca?: string; promocao?: string; pagina?: string; erro?: string }> }) {
  const f = await searchParams;
  const cliente = await clienteAtual();
  const token = cliente ? await tokenCliente() : null;

  const publicos = (await pool.query("select * from app.vitrine_publica()")).rows as Publico[];
  const precos = new Map<string, Preco>();
  let meta: Record<string, unknown> | null = null;
  if (cliente && token) {
    for (const r of (await pool.query("select * from app.portal_catalogo($1)", [sha256(token)])).rows as Preco[]) precos.set(r.produto_id, r);
    meta = (await pool.query("select * from app.portal_meta($1)", [sha256(token)])).rows[0] ?? null;
  }
  const moeda: Moeda = cliente?.moeda ?? "BRL";
  const extras = new Map<string, Extra>();
  for (const r of (await pool.query("select * from app.vitrine_extras()")).rows as Extra[]) extras.set(r.produto_id, r);

  let todos: Produto[] = publicos.filter((p) => !interno(p.nome)).map((p) => ({
    ...p, linha: p.tipo === "kit" ? "kits" : linhaDe(p.nome), marcaNome: marcaDe(p.nome, p.marca), p: precos.get(p.produto_id), x: extras.get(p.produto_id),
  }));
  const contagem = new Map<string, number>();
  for (const p of todos) contagem.set(p.linha, (contagem.get(p.linha) ?? 0) + 1);
  const marcas = new Map<string, number>();
  for (const p of todos) if (p.marcaNome) marcas.set(p.marcaNome, (marcas.get(p.marcaNome) ?? 0) + 1);
  const listaMarcas = [...marcas.entries()].sort((a, b) => b[1] - a[1]);
  const pct = (p: Produto) => Number(p.p?.desconto_pct ?? p.x?.promo_pct ?? 0);
  const emPromocao = todos.filter((p) => pct(p) > 0).sort((a, b) => pct(b) - pct(a));
  const vendidos = todos.filter((p) => Number(p.x?.vendidos_90d ?? 0) > 0).sort((a, b) => Number(b.x!.vendidos_90d) - Number(a.x!.vendidos_90d));
  const destaques = [...vendidos, ...todos.filter((p) => p.x?.destaque && !vendidos.includes(p))].slice(0, 12);

  const q = (f.q ?? "").trim();
  const linha = LINHAS.find((l) => l.chave === f.linha)?.chave ?? null;
  const marca = f.marca && marcas.has(f.marca) ? f.marca : null;
  const soPromo = f.promocao === "1";
  if (linha) todos = todos.filter((p) => p.linha === linha);
  if (marca) todos = todos.filter((p) => p.marcaNome === marca);
  if (soPromo) todos = todos.filter((p) => pct(p) > 0);
  if (q) {
    const termos = sem(q).split(/\s+/).filter(Boolean);
    todos = todos.filter((p) => { const t = sem(`${p.nome} ${p.marcaNome ?? ""} ${p.codigo}`); return termos.every((x) => t.includes(x)); });
  }
  // Cliente: promoções e o que ele costuma comprar primeiro. Visitante: o que tem estoque primeiro.
  const peso = (p: Produto) => p.p?.destaque === "promocao" ? 0 : p.p?.destaque === "recompra" ? 1 : (p.p ? p.p.disponibilidade !== "indisponivel" : p.tem_estoque) ? 2 : 3;
  todos.sort((a, b) => peso(a) - peso(b) || a.nome.localeCompare(b.nome, "pt-BR"));

  const total = todos.length;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pagina = Math.min(paginas, Math.max(1, Number(f.pagina) || 1));
  const lista = todos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const filtrando = Boolean(q || linha || marca || soPromo);
  const url = (mud: Record<string, string | number | null>) => {
    const u = new URLSearchParams();
    const v = { q: q || null, linha, marca, promocao: soPromo ? "1" : null, pagina: null as string | number | null, ...mud };
    for (const [k, x] of Object.entries(v)) if (x !== null && x !== "" && !(k === "pagina" && x === 1)) u.set(k, String(x));
    const s = u.toString();
    return `/loja${s ? "?" + s : ""}#catalogo`;
  };
  const kits = !filtrando ? todos.filter((p) => p.linha === "kits").slice(0, 8) : [];

  return (
    <>
      {!filtrando && !cliente && (
        <section className="abertura">
          <div className="in abertura-in">
            <div className="abertura-texto">
              <h1>Cosméticos no atacado para quem cuida de cabelo, pele e unhas.</h1>
              <p>Salões, perfumarias e revendedoras do Brasil e do Paraguai compram aqui direto do nosso centro de distribuição em Foz do Iguaçu e da loja em Ciudad del Este.</p>
              <div className="abertura-acoes">
                <a className="botao-cheio" href="#catalogo">Ver os {publicos.length.toLocaleString("pt-BR")} produtos</a>
                <Link className="botao-linha" href="/loja/acesso">Já sou cliente</Link>
              </div>
            </div>
            <div className="cartela" aria-label="Cartela de matizadores">
              {CARTELA.map((c, i) => (
                <Link key={c.nome} href={`/loja?q=${encodeURIComponent(c.busca)}#catalogo`} className="mecha"
                      style={{ background: c.fundo, color: c.tinta, ["--i" as string]: i }}>
                  <span>{c.nome}</span>
                </Link>
              ))}
              <p className="cartela-legenda">Matizadores em todos os tons. Toque numa mecha para ver os produtos.</p>
            </div>
          </div>
        </section>
      )}

      {cliente && !filtrando && (
        <section className="in boas-vindas">
          <h1>Olá, {cliente.nome}.</h1>
          <p>Preços {cliente.categoria === "vip" ? "VIP " : ""}em {moeda === "GS" ? "guaranis" : "reais"}. Monte o pedido: {cliente.vendedora} confere o estoque, confirma o total e envia os dados para pagamento.</p>
          {meta && (
            <div className="meta">
              <b>
                {meta.meta_batida
                  ? `Meta batida! Você ganhou ${dinheiro(meta.valor_premio as string, moeda)} em mercadorias.`
                  : `Faltam ${dinheiro(meta.falta as string, moeda)} até ${data(meta.fim as string)} para ganhar ${dinheiro(meta.valor_premio as string, moeda)} em mercadorias.`}
              </b>
              <div className="meta-barra"><span style={{ width: `${Math.min(100, Number(meta.percentual))}%` }} /></div>
            </div>
          )}
        </section>
      )}

      {!filtrando && emPromocao.length > 0 && (
        <section className="in faixa" id="promocoes">
          <div className="faixa-titulo">
            <h2>Promoções</h2>
            <Link href={url({ promocao: "1", linha: null, marca: null, q: null })}>Ver todas as promoções</Link>
          </div>
          <div className="trilho">{emPromocao.slice(0, 12).map((p) => <Cartao key={p.produto_id} p={p} moeda={moeda} cliente={Boolean(cliente)} />)}</div>
        </section>
      )}

      {!filtrando && destaques.length > 0 && (
        <section className="in faixa" id="mais-vendidos">
          <div className="faixa-titulo"><h2>{vendidos.length > 0 ? "Mais vendidos" : "Destaques"}</h2></div>
          <div className="trilho">{destaques.map((p) => <Cartao key={p.produto_id} p={p} moeda={moeda} cliente={Boolean(cliente)} />)}</div>
        </section>
      )}

      {!filtrando && listaMarcas.length > 0 && (
        <section className="in faixa" id="marcas">
          <div className="faixa-titulo">
            <h2>Marcas</h2>
            <Link href="/loja/marcas">Ver todas as marcas</Link>
          </div>
          <div className="marcas">
            {listaMarcas.slice(0, 12).map(([m, n]) => {
              const c = corMarca(m);
              return (
                <Link key={m} href={url({ marca: m, linha: null, q: null, promocao: null })} className="marca-bloco" style={{ background: c.fundo, color: c.tinta }}>
                  <b>{m}</b><span>{n} {n === 1 ? "produto" : "produtos"}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {kits.length > 0 && (
        <section className="in faixa">
          <div className="faixa-titulo">
            <h2>Kits completos</h2>
            <Link href={url({ linha: "kits", q: null })}>Ver todos os kits</Link>
          </div>
          <div className="trilho">{kits.map((p) => <Cartao key={p.produto_id} p={p} moeda={moeda} cliente={Boolean(cliente)} />)}</div>
        </section>
      )}

      <section className="in catalogo" id="catalogo">
        <div className="catalogo-topo">
          <h2>{marca ?? (soPromo ? "Promoções" : linha ? LINHAS.find((l) => l.chave === linha)!.nome : q ? `Resultados para “${q}”` : "Catálogo")}</h2>
          <span className="contagem">{total.toLocaleString("pt-BR")} {total === 1 ? "produto" : "produtos"}</span>
        </div>
        <nav className="linhas" aria-label="Linhas de produto">
          <Link href={url({ linha: null })} className={!linha ? "ativa" : ""}>Tudo</Link>
          {LINHAS.filter((l) => contagem.get(l.chave)).map((l) => (
            <Link key={l.chave} href={url({ linha: l.chave })} className={linha === l.chave ? "ativa" : ""}>{l.nome}</Link>
          ))}
        </nav>
        {f.erro && <div className="aviso-erro" role="alert">{f.erro}</div>}
        {(q || marca || soPromo) && (
          <p className="limpar">
            {q && <Link href={url({ q: null })}>Limpar a busca</Link>}
            {marca && <Link href={url({ marca: null })}>Todas as marcas</Link>}
            {soPromo && <Link href={url({ promocao: null })}>Todos os produtos</Link>}
          </p>
        )}

        {lista.length === 0 ? (
          <div className="vazio-busca">
            <p>{soPromo ? "Nenhuma promoção agora. Volte em breve ou peça no WhatsApp." : `Nenhum produto${q ? ` com “${q}”` : " aqui"}. Tente outra palavra, como “shampoo” ou “kit”, ou peça no WhatsApp.`}</p>
          </div>
        ) : (
          <div className="grade">{lista.map((p) => <Cartao key={p.produto_id} p={p} moeda={moeda} cliente={Boolean(cliente)} />)}</div>
        )}

        {paginas > 1 && (
          <nav className="paginas" aria-label="Páginas">
            {pagina > 1 && <Link href={url({ pagina: pagina - 1 })}>Anterior</Link>}
            <span>Página {pagina} de {paginas}</span>
            {pagina < paginas && <Link href={url({ pagina: pagina + 1 })}>Próxima</Link>}
          </nav>
        )}
      </section>

      {!cliente && (
        <section className="in como">
          <h2>Como comprar</h2>
          <ol>
            <li><b>Monte o pedido</b><span>Escolha os produtos e as quantidades aqui no site.</span></li>
            <li><b>Envie pelo WhatsApp</b><span>O pedido chega para a vendedora do Brasil ou do Paraguai, conforme onde você compra.</span></li>
            <li><b>Receba o total</b><span>A vendedora confere o estoque e manda o valor de atacado e os dados para pagamento.</span></li>
            <li><b>Retire ou receba</b><span>Envio a partir de Foz do Iguaçu ou entrega em Ciudad del Este.</span></li>
          </ol>
        </section>
      )}
    </>
  );
}

function Cartao({ p, moeda, cliente }: { p: Produto; moeda: Moeda; cliente: boolean }) {
  const cor = corRotulo(p.nome, p.linha);
  const pr = p.p;
  const semEstoque = pr ? pr.disponibilidade === "indisponivel" && !pr.disponivel_abastecedor : false;
  const item = { id: p.produto_id, nome: p.nome, marca: p.marcaNome, preco: pr ? Number(pr.preco) : null, limite: pr?.limite_qtd ? Number(pr.limite_qtd) : null };
  return (
    <article className="cartao">
      <div className="rotulo" style={{ background: cor.fundo, color: cor.tinta }}>
        {p.foto ? <img src={p.foto} alt="" loading="lazy" /> : (
          <>
            <span className="rotulo-nome">{p.marcaNome ?? LINHAS.find((l) => l.chave === p.linha)?.nome}</span>
            <span className="rotulo-marca">{p.marcaNome ? LINHAS.find((l) => l.chave === p.linha)?.nome : nomeCurto(p.nome, null).split(" ").slice(0, 3).join(" ")}</span>
          </>
        )}
        {(pr?.desconto_pct || p.x?.promo_pct) && <span className="etiqueta-promo">−{Number(pr?.desconto_pct ?? p.x?.promo_pct)}%</span>}
        {p.linha === "kits" && !(pr?.desconto_pct || p.x?.promo_pct) && <span className="etiqueta-kit">Kit</span>}
        {Number(p.x?.vendidos_90d ?? 0) > 0 && <span className="etiqueta-vendido">Mais vendido</span>}
      </div>
      <div className="cartao-corpo">
        <h3>{p.nome}</h3>
        {cliente ? (
          pr ? (
            <div className="preco">
              {dinheiro(pr.preco, moeda)}
              {pr.desconto_pct && <s>{dinheiro(pr.preco_tabela, moeda)}</s>}
            </div>
          ) : <div className="preco-consulta">Preço com a vendedora</div>
        ) : null}
        {pr && (
          <div className="estoque">
            {pr.disponibilidade === "disponivel" && "Em estoque"}
            {pr.disponibilidade === "ultimas" && "Últimas unidades"}
            {pr.disponibilidade === "indisponivel" && pr.disponivel_abastecedor && `Vem do CD de Foz (${pr.prazo_abastecimento ?? "alguns dias"})`}
            {semEstoque && "Sem estoque agora: a vendedora confirma o prazo"}
          </div>
        )}
        {pr?.ultima_compra && <div className="estoque">Você comprou em {data(pr.ultima_compra)}</div>}
        <Quantidade item={item} rotulo={cliente ? "Adicionar ao pedido" : "Adicionar"} />
      </div>
    </article>
  );
}
