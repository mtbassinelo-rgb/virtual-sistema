import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dinheiro, type Moeda } from "@/lib/formato";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { BotaoImprimir } from "./imprimir";

export const metadata = { title: "Catálogo para enviar" };

const TABELAS: Record<string, { nome: string; moeda: Moeda }> = {
  py_normal: { nome: "Paraguai · Normal (Gs)", moeda: "GS" }, py_vip: { nome: "Paraguai · VIP (Gs)", moeda: "GS" },
  br_normal: { nome: "Brasil · Normal / Gold (R$)", moeda: "BRL" }, br_vip: { nome: "Brasil · VIP / Platinum (R$)", moeda: "BRL" },
};

export default async function Catalogo({ searchParams }: { searchParams: Promise<{ marca?: string | string[]; tabela?: string; estoque?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const { atual } = await unidadeSistema(u);
  const marcasSel = (Array.isArray(f.marca) ? f.marca : f.marca ? [f.marca] : []).filter(Boolean);
  const tabela = f.tabela && (f.tabela === "sem" || TABELAS[f.tabela]) ? f.tabela : "py_normal";
  const soEstoque = f.estoque !== "todos";
  const d = await comUsuario(u.id, async (c) => {
    const marcas = (await c.query("select marca, count(*)::int n from app.produtos where ativo and marca is not null group by 1 order by 1")).rows as { marca: string; n: number }[];
    if (!marcasSel.length) return { marcas, itens: [] };
    const itens = (await c.query(`
      select p.id, p.nome, p.marca, p.foto, p.unidades_caixa, p.grupo, p.variante, p.tipo,
             ${tabela === "sem" ? "null::numeric" : `(select valor from app.precos z where z.produto_id = p.id and z.tabela = $3 and z.vigente_desde <= current_date order by vigente_desde desc limit 1)`} as preco,
             coalesce((select sum(s.quantidade) from app.estoque_saldos s join app.depositos dp on dp.id = s.deposito_id and dp.ativo
                        where s.produto_id = p.id ${atual ? "and dp.id = $2" : "and $2::uuid is null"}), 0) as saldo
        from app.produtos p
       where p.ativo and p.mostrar_no_site and p.marca = any($1::text[])
       order by p.marca, coalesce(p.grupo, p.nome), p.variante nulls first, p.nome`,
      tabela === "sem" ? [marcasSel, atual?.id ?? null] : [marcasSel, atual?.id ?? null, tabela])).rows;
    return { marcas, itens: itens.filter((i) => !soEstoque || i.tipo === "kit" || Number(i.saldo) > 0) };
  });
  const moeda = tabela === "sem" ? "GS" : TABELAS[tabela].moeda;
  const porMarca = new Map<string, typeof d.itens>();
  for (const i of d.itens) porMarca.set(i.marca, [...(porMarca.get(i.marca) ?? []), i]);

  return (
    <>
      <section className="cabecalho-pagina nao-imprimir">
        <div>
          <h1>Catálogo para enviar</h1>
          <p>Escolha as marcas e a tabela de preço. Depois clique em <b>Imprimir / salvar em PDF</b> e mande o PDF no WhatsApp do cliente. O catálogo sai sempre com os preços e fotos de hoje{atual ? `, e só com o que tem em estoque em ${atual.nome}` : ""}.</p>
        </div>
      </section>
      <form className="painel nao-imprimir" method="get">
        <div className="marcas-catalogo">
          {d.marcas.map((m) => (
            <label key={m.marca} className="linha" style={{ flexDirection: "row", gap: 6, color: "inherit" }}>
              <input type="checkbox" name="marca" value={m.marca} defaultChecked={marcasSel.includes(m.marca)} /> {m.marca} <span className="suave pequeno">({m.n})</span>
            </label>
          ))}
        </div>
        <div className="linha">
          <label>Preço
            <select name="tabela" defaultValue={tabela}>
              {Object.entries(TABELAS).map(([k, v]) => <option key={k} value={k}>{v.nome}</option>)}
              <option value="sem">Sem preço</option>
            </select>
          </label>
          <label>Produtos
            <select name="estoque" defaultValue={soEstoque ? "" : "todos"}><option value="">Só com estoque</option><option value="todos">Todos</option></select>
          </label>
          <button className="principal">Montar catálogo</button>
          {d.itens.length > 0 && <BotaoImprimir />}
        </div>
      </form>
      {marcasSel.length === 0 && <div className="painel vazio nao-imprimir">Marque pelo menos uma marca.</div>}
      {d.itens.length > 0 && (
        <div className="catalogo-impresso">
          <header className="cat-capa">
            <img src="/marca/logo.png" alt="Virtual Cosméticos" width={160} height={92} />
            <div><b>Catálogo {marcasSel.length === 1 ? marcasSel[0] : ""}</b><span>{tabela === "sem" ? "" : TABELAS[tabela].nome} · {new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span></div>
          </header>
          {[...porMarca.entries()].map(([marca, itens]) => (
            <section key={marca} className="cat-marca">
              <h2>{marca}</h2>
              <div className="cat-grade">{itens.map((i) => {
                const un = i.preco != null ? Number(i.preco) : null, cx = i.unidades_caixa ? Number(i.unidades_caixa) : null;
                return (
                  <article key={i.id} className="cat-item">
                    {i.foto ? <img src={i.foto} alt="" /> : <div className="cat-semfoto">{marca}</div>}
                    <div className="cat-nome">{i.nome}</div>
                    {cx && <div className="cat-cx">Caixa com {cx} un.</div>}
                    {un != null && <div className="cat-preco">{cx ? <>{dinheiro(un * cx, moeda)} <small>a caixa</small><br /><small>{dinheiro(un, moeda)} a unidade</small></> : <>{dinheiro(un, moeda)} <small>a unidade</small></>}</div>}
                  </article>
                );
              })}</div>
            </section>
          ))}
          <footer className="cat-rodape">Pedidos: distribuidoravirtualcosmeticos.com/loja · Preços sujeitos a alteração e ao estoque do dia.</footer>
        </div>
      )}
    </>
  );
}

