import Link from "next/link";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { CampoFoto } from "../[id]/campo-foto";

export const metadata = { title: "Buscar fotos" };

// Itens que não aparecem na loja como produto (etiqueta, caixa, expositor…)
const NAO_VENDA = "^(BOX |EXPOSITOR)|ETIQUETA|CAIXA DE PAPEL|CARRETINHA";

type Linha = { id: string; codigo: string; nome: string; marca: string | null; saldo: number };

function termoBusca(p: Linha): string {
  const nome = p.nome.replace(/\s*-\s*Lote:.*$/i, "").replace(/\|.*$/, "").trim();
  return [nome, p.marca && !nome.toUpperCase().includes(p.marca.toUpperCase()) ? p.marca : ""].filter(Boolean).join(" ");
}

export default async function FotosFaltando({ searchParams }: { searchParams: Promise<{ marca?: string; estoque?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) redirect("/produtos");
  const f = await searchParams;
  const comEstoque = f.estoque !== "todos";
  const lista = await comUsuario(u.id, async (c) => (await c.query(`
    select p.id, p.codigo, p.nome, p.marca, coalesce((select sum(e.saldo) from app.v_estoque e where e.produto_id = p.id), 0)::int as saldo
      from app.produtos p
     where p.ativo and p.mostrar_no_site and p.foto is null and p.nome !~* $1
       and ($2::text is null or coalesce(p.marca, '') = $2)
     order by 5 desc, p.marca nulls last, p.nome`, [NAO_VENDA, f.marca || null])).rows as Linha[]);
  const mostrar = comEstoque ? lista.filter((p) => p.saldo > 0) : lista;
  const marcas = [...new Set(lista.map((p) => p.marca ?? ""))].sort();

  return (
    <>
      <section className="linha entre">
        <div>
          <h1>Buscar fotos</h1>
          <div className="suave pequeno">{mostrar.length} produto(s) ativo(s) sem foto{comEstoque ? " e com estoque" : ""}, os de maior estoque primeiro.</div>
        </div>
        <Link className="botao" href="/produtos?filtro=sem-foto">Ver na lista de produtos</Link>
      </section>
      <div className="painel aviso-caixa">
        <b>Como usar:</b> clique em <b>Procurar no Google</b> (abre em outra aba), escolha a foto que você aprova e
        <b> arraste a imagem</b> para o quadro do produto. Também dá para copiar a imagem e colar (Ctrl+V) no quadro, ou colar o link
        da foto ou da página do produto. A foto entra na loja na hora; se não gostar, é só arrastar outra por cima.
      </div>
      <form className="painel linha" method="get">
        <label style={{ minWidth: 200 }}>Marca
          <select name="marca" defaultValue={f.marca ?? ""}>
            <option value="">Todas</option>
            {marcas.map((m) => <option key={m} value={m}>{m || "(sem marca)"}</option>)}
          </select>
        </label>
        <label>Mostrar
          <select name="estoque" defaultValue={comEstoque ? "" : "todos"}>
            <option value="">Só com estoque</option>
            <option value="todos">Todos</option>
          </select>
        </label>
        <button>Filtrar</button>
      </form>
      {mostrar.length === 0 && <div className="painel vazio">Nenhum produto sem foto aqui. 🎉</div>}
      <div className="grade-fotos">
        {mostrar.map((p) => {
          const q = termoBusca(p);
          return (
            <section key={p.id} className="painel cartao-foto">
              <div className="pequeno suave">{p.marca || "Sem marca"} · {p.codigo} · estoque {p.saldo.toLocaleString("pt-BR")}</div>
              <Link href={`/produtos/${p.id}`}><b>{p.nome}</b></Link>
              <a className="botao" href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`} target="_blank" rel="noopener noreferrer">Procurar no Google ↗</a>
              <CampoFoto produtoId={p.id} fotoAtual={null} nome={p.nome} compacto />
            </section>
          );
        })}
      </div>
    </>
  );
}
