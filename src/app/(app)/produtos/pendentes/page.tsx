import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dataHora } from "@/lib/formato";
import { Avisos, Selo } from "../../avisos";
import { aprovarPendente, enviarPendente, recusarPendente } from "./acoes";

export const metadata = { title: "Novos produtos (pendentes)" };

type P = { id: string; deposito: string; deposito_codigo: string; descricao: string; marca: string | null; quantidade: string; preco_normal: string;
  preco_vip: string | null; observacao: string | null; status: string; criado_em: string; quem: string | null; produto_codigo: string | null;
  motivo: string | null; decidido_em: string | null; foto: string | null; sugerido: string | null };

const gs = (v: unknown) => (v == null ? "—" : `Gs ${Math.round(Number(v)).toLocaleString("es-PY")}`);

export default async function Pendentes({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; ver?: string; unidade?: string }> }) {
  const u = await exigirUsuario();
  const gestao = ehGestao(u);
  const f = await searchParams;
  const ver = f.ver === "decididos" ? "decididos" : "pendentes";

  const d = await comUsuario(u.id, async (c) => {
    const unidades = (await c.query(gestao
      ? "select id, nome, false as padrao from app.depositos where ativo order by tipo, nome"
      : `select d.id, d.nome, vd.padrao from app.depositos d join app.vendedora_depositos vd on vd.deposito_id = d.id
          where vd.vendedora_id = app.minha_vendedora() and d.ativo
         union select d.id, d.nome, false from app.depositos d where d.ativo and app.pode_operar_deposito(d.id)
         order by 3 desc, 2`)).rows as { id: string; nome: string; padrao: boolean }[];
    const lista = (await c.query(`
      select p.*, d.nome as deposito, d.codigo as deposito_codigo, us.nome as quem, pr.codigo as produto_codigo,
             (select sp.codigo || ' · ' || sp.nome from app.produtos sp where sp.id = p.produto_sugerido_id) as sugerido
        from app.produtos_pendentes p join app.depositos d on d.id = p.deposito_id
        left join app.usuarios us on us.id = p.criado_por left join app.produtos pr on pr.id = p.produto_id
       where ${ver === "pendentes" ? "p.status = 'pendente'" : "p.status <> 'pendente' and p.decidido_em > now() - interval '60 days'"}
         and ($1::uuid is null or p.deposito_id = $1::uuid)
       order by ${ver === "pendentes" ? "p.criado_em" : "p.decidido_em desc"} limit 200`,
      [/^[0-9a-f-]{36}$/i.test(f.unidade ?? "") ? f.unidade : null])).rows as P[];
    const produtos = (await c.query("select codigo, nome from app.produtos where not marketplace and codigo is not null order by ativo desc, nome")).rows as { codigo: string; nome: string }[];
    const marcas = (await c.query("select distinct marca from app.produtos where ativo and not marketplace and marca is not null order by 1")).rows.map((r) => String(r.marca));
    return { unidades, lista, produtos, marcas };
  });

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/produtos">Produtos</Link> / Novos produtos</div>
          <h1>Novos produtos (pendentes)</h1>
          <p>{gestao
            ? "Produtos que as vendedoras fotografaram na unidade, com quantidade e preço ofertado. Confira e clique em Atualizar: entra no estoque da unidade, com o preço e a foto, e aparece no catálogo."
            : "Tem um produto na loja que não aparece no seu catálogo? Se ele já existe no sistema, escolha na lista; se é novo, tire a foto. Informe a quantidade e o preço ofertado: o gerente autoriza e ele entra no seu catálogo."}</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      <form action={enviarPendente} className="painel campos">
        <h2 className="largo" style={{ margin: 0 }}>Enviar produto</h2>
        <label className="largo">Já existe no sistema? Escolha aqui (se for produto novo, deixe vazio)
          <input name="produto" list="lista-produtos-pend" autoComplete="off" placeholder="Código ou nome do produto" /></label>
        <label className="largo">Foto do produto (obrigatória se for produto novo)<input type="file" name="foto" accept="image/*" capture="environment" /></label>
        <label className="largo">Nome do produto (se for novo)<input name="descricao" maxLength={200} placeholder="Ex.: Shampoo Babalu Uva 500ml Maycrene" /></label>
        <label>Marca<input name="marca" list="lista-marcas" maxLength={80} autoComplete="off" /></label>
        <datalist id="lista-marcas">{d.marcas.map((m) => <option key={m} value={m} />)}</datalist>
        <label>Quantidade (unidades)<input name="quantidade" inputMode="decimal" required /></label>
        <label>Preço ofertado (normal)<input name="preco_normal" inputMode="decimal" required placeholder="Gs por unidade" /></label>
        <label>Preço VIP (se tiver)<input name="preco_vip" inputMode="decimal" placeholder="Gs por unidade" /></label>
        <label>Unidade<select name="deposito_id" required defaultValue={d.unidades[0]?.id}>
          {d.unidades.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
        <label className="largo">Observação<input name="observacao" maxLength={500} placeholder="Ex.: cor 7.1, caixa com 12" /></label>
        <button className="principal">Enviar para o gerente</button>
      </form>

      <nav className="abas" aria-label="Pendentes">
        <Link href="/produtos/pendentes" aria-current={ver === "pendentes" ? "page" : undefined}>Pendentes</Link>
        <Link href="/produtos/pendentes?ver=decididos" aria-current={ver === "decididos" ? "page" : undefined}>Já atualizados / recusados</Link>
      </nav>
      {gestao && d.unidades.length > 1 && (
        <form className="painel filtros" method="get">
          <input type="hidden" name="ver" value={ver} />
          <label>Unidade<select name="unidade" defaultValue={f.unidade ?? ""}><option value="">Todas</option>
            {d.unidades.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
          <button className="principal">Filtrar</button>
        </form>
      )}

      {d.produtos.length > 0 && <datalist id="lista-produtos-pend">{d.produtos.map((p) => <option key={p.codigo} value={`${p.codigo} · ${p.nome}`} />)}</datalist>}

      {d.lista.length === 0 ? <div className="painel vazio">{ver === "pendentes" ? "Nenhum produto esperando." : "Nada decidido nos últimos 60 dias."}</div> : (
        <div className="campos" style={{ gap: 12 }}>
          {d.lista.map((p) => (
            <section key={p.id} className="painel linha" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
              {p.foto ? (
                <a href={`/produtos/pendentes/foto/${p.id}`} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/produtos/pendentes/foto/${p.id}`} alt={p.descricao} style={{ width: 140, height: 140, objectFit: "cover", borderRadius: 8 }} />
                </a>
              ) : <div className="vazio" style={{ width: 140, height: 140, display: "grid", placeItems: "center" }}>sem foto</div>}
              <div style={{ flex: 1, minWidth: 240 }}>
                <b>{p.descricao}</b> {p.marca && <span className="suave">· {p.marca}</span>}
                <div className="pequeno suave">{p.deposito} · enviado por {p.quem ?? "—"} em {dataHora(p.criado_em)}</div>
                <div className="pequeno">{Number(p.quantidade).toLocaleString("pt-BR")} un. · normal {gs(p.preco_normal)}{p.preco_vip && <> · VIP {gs(p.preco_vip)}</>}</div>
                {p.sugerido && <div className="pequeno"><Selo cor="info">vinculado</Selo> {p.sugerido}</div>}
                {p.observacao && <div className="pequeno">Obs.: {p.observacao}</div>}
                {p.status === "aprovado" && <Selo cor="ok">atualizado{p.produto_codigo ? ` · ${p.produto_codigo}` : ""}</Selo>}
                {p.status === "recusado" && <><Selo cor="erro">recusado</Selo>{p.motivo && <span className="pequeno"> {p.motivo}</span>}</>}
                {p.status === "pendente" && !gestao && <Selo cor="aviso">aguardando o gerente</Selo>}

                {p.status === "pendente" && gestao && (
                  <>
                    <form action={aprovarPendente} className="campos" style={{ marginTop: 8 }}>
                      <input type="hidden" name="id" value={p.id} />
                      <label className="largo">Já existe no sistema? (deixe vazio para criar novo)
                        <input name="produto" list="lista-produtos-pend" autoComplete="off" defaultValue={p.sugerido ?? ""} placeholder="Código ou nome do produto existente" /></label>
                      <label className="largo">Nome (se for novo)<input name="descricao" defaultValue={p.descricao} /></label>
                      <label>Marca (se for novo)<input name="marca" list="lista-marcas" defaultValue={p.marca ?? ""} /></label>
                      <label>Quantidade<input name="quantidade" inputMode="decimal" defaultValue={Number(p.quantidade)} required /></label>
                      <label>Preço normal (Gs)<input name="preco_normal" inputMode="decimal" defaultValue={Math.round(Number(p.preco_normal))} required /></label>
                      <label>Preço VIP (Gs)<input name="preco_vip" inputMode="decimal" defaultValue={p.preco_vip ? Math.round(Number(p.preco_vip)) : ""} placeholder="igual ao normal" /></label>
                      <button className="principal">Atualizar</button>
                    </form>
                    <form action={recusarPendente} className="linha" style={{ marginTop: 6 }}>
                      <input type="hidden" name="id" value={p.id} />
                      <input name="motivo" placeholder="Motivo (opcional)" style={{ flex: 1, minWidth: 160 }} />
                      <button className="discreto">Recusar</button>
                    </form>
                    <p className="pequeno suave" style={{ margin: "4px 0 0" }}>
                      Preço vai para a tabela {p.deposito_codigo === "loja-cde" ? "da loja CDE" : "do Paraguai (CD)"}; a quantidade entra no estoque de {p.deposito}.
                    </p>
                  </>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
