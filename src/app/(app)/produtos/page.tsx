import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { Avisos } from "../avisos";
import { produtosEmLote, salvarGradeProdutos } from "./acoes";
import { BarraLote } from "./lote";
import { TabelaProdutos, type LinhaProduto } from "./tabela";
import { unidadeSistema } from "@/lib/unidade-sistema";

export const metadata = { title: "Produtos" };

const TAMANHOS = [50, 100, 200, 500];

const MOSTRAR: [string, string][] = [
  ["", "Ativos"], ["abaixo-minimo", "Abaixo do estoque mínimo"], ["sem-estoque", "Sem estoque"], ["com-estoque", "Com estoque"],
  ["sem-minimo", "Sem estoque mínimo"], ["sem-preco", "Sem preço"], ["sem-preco-gs", "Sem preço em Gs"], ["sem-preco-br", "Sem preço em R$"],
  ["em-promocao", "Em promoção"], ["sem-foto", "Sem foto"], ["sem-caixa", "Sem peças por caixa"], ["inativos", "Inativos"], ["todos", "Todos"],
];
const ORDEM: Record<string, [string, string]> = {
  "": ["Nome (A-Z)", "p.nome"],
  "estoque-menor": ["Menor estoque", "s.saldo, p.nome"],
  "estoque-maior": ["Maior estoque", "s.saldo desc, p.nome"],
  "falta-comprar": ["Mais abaixo do mínimo", "(coalesce(p.estoque_minimo, 0) - s.saldo) desc, p.nome"],
  marca: ["Marca", "p.marca nulls last, p.nome"],
  codigo: ["Código", "p.codigo"],
  "preco-maior": ["Maior preço (PY Normal)", "x.py_normal desc nulls last, p.nome"],
};

type Filtros = { por?: string; q?: string; filtro?: string; marca?: string; tipo?: string; ordem?: string; pagina?: string; ok?: string; erro?: string };

export default async function Produtos({ searchParams }: { searchParams: Promise<Filtros> }) {
  const u = await exigirUsuario();
  const gestao = ehGestao(u);
  const f = await searchParams;
  const { atual: unidade } = await unidadeSistema(u);
  const pagina = Math.max(1, Number(f.pagina) || 1);
  const POR_PAGINA = TAMANHOS.includes(Number(f.por)) ? Number(f.por) : 100;
  const par: unknown[] = [];
  const cond = ["true"];
  if (f.q) { par.push(`%${f.q}%`); cond.push(`(p.nome ilike $${par.length} or p.codigo ilike $${par.length} or p.marca ilike $${par.length} or p.gtin = $${par.length})`); }
  if (f.marca === "-") cond.push("p.marca is null");
  else if (f.marca) { par.push(f.marca); cond.push(`p.marca = $${par.length}`); }
  if (f.tipo === "kit") cond.push("p.tipo = 'kit'");
  if (f.tipo === "simples") cond.push("p.tipo <> 'kit'");
  const filtros: Record<string, string> = {
    "abaixo-minimo": "p.estoque_minimo is not null and p.tipo <> 'kit' and s.saldo <= p.estoque_minimo",
    "sem-estoque": "p.tipo <> 'kit' and s.saldo <= 0",
    "com-estoque": "s.saldo > 0",
    "sem-minimo": "p.estoque_minimo is null and p.tipo <> 'kit'",
    "sem-preco": "x.py_normal is null and x.py_vip is null and x.br_normal is null and x.br_vip is null",
    "sem-preco-gs": "x.py_normal is null",
    "sem-preco-br": "x.br_normal is null",
    "sem-foto": "p.foto is null and p.mostrar_no_site",
    "em-promocao": "exists (select 1 from app.promocoes pr where pr.produto_id = p.id and pr.status = 'aprovada' and current_date between pr.inicio and pr.fim)",
    "sem-caixa": "p.unidades_caixa is null",
  };
  if (f.filtro && filtros[f.filtro]) cond.push(filtros[f.filtro]);
  if (f.filtro === "inativos") cond.push("not p.ativo"); else if (f.filtro !== "todos") cond.push("p.ativo");
  const ordem = ORDEM[f.ordem ?? ""] ?? ORDEM[""];

  const precos = ["py_normal", "py_vip", "br_normal", "br_vip"].map((t) =>
    `(select valor from app.precos z where z.produto_id = p.id and z.tabela = '${t}' and z.vigente_desde <= current_date order by vigente_desde desc limit 1) as ${t}`).join(", ");
  const promo = (pais: string, tabela: string, moeda: string) =>
    `(select app.arredondar_preco(x.${tabela} * (1 - pr.desconto_pct / 100), '${moeda}') from app.promocoes pr
       where pr.produto_id = p.id and pr.pais = '${pais}' and pr.status = 'aprovada' and current_date between pr.inicio and pr.fim
       order by pr.criada_em desc limit 1)`;
  const d = await comUsuario(u.id, async (c) => {
    const base = `from app.produtos p
      cross join lateral (select ${precos}) x
      cross join lateral (select coalesce(sum(es.quantidade), 0) as saldo from app.estoque_saldos es
                            join app.depositos dp on dp.id = es.deposito_id and dp.ativo
                           where es.produto_id = p.id ${unidade ? `and dp.id = '${unidade.id}'` : ""}) s
      where ${cond.join(" and ")}`;
    const total = Number((await c.query(`select count(*) n ${base}`, par)).rows[0].n);
    const lista = (await c.query(`select p.id, p.codigo, p.nome, p.marca, p.foto, p.tipo, p.ativo, p.codigo_provisorio, p.unidades_caixa,
        p.estoque_minimo, s.saldo, x.*, ${promo("PY", "py_normal", "GS")} as promo_py, ${promo("BR", "br_normal", "BRL")} as promo_br,
        (select max(pr.fim) from app.promocoes pr where pr.produto_id = p.id and pr.status = 'aprovada' and current_date between pr.inicio and pr.fim)::text as promo_fim
        ${base} order by ${ordem[1]} limit ${POR_PAGINA} offset ${(pagina - 1) * POR_PAGINA}`, par)).rows as LinhaProduto[];
    const marcas = (await c.query("select marca, count(*)::int n from app.produtos where ativo and marca is not null group by marca order by marca")).rows as { marca: string; n: number }[];
    const abaixo = Number((await c.query("select count(*) n from app.v_abaixo_minimo")).rows[0].n);
    const fotosPendentes = gestao ? Number((await c.query("select count(*) n from app.fotos_catalogo where status = 'pendente'")).rows[0].n) : 0;
    return { total, lista, marcas, abaixo, fotosPendentes };
  });
  const paginas = Math.max(1, Math.ceil(d.total / POR_PAGINA));
  const url = (mud: Record<string, string | number | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: f.q, filtro: f.filtro, marca: f.marca, tipo: f.tipo, ordem: f.ordem, por: f.por, ...mud })) if (v) s.set(k, String(v));
    return `/produtos?${s}`;
  };
  const volta = url({ pagina: pagina > 1 ? pagina : undefined }).replace(/\?$/, "");
  const temFiltro = Boolean(f.q || f.filtro || f.marca || f.tipo || f.ordem);

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Produtos</h1>
          <p>{unidade ? <b>Estoque de {unidade.nome}. </b> : null}{d.total.toLocaleString("pt-BR")} produto(s){gestao ? ". Mude preço, preço promocional, caixa ou estoque mínimo direto na tabela e salve (dá para desfazer); marque vários para ativar, inativar ou excluir de uma vez." : "."}</p>
        </div>
        {gestao && (
          <div className="linha">
            <Link className="botao" href="/produtos/fotos-faltando">Buscar fotos</Link>
            <Link className="botao" href="/produtos/fotos">Fotos do catálogo{d.fotosPendentes > 0 ? ` (${d.fotosPendentes})` : ""}</Link>
            <Link className="botao principal" href="/produtos/novo">Novo produto</Link>
          </div>
        )}
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      {d.abaixo > 0 && f.filtro !== "abaixo-minimo" && (
        <div className="aviso-caixa linha entre">
          <span><b>{d.abaixo} produto(s)</b> no estoque mínimo ou abaixo: hora de comprar.</span>
          <span className="linha">
            <Link className="botao" href="/produtos?filtro=abaixo-minimo&ordem=falta-comprar">Ver aqui</Link>
            <Link className="botao" href="/relatorios?aba=estoque">Relatório para compra</Link>
          </span>
        </div>
      )}

      <form className="painel filtros" method="get">
        <label className="filtro-busca">Buscar<input name="q" defaultValue={f.q} placeholder="Nome, código, marca ou código de barras" /></label>
        <label>Mostrar
          <select name="filtro" defaultValue={f.filtro ?? ""}>
            {MOSTRAR.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
        <label>Marca
          <select name="marca" defaultValue={f.marca ?? ""}>
            <option value="">Todas</option>
            {d.marcas.map((m) => <option key={m.marca} value={m.marca}>{m.marca} ({m.n})</option>)}
            <option value="-">Sem marca</option>
          </select>
        </label>
        <label>Tipo
          <select name="tipo" defaultValue={f.tipo ?? ""}>
            <option value="">Todos</option><option value="simples">Unidade</option><option value="kit">Kit</option>
          </select>
        </label>
        <label>Ordenar por
          <select name="ordem" defaultValue={f.ordem ?? ""}>
            {Object.entries(ORDEM).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
        <label>Mostrar por página
          <select name="por" defaultValue={String(POR_PAGINA)}>
            {TAMANHOS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="filtro-botoes">
          <button className="principal">Filtrar</button>
          {temFiltro && <Link className="botao" href="/produtos">Limpar</Link>}
        </div>
      </form>

      {gestao && (
        <>
          <form id="lote" action={produtosEmLote} hidden><input type="hidden" name="volta" value={volta} /></form>
          <BarraLote form="lote" />
        </>
      )}
      {d.lista.length === 0
        ? <div className="painel vazio">Nenhum produto com esse filtro.</div>
        : <TabelaProdutos linhas={d.lista} gestao={gestao} acao={salvarGradeProdutos} />}
      {paginas > 1 && (
        <div className="linha" style={{ justifyContent: "center" }}>
          {pagina > 1 && <a className="botao" href={url({ pagina: pagina - 1 })}>Anterior</a>}
          <span className="suave">Página {pagina} de {paginas}</span>
          {pagina < paginas && <a className="botao" href={url({ pagina: pagina + 1 })}>Próxima</a>}
        </div>
      )}
    </>
  );
}
