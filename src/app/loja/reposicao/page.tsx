import Link from "next/link";
import { exigirCliente } from "@/lib/portal";
import { idiomaAtual, TEXTOS } from "@/lib/idioma";
import { dinheiro } from "@/lib/formato";
import { itensReposicao } from "../acoes";
import { AdicionarTodos, Quantidade } from "../carrinho";

export const metadata = { title: "Meus produtos de sempre" };

export default async function Reposicao() {
  const { cliente } = await exigirCliente();
  const idioma = await idiomaAtual();
  const t = TEXTOS[idioma];
  const es = idioma === "es";
  const itens = await itensReposicao();
  return (
    <div className="in pagina">
      <h1>{t.reposicao}</h1>
      <p>{es ? "Lo que usted compra con frecuencia, con la cantidad de costumbre. Ajuste y agregue todo al pedido de una vez."
              : "O que você costuma comprar, com a quantidade de costume. Ajuste e coloque tudo no pedido de uma vez."}</p>
      {itens.length === 0 ? (
        <div className="painel vazio">{es ? "Todavía no hay compras para armar su lista." : "Ainda não há compras para montar a sua lista."} <Link href="/loja#catalogo">{t.verProdutos("")}</Link></div>
      ) : (
        <>
          <AdicionarTodos itens={itens.map((i) => ({ id: i.id, nome: i.nome, marca: i.marca, marcaDb: i.marca, preco: i.preco, caixa: i.caixa, qtd: i.qtd }))}
                          rotulo={es ? "Agregar todo al pedido" : "Colocar tudo no pedido"} />
          <ul className="reposicao">{itens.map((i) => (
            <li key={i.id}>
              <div>
                <b>{i.nome}</b>
                <div className="pequeno">{es ? "De costumbre" : "De costume"}: {i.qtd} {i.caixa ? (es ? "caja(s)" : "caixa(s)") : "un."}
                  {i.preco != null && <> · {dinheiro(i.preco * (i.caixa || 1), cliente.moeda)}{i.caixa ? (es ? " la caja" : " a caixa") : ""}</>}</div>
              </div>
              <Quantidade item={{ id: i.id, nome: i.nome, marca: i.marca, marcaDb: i.marca, preco: i.preco, caixa: i.caixa }} rotulo={t.adicionar} />
            </li>
          ))}</ul>
        </>
      )}
    </div>
  );
}
