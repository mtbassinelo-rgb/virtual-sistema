import Link from "next/link";
import { clienteAtual } from "@/lib/portal";
import { pool } from "@/lib/db";
import { linkWhatsApp, telefone } from "@/lib/formato";
import { BotaoCarrinho, Carrinho } from "./carrinho";
import "./loja.css";

export const metadata = {
  title: { default: "Virtual Cosméticos · Atacado de cosméticos", template: "%s · Virtual Cosméticos" },
  description: "Atacado de cosméticos para salões e revendas no Brasil e no Paraguai. Matizadores, kits capilares, corpo e banho, maquiagem e unhas.",
  robots: { index: true, follow: true },
};

export default async function LayoutLoja({ children }: { children: React.ReactNode }) {
  const c = await clienteAtual();
  const contatos = (await pool.query("select app.whatsapp_empresa('BRL') as br, app.whatsapp_empresa('GS') as py")).rows[0] ?? {};
  const zapBr = linkWhatsApp(contatos.br, "Olá! Quero comprar no atacado da Virtual Cosméticos.");
  const zapPy = linkWhatsApp(contatos.py, "¡Hola! Quiero comprar al por mayor en Virtual Cosméticos.");

  return (
    <div className="loja">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" precedence="default"
            href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=Figtree:wght@400;500;600;700&display=swap" />
      <Carrinho cliente={c ? { nome: c.nome, vendedora: c.vendedora, moeda: c.moeda } : null}>
        <header className="topo">
          <div className="in topo-in">
            <Link href="/loja" className="marca" aria-label="Virtual Cosméticos, início">
              <img src="/marca/icone.png" width={42} height={40} alt="" />
              <span className="marca-txt"><b>Virtual</b>Cosméticos</span>
            </Link>
            <form action="/loja" className="busca" role="search">
              <input name="q" type="search" placeholder="Buscar shampoo, matizador, kit…" aria-label="Buscar produtos" />
            </form>
            <nav className="nav" aria-label="Navegação">
              {c ? <Link href="/loja/pedidos">Meus pedidos</Link> : <Link href="/loja/acesso">Já sou cliente</Link>}
              <BotaoCarrinho />
            </nav>
          </div>
        </header>

        <main className="principal">{children}</main>

        <footer className="rodape">
          <div className="in rodape-in">
            <div>
              <img className="rodape-logo" src="/marca/logo.png" width={202} height={116} alt="Virtual Cosméticos" />
              <p>Distribuidora de cosméticos no atacado. Centro de distribuição em Foz do Iguaçu e loja em Ciudad del Este.</p>
            </div>
            <div>
              <h3>Brasil</h3>
              {zapBr && <a href={zapBr} target="_blank" rel="noopener noreferrer">WhatsApp {telefone(contatos.br)}</a>}
              <p>Pedidos em reais, envio a partir de Foz do Iguaçu.</p>
            </div>
            <div>
              <h3>Paraguay</h3>
              {zapPy && <a href={zapPy} target="_blank" rel="noopener noreferrer">WhatsApp {telefone(contatos.py)}</a>}
              <p>Pedidos en guaraníes, retiro o entrega en Ciudad del Este.</p>
            </div>
            <div>
              <h3>{c ? c.nome : "Clientes"}</h3>
              {c ? (
                <>
                  <p>Atendimento: {c.vendedora}</p>
                  <Link href="/loja/sair">Sair da área do cliente</Link>
                </>
              ) : (
                <p>Clientes cadastrados recebem da vendedora um link de acesso com os preços de atacado.</p>
              )}
            </div>
          </div>
        </footer>
      </Carrinho>
    </div>
  );
}
