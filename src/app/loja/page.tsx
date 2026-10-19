import Link from "next/link";
import { pool } from "@/lib/db";
import { clienteAtual, sha256, tokenCliente } from "@/lib/portal";
import { dinheiro, data, type Moeda } from "@/lib/formato";
import { LINHAS, SUBLINHAS, corRotulo, interno, linhaDe, linhasExtras, marcaDe, nomeCurto, subLinhaDe } from "@/lib/vitrine";
import { Quantidade, SeletorVariantes } from "./carrinho";
import { QueroProduto } from "./quero-produto";
import { TEXTOS, idiomaAtual, type Textos } from "@/lib/idioma";
import { bannersPadrao, type Banner } from "@/lib/banners-padrao";
import { FaixaBanners } from "./banners";
import { ehPrincipal, unidadeLoja } from "@/lib/unidade";

export const metadata = { title: { absolute: "Virtual Cosméticos · Atacado de cosméticos para salões e revendas" } };

type Publico = { produto_id: string; codigo: string; nome: string; marca: string | null; tipo: string; foto: string | null; tem_estoque: boolean; novidade: boolean; unidades_caixa: number | null };
type Preco = {
  produto_id: string; preco: string; preco_tabela: string; desconto_pct: string | null; limite_qtd: string | null;
  disponibilidade: "disponivel" | "ultimas" | "indisponivel"; disponivel_abastecedor: boolean; prazo_abastecimento: string | null;
  ultima_compra: string | null; destaque: "promocao" | "recompra" | "sugestao" | null;
};
type Extra = { produto_id: string; vendidos_90d: string; promo_pct: string | null; promo_fim: string | null; destaque: boolean };
type Produto = Publico & { linha: string; extras?: string[]; marcaNome: string | null; p?: Preco; x?: Extra; grupo?: string | null; variante?: string | null; variantes?: Produto[] };

const POR_PAGINA = 60;
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default async function Vitrine({ searchParams }: { searchParams: Promise<{ q?: string; linha?: string; sub?: string; marca?: string; promocao?: string; novidade?: string; vista?: string; pagina?: string; erro?: string }> }) {
  const f = await searchParams;
  const cliente = await clienteAtual();
  const idioma = await idiomaAtual();
  const unidade = await unidadeLoja();
  // unidade que vende por unidade (CDE) ou cliente liberado pela vendedora: escolhe caixa fechada ou unidade
  const sessaoCliente = cliente ? await tokenCliente() : null;
  const vendeUnidade = unidade.vende_unidade
    || (sessaoCliente ? Boolean((await pool.query("select app.portal_compra_unidade($1) as ok", [sha256(sessaoCliente)])).rows[0]?.ok) : false);
  // site de outra unidade (ex.: CDE): os textos de abertura falam da loja dela, não do CD de Foz
  const t: Textos = ehPrincipal(unidade) ? TEXTOS[idioma] : {
    ...TEXTOS[idioma],
    heroTitulo: idioma === "es" ? `${unidade.loja_nome}: cosméticos por unidad y por caja cerrada.` : `${unidade.loja_nome}: cosméticos por unidade e por caixa fechada.`,
    heroTexto: idioma === "es" ? "Los mismos productos de la distribuidora, con stock propio en la tienda. Compre por unidad o por caja." : "Os mesmos produtos da distribuidora, com estoque próprio na loja. Compre por unidade ou por caixa.",
  };
  const proprios = (await pool.query("select * from app.banners_ativos($1)", [idioma])).rows as Banner[];
  // banners da equipe primeiro, depois os prontos (marcas e atacado)
  const banners = [...proprios, ...bannersPadrao(idioma, Boolean(cliente))];
  const token = cliente ? await tokenCliente() : null;

  const publicos = (await pool.query("select * from app.vitrine_publica_unidade($1)", [unidade.id])).rows as Publico[];
  const precos = new Map<string, Preco>();
  let meta: Record<string, unknown> | null = null;
  let chegaram: { produto_id: string; nome: string }[] = [];
  if (cliente && token) {
    for (const r of (await pool.query("select * from app.portal_catalogo($1)", [sha256(token)])).rows as Preco[]) precos.set(r.produto_id, r);
    meta = (await pool.query("select * from app.portal_meta($1)", [sha256(token)])).rows[0] ?? null;
    chegaram = (await pool.query("select produto_id, nome from app.portal_chegaram($1)", [sha256(token)])).rows as { produto_id: string; nome: string }[];
  }
  const moeda: Moeda = cliente?.moeda ?? "BRL";
  const extras = new Map<string, Extra>();
  for (const r of (await pool.query("select * from app.vitrine_extras()")).rows as Extra[]) extras.set(r.produto_id, r);

  const grupos = new Map<string, { grupo: string; variante: string | null }>(
    ((await pool.query("select * from app.grupos_publicos()")).rows as { produto_id: string; grupo: string; variante: string | null }[]).map((g) => [g.produto_id, g]));
  let todos: Produto[] = publicos.filter((p) => !interno(p.nome)).map((p) => ({
    ...p, grupo: grupos.get(p.produto_id)?.grupo ?? null, variante: grupos.get(p.produto_id)?.variante ?? null, linha: linhaDe(p.nome, p.marca, p.tipo), marcaNome: marcaDe(p.nome, p.marca), p: precos.get(p.produto_id), x: extras.get(p.produto_id),
  }));
  const contagem = new Map<string, number>();
  for (const p of todos) {
    p.extras = linhasExtras(p.grupo ?? p.nome, p.linha);
    for (const l of [p.linha, ...p.extras]) contagem.set(l, (contagem.get(l) ?? 0) + 1);
  }
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
  const soNovidade = f.novidade === "1";
  const novidades = todos.filter((p) => p.novidade);
  if (linha) todos = todos.filter((p) => p.linha === linha || p.extras?.includes(linha));
  // subcategorias da linha (ex.: Cabelo → Ativador de cachos, Shampoos…)
  const contagemSub = new Map<string, number>();
  if (linha && SUBLINHAS[linha]) for (const p of todos) { const k = subLinhaDe(linha, p.grupo ?? p.nome) ?? "outros"; contagemSub.set(k, (contagemSub.get(k) ?? 0) + 1); }
  const sub = linha && f.sub && (contagemSub.has(f.sub)) ? f.sub : null;
  if (sub && linha) todos = todos.filter((p) => (subLinhaDe(linha, p.grupo ?? p.nome) ?? "outros") === sub);
  if (marca) todos = todos.filter((p) => p.marcaNome === marca);
  if (soPromo) todos = todos.filter((p) => pct(p) > 0);
  if (soNovidade) todos = todos.filter((p) => p.novidade);
  if (q) {
    const termos = sem(q).split(/\s+/).filter(Boolean);
    todos = todos.filter((p) => { const t = sem(`${p.nome} ${p.marcaNome ?? ""} ${p.codigo}`); return termos.every((x) => t.includes(x)); });
  }
  // Cliente: promoções e o que ele costuma comprar primeiro. Visitante: o que tem estoque primeiro.
  const peso = (p: Produto) => p.p?.destaque === "promocao" ? 0 : p.p?.destaque === "recompra" ? 1 : (p.p ? p.p.disponibilidade !== "indisponivel" : p.tem_estoque) ? 2 : 3;
  todos.sort((a, b) => peso(a) - peso(b) || a.nome.localeCompare(b.nome, "pt-BR"));

  // fragrâncias do mesmo produto viram um cartão só (o cliente abre e escolhe cada uma)
  const exibidos: Produto[] = [];
  const porGrupo = new Map<string, Produto>();
  for (const p of todos) {
    if (!p.grupo) { exibidos.push(p); continue; }
    const k = `${p.marca ?? ""}|${p.grupo}`;
    const g = porGrupo.get(k);
    if (g) { g.variantes!.push(p); continue; }
    const novo: Produto = { ...p, produto_id: `grupo:${k}`, nome: p.grupo, variantes: [p] };
    porGrupo.set(k, novo); exibidos.push(novo);
  }
  for (let i = 0; i < exibidos.length; i++) {
    const g = exibidos[i];
    if (g.variantes?.length === 1) exibidos[i] = g.variantes[0];
    else if (g.variantes) { g.foto = g.variantes.find((v) => v.foto)?.foto ?? null; g.variantes.sort((a, b) => (a.variante ?? a.nome).localeCompare(b.variante ?? b.nome, "pt-BR")); }
  }
  todos = exibidos;
  const total = todos.length;
  // busca entra no funil de vendas (o que procuram e o que não acham)
  if (q && !f.pagina) await pool.query("select app.registrar_evento_site('busca', null, $1, null, $2, $3, $4)", [token ? sha256(token) : null, q, total, unidade.codigo]).catch(() => undefined);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pagina = Math.min(paginas, Math.max(1, Number(f.pagina) || 1));
  const lista = todos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const vista = f.vista === "lista" ? "lista" : "grade";
  const filtrando = Boolean(q || linha || marca || soPromo || soNovidade);
  const url = (mud: Record<string, string | number | null>) => {
    const u = new URLSearchParams();
    const v = { q: q || null, linha, sub: "linha" in mud ? null : sub, marca, promocao: soPromo ? "1" : null, novidade: soNovidade ? "1" : null, vista: vista === "lista" ? "lista" : null, pagina: null as string | number | null, ...mud };
    for (const [k, x] of Object.entries(v)) if (x !== null && x !== "" && !(k === "pagina" && x === 1)) u.set(k, String(x));
    const s = u.toString();
    return `/loja${s ? "?" + s : ""}#catalogo`;
  };
  const kits = !filtrando ? todos.filter((p) => p.linha === "kits").slice(0, 8) : [];

  const n = (x: number) => `${x.toLocaleString(idioma === "es" ? "es-PY" : "pt-BR")} ${x === 1 ? t.produto : t.produtos}`;
  const cartao = (p: Produto) => <Cartao key={p.produto_id} p={p} moeda={moeda} cliente={Boolean(cliente)} t={t} vendeUnidade={vendeUnidade} />;
  const nomeSub = sub ? [...(SUBLINHAS[linha ?? ""] ?? []), { chave: "outros", nome: "Outros", es: "Otros" }].find((s) => s.chave === sub) : null;
  const titulo = marca ?? (soPromo ? t.promocoes : soNovidade ? t.novidades : linha ? (nomeSub ? (idioma === "es" ? nomeSub.es : nomeSub.nome) : t.linhas[linha]) : q ? t.resultados(q) : t.catalogo);

  return (
    <>
      {!filtrando && banners.length > 0 && <FaixaBanners banners={banners} rotulo={t.destaques} acao={t.verAgora} />}

      {!filtrando && !cliente && banners.length === 0 && (
        <section className="abertura">
          <div className="in abertura-in">
            <div className="abertura-texto">
              <h1>{t.heroTitulo}</h1>
              <p>{t.heroTexto}</p>
              <div className="abertura-acoes">
                <a className="botao-cheio" href="#catalogo">{t.verProdutos(publicos.length.toLocaleString(idioma === "es" ? "es-PY" : "pt-BR"))}</a>
                <Link className="botao-linha" href="/loja/cadastro">{t.querSerCliente}</Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {cliente && !filtrando && (
        <section className="in boas-vindas">
          <h1>{t.ola(cliente.nome)}</h1>
          {chegaram.length > 0 && (
            <div className="chegou"><b>{idioma === "es" ? "¡Llegó lo que pidió!" : "Chegou o que você pediu!"}</b> {chegaram.slice(0, 4).map((c) => c.nome).join(" · ")}
              {" "}<Link href={`/loja?q=${encodeURIComponent(chegaram[0].nome.split(" ").slice(0, 3).join(" "))}#catalogo`}>{idioma === "es" ? "Ver" : "Ver agora"}</Link></div>
          )}
          <p className="pequeno"><Link href="/loja/reposicao">{t.reposicao} →</Link></p>
          <p>{t.precosCliente(cliente.categoria === "vip", moeda === "GS", cliente.vendedora)}</p>
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
            <h2>{t.promocoes}</h2>
            <Link href={url({ promocao: "1", linha: null, marca: null, q: null })}>{t.verTodasPromocoes}</Link>
          </div>
          <div className="trilho">{emPromocao.slice(0, 12).map(cartao)}</div>
        </section>
      )}

      {!filtrando && novidades.length > 0 && (
        <section className="in faixa" id="novidades">
          <div className="faixa-titulo">
            <h2>{t.novidades}</h2>
            <Link href={url({ novidade: "1", linha: null, marca: null, q: null })}>{t.verTodas}</Link>
          </div>
          <div className="trilho">{novidades.slice(0, 12).map(cartao)}</div>
        </section>
      )}

      {!filtrando && destaques.length > 0 && (
        <section className="in faixa" id="mais-vendidos">
          <div className="faixa-titulo"><h2>{vendidos.length > 0 ? t.maisVendidos : t.destaques}</h2></div>
          <div className="trilho">{destaques.map(cartao)}</div>
        </section>
      )}

      {!filtrando && listaMarcas.length > 0 && (
        <section className="in faixa" id="marcas">
          <div className="faixa-titulo">
            <h2>{t.marcas}</h2>
            <Link href="/loja/marcas">{t.verTodasMarcas}</Link>
          </div>
          <div className="marcas">
            {listaMarcas.slice(0, 16).map(([m, qtd]) => {
              return (
                <Link key={m} href={url({ marca: m, linha: null, q: null, promocao: null })} className="marca-bloco">
                  <b>{m}</b><span>{qtd}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {kits.length > 0 && (
        <section className="in faixa">
          <div className="faixa-titulo">
            <h2>{t.kitsCompletos}</h2>
            <Link href={url({ linha: "kits", q: null })}>{t.verTodosKits}</Link>
          </div>
          <div className="trilho">{kits.map(cartao)}</div>
        </section>
      )}

      <section className="in catalogo" id="catalogo">
        <div className="catalogo-topo">
          <h2>{titulo}</h2>
          <span className="contagem">{n(total)}</span>
        </div>
        <div className="vistas" role="group" aria-label={t.catalogo}>
          <Link href={url({ vista: null })} className={vista === "grade" ? "ativa" : ""} aria-current={vista === "grade" ? "true" : undefined}>{t.grade}</Link>
          <Link href={url({ vista: "lista" })} className={vista === "lista" ? "ativa" : ""} aria-current={vista === "lista" ? "true" : undefined}>{t.lista}</Link>
        </div>
        <nav className="linhas" aria-label={t.catalogo}>
          <Link href={url({ linha: null })} className={!linha ? "ativa" : ""}>{t.tudo}</Link>
          {LINHAS.filter((l) => contagem.get(l.chave)).map((l) => (
            <Link key={l.chave} href={url({ linha: l.chave })} className={linha === l.chave ? "ativa" : ""}>{t.linhas[l.chave] ?? l.nome}</Link>
          ))}
        </nav>
        {linha && SUBLINHAS[linha] && contagemSub.size > 1 && (
          <nav className="linhas sublinhas" aria-label={t.linhas[linha]}>
            <Link href={url({ sub: null })} className={!sub ? "ativa" : ""}>{t.tudo}</Link>
            {[...SUBLINHAS[linha], { chave: "outros", nome: "Outros", es: "Otros" }].filter((s) => contagemSub.get(s.chave)).map((s) => (
              <Link key={s.chave} href={url({ sub: s.chave })} className={sub === s.chave ? "ativa" : ""}>
                {idioma === "es" ? s.es : s.nome} <small>{contagemSub.get(s.chave)}</small>
              </Link>
            ))}
          </nav>
        )}
        {f.erro && <div className="aviso-erro" role="alert">{f.erro}</div>}
        {(q || marca || soPromo || soNovidade) && (
          <p className="limpar">
            {q && <Link href={url({ q: null })}>{t.limparBusca}</Link>}
            {marca && <Link href={url({ marca: null })}>{t.todasMarcas}</Link>}
            {(soPromo || soNovidade) && <Link href={url({ promocao: null, novidade: null })}>{t.todosProdutos}</Link>}
          </p>
        )}

        {lista.length === 0 ? (
          <div className="vazio-busca"><p>{soPromo ? t.semPromocao : t.semResultado(q)}</p></div>
        ) : (
          vista === "grade"
            ? <div className="grade compacta">{lista.map(cartao)}</div>
            : <div className="catalogo-lista">{lista.map((p) => <LinhaCatalogo key={p.produto_id} p={p} moeda={moeda} cliente={Boolean(cliente)} t={t} vendeUnidade={vendeUnidade} />)}</div>
        )}

        {paginas > 1 && (
          <nav className="paginas" aria-label={t.catalogo}>
            {pagina > 1 && <Link href={url({ pagina: pagina - 1 })}>{t.anterior}</Link>}
            <span>{t.pagina(pagina, paginas)}</span>
            {pagina < paginas && <Link href={url({ pagina: pagina + 1 })}>{t.proxima}</Link>}
          </nav>
        )}
      </section>

      {!cliente && (
        <section className="in como">
          <h2>{t.comoComprar}</h2>
          <ol>{t.passos.map(([a, b]) => <li key={a}><b>{a}</b><span>{b}</span></li>)}</ol>
        </section>
      )}
    </>
  );
}

function Cartao({ p, moeda, cliente, t, vendeUnidade }: { p: Produto; moeda: Moeda; cliente: boolean; t: Textos; vendeUnidade: boolean }) {
  if (p.variantes) return <CartaoGrupo p={p} moeda={moeda} cliente={cliente} t={t} vendeUnidade={vendeUnidade} />;
  const cor = corRotulo(p.nome, p.linha);
  const pr = p.p;
  const semEstoque = esgotado(p, cliente);
  const item = itemCarrinho(p, semEstoque);
  const promo = pr?.desconto_pct ?? p.x?.promo_pct;
  return (
    <article className="cartao">
      <div className="rotulo" style={{ background: cor.fundo, color: cor.tinta }}>
        {p.foto ? <img src={p.foto} alt="" loading="lazy" /> : (
          <>
            <span className="rotulo-nome">{p.marcaNome ?? t.linhas[p.linha]}</span>
            <span className="rotulo-marca">{p.marcaNome ? t.linhas[p.linha] : nomeCurto(p.nome, null).split(" ").slice(0, 3).join(" ")}</span>
          </>
        )}
        {promo && <span className="etiqueta-promo">−{Number(promo)}%</span>}
        {!promo && p.novidade && <span className="etiqueta-promo">{t.novo}</span>}
        {p.linha === "kits" && !promo && !p.novidade && <span className="etiqueta-kit">{t.kit}</span>}
        {semEstoque ? <span className="etiqueta-esgotado">{t.esgotado}</span>
          : Number(p.x?.vendidos_90d ?? 0) > 0 && <span className="etiqueta-vendido">{t.maisVendido}</span>}
      </div>
      <div className="cartao-corpo">
        <h3>{p.nome}</h3>
        {promo && p.x?.promo_fim && <PrazoPromo fim={p.x.promo_fim} es={t.verAgora === "Ver productos"} />}
        {p.unidades_caixa && <div className="caixa-info">{t.caixaCom(p.unidades_caixa)}</div>}
        <Precos p={p} moeda={moeda} cliente={cliente} t={t} />
        {pr && (
          <div className="estoque">
            {pr.disponibilidade === "disponivel" && t.emEstoque}
            {pr.disponibilidade === "ultimas" && t.ultimas}
            {pr.disponibilidade === "indisponivel" && pr.disponivel_abastecedor && t.encomenda(pr.prazo_abastecimento)}
            {semEstoque && t.itemEncomenda}
          </div>
        )}
        {pr?.ultima_compra && <div className="estoque">{t.comprouEm(data(pr.ultima_compra))}</div>}
        <Comprar p={p} item={item} vendeUnidade={vendeUnidade} t={t} rotulo={semEstoque ? t.pedirEncomenda : cliente ? t.adicionarPedido : t.adicionar} />
        {semEstoque && <QueroProduto produtoId={p.produto_id} cliente={cliente} t={t.quero} />}
      </div>
    </article>
  );
}

/**
 * Botão de comprar. Na loja que vende por unidade e por caixa (CDE), produto com caixa mostra as duas opções:
 * a caixa fechada e a unidade avulsa (no carrinho viram duas linhas do mesmo produto).
 */
function Comprar({ p, item, vendeUnidade, t, rotulo }: { p: Produto; item: ReturnType<typeof itemCarrinho>; vendeUnidade: boolean; t: Textos; rotulo: string }) {
  if (!vendeUnidade || !p.unidades_caixa) return <Quantidade item={item} rotulo={rotulo} />;
  const unidade = { ...item, id: `${item.id}:un`, produto: item.id, nome: `${item.nome} (${t.unidade.toLowerCase()})`, caixa: null };
  return (
    <div className="comprar-duplo">
      <div><span>{t.caixaCom(p.unidades_caixa)}</span><Quantidade item={item} rotulo={rotulo} /></div>
      <div><span>{t.unidade}</span><Quantidade item={unidade} rotulo={rotulo} /></div>
    </div>
  );
}

/** Produto com várias fragrâncias: um cartão; ao abrir, cada fragrância tem a sua quantidade. */
function CartaoGrupo({ p, moeda, cliente, t, vendeUnidade, linha }: { p: Produto; moeda: Moeda; cliente: boolean; t: Textos; vendeUnidade: boolean; linha?: boolean }) {
  const vs = p.variantes!;
  const cor = corRotulo(p.nome, p.linha);
  const esgotados = vs.every((v) => esgotado(v, cliente));
  const promo = Math.max(0, ...vs.map((v) => Number(v.p?.desconto_pct ?? v.x?.promo_pct ?? 0)));
  const precos = vs.map((v) => v.p ? Number(v.p.preco) * (v.unidades_caixa || 1) : null).filter((x): x is number => x != null);
  const menor = precos.length ? Math.min(...precos) : null;
  const unitarios = vs.map((v) => v.p ? Number(v.p.preco) : null).filter((x): x is number => x != null);
  const menorUn = unitarios.length ? Math.min(...unitarios) : null;
  return (
    <article className={`cartao cartao-grupo ${linha ? "em-lista" : ""}`}>
      <div className="rotulo" style={{ background: cor.fundo, color: cor.tinta }}>
        {p.foto ? <img src={p.foto} alt="" loading="lazy" /> : <span className="rotulo-nome">{p.marcaNome ?? t.linhas[p.linha]}</span>}
        {promo > 0 && <span className="etiqueta-promo">−{promo}%</span>}
        {esgotados && <span className="etiqueta-esgotado">{t.esgotado}</span>}
      </div>
      <div className="cartao-corpo">
        <h3>{p.nome}</h3>
        <div className="caixa-info">{t.fragrancias(vs.length)}{p.unidades_caixa ? ` · ${t.caixaCom(p.unidades_caixa)}` : ""}</div>
        {cliente && menor != null && <div className="precos"><div className="preco"><small>{t.aPartirDe}</small> {dinheiro(menor, moeda)} <small>{p.unidades_caixa ? t.porCaixa : t.porUnidade}</small></div>
          {p.unidades_caixa && menorUn != null && <div className="preco-un"><b>{dinheiro(menorUn, moeda)}</b> {t.porUnidade}</div>}</div>}
        <SeletorVariantes ids={vs.map((v) => v.produto_id)} titulo={p.nome} foto={p.foto}
          subtitulo={[t.fragrancias(vs.length), p.unidades_caixa ? t.caixaCom(p.unidades_caixa) : ""].filter(Boolean).join(" · ")}
          rotulo={t.escolherFragrancia(vs.length)} textos={{ pronto: t.pronto, verPedido: t.verPedido, escolhidas: t.escolhidas(9999), fechar: t.fechar }}>
          {vs.map((v) => {
            const esg = esgotado(v, cliente);
            const pv = v.p ? Number(v.p.preco) * (v.unidades_caixa || 1) : null;
            return (
              <div key={v.produto_id} className={`var-linha ${esg ? "esgotada" : ""}`}>
                <div className="var-foto" style={{ background: corRotulo(v.variante ?? v.nome, p.linha).fundo }}>
                  {v.foto && v.foto !== p.foto ? <img src={v.foto} alt="" loading="lazy" /> : null}
                </div>
                <div className="var-info">
                  <div className="var-nome">
                    <b>{v.variante ?? v.nome}</b>
                    {cliente && v.p && <strong className="var-un">{dinheiro(Number(v.p.preco), moeda)}<small>/{t.un}</small></strong>}
                  </div>
                  <span>
                    {esg ? <span className="etiqueta-mini esgotado">{t.esgotado}</span>
                      : v.p?.disponibilidade === "ultimas" ? <span className="etiqueta-mini">{t.ultimas}</span> : null}
                    {cliente && pv != null && v.unidades_caixa ? <span className="var-preco">{t.cxAbrev} {dinheiro(pv, moeda)}</span> : null}
                  </span>
                </div>
                <Comprar p={v} item={itemCarrinho(v, esg)} vendeUnidade={vendeUnidade} t={t} rotulo={esg ? t.encomendar : t.adicionar} />
              </div>
            );
          })}
        </SeletorVariantes>
      </div>
    </article>
  );
}

/** Sem estoque em lugar nenhum: aparece "Esgotado" e o botão vira "Pedir por encomenda". */
function esgotado(p: Produto, cliente: boolean): boolean {
  if (cliente && p.p) return p.p.disponibilidade === "indisponivel" && !p.p.disponivel_abastecedor;
  return !p.tem_estoque;
}

function itemCarrinho(p: Produto, encomenda = false) {
  const pr = p.p;
  return { id: p.produto_id, nome: p.nome, marca: p.marcaNome, preco: pr ? Number(pr.preco) : null,
           limite: pr?.limite_qtd ? Number(pr.limite_qtd) : null, caixa: p.unidades_caixa, encomenda, marcaDb: p.marca };
}

/** Preço principal = caixa fechada (unidade × peças); embaixo, o preço da unidade. */
function Precos({ p, moeda, cliente, t }: { p: Produto; moeda: Moeda; cliente: boolean; t: Textos }) {
  const pr = p.p;
  if (!cliente) return null;
  if (!pr) return <div className="preco-consulta">{t.precoVendedora}</div>;
  const un = Number(pr.preco), cx = p.unidades_caixa;
  return (
    <div className="precos">
      <div className="preco">
        {dinheiro(cx ? un * cx : un, moeda)} <small>{cx ? t.porCaixa : t.porUnidade}</small>
        {pr.desconto_pct && <s>{dinheiro(cx ? Number(pr.preco_tabela) * cx : pr.preco_tabela, moeda)}</s>}
      </div>
      {cx && <div className="preco-un"><b>{dinheiro(un, moeda)}</b> {t.porUnidade}</div>}
    </div>
  );
}

/** Linha do catálogo em lista: mais produtos por tela, como um catálogo impresso. */
function LinhaCatalogo({ p, moeda, cliente, t, vendeUnidade }: { p: Produto; moeda: Moeda; cliente: boolean; t: Textos; vendeUnidade: boolean }) {
  if (p.variantes) return <CartaoGrupo p={p} moeda={moeda} cliente={cliente} t={t} vendeUnidade={vendeUnidade} linha />;
  const cor = corRotulo(p.nome, p.linha);
  const pr = p.p;
  const promo = pr?.desconto_pct ?? p.x?.promo_pct;
  return (
    <article className="linha-cat">
      <div className="linha-img" style={{ background: cor.fundo, color: cor.tinta }}>
        {p.foto ? <img src={p.foto} alt="" loading="lazy" /> : <span>{(p.marcaNome ?? t.linhas[p.linha] ?? "").slice(0, 2)}</span>}
      </div>
      <div className="linha-info">
        <h3>{p.nome}</h3>
        <div className="linha-meta">
          {[p.marcaNome, t.linhas[p.linha], p.unidades_caixa ? t.caixaCom(p.unidades_caixa) : null].filter(Boolean).join(" · ")}
          {promo && <span className="etiqueta-mini promo">−{Number(promo)}%</span>}
          {p.novidade && !promo && <span className="etiqueta-mini">{t.novo}</span>}
          {esgotado(p, cliente) && <span className="etiqueta-mini esgotado">{t.esgotado}</span>}
        </div>
      </div>
      <div className="linha-preco"><Precos p={p} moeda={moeda} cliente={cliente} t={t} /></div>
      <div className="linha-qtd"><Comprar p={p} item={itemCarrinho(p, esgotado(p, cliente))} vendeUnidade={vendeUnidade} t={t} rotulo={esgotado(p, cliente) ? t.pedirEncomenda : t.adicionar} />
        {esgotado(p, cliente) && <QueroProduto produtoId={p.produto_id} cliente={cliente} t={t.quero} />}</div>
    </article>
  );
}

/** "Promoção termina em 3 dias": deixa claro que o desconto acaba. */
function PrazoPromo({ fim, es }: { fim: string; es: boolean }) {
  const hoje = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" }) + "T00:00:00");
  const dias = Math.round((new Date(String(fim).slice(0, 10) + "T00:00:00").getTime() - hoje.getTime()) / 86400000);
  if (dias < 0 || dias > 30) return null;
  const txt = dias === 0 ? (es ? "¡La promoción termina hoy!" : "A promoção termina hoje!")
    : dias === 1 ? (es ? "La promoción termina mañana" : "A promoção termina amanhã")
    : (es ? `La promoción termina en ${dias} días` : `A promoção termina em ${dias} dias`);
  return <span className="promo-prazo">{txt}</span>;
}
