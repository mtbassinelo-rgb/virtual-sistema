import Link from "next/link";
import { clienteAtual } from "@/lib/portal";
import { pool } from "@/lib/db";
import { linkWhatsApp, telefone } from "@/lib/formato";
import "./loja.css";

export const metadata = { title: { default: "Pedidos", template: "%s · Virtual Cosméticos" } };

export default async function LayoutLoja({ children }: { children: React.ReactNode }) {
  const c = await clienteAtual();
  // Sem login: número principal do site (Brasil). Com login: o número da moeda do cliente.
  const zap = c?.vendedora_whatsapp ?? String((await pool.query("select app.whatsapp_empresa(null) as w")).rows[0]?.w ?? "");
  const linkZap = linkWhatsApp(zap, c ? `Olá! Sou ${c.nome}, cliente da área de atacado.` : "Olá! Quero comprar no atacado da Virtual Cosméticos.");
  return (
    <div className="loja">
      <header className="loja-topo">
        <div className="loja-in">
          <Link href="/loja" className="loja-marca">Virtual Cosméticos<small>Atacado</small></Link>
          {c && (
            <nav className="loja-menu" aria-label="Seções">
              <Link href="/loja">Catálogo</Link>
              <Link href="/loja/pedidos">Meus pedidos</Link>
            </nav>
          )}
        </div>
      </header>
      <main className="loja-in loja-main">{children}</main>
      <footer className="loja-in loja-rodape">
        {c && <>Atendimento: {c.vendedora} · </>}
        {linkZap && <a href={linkZap} target="_blank" rel="noopener noreferrer">WhatsApp {telefone(zap)}</a>}
        {c && <> · <Link href="/loja/sair">Sair</Link></>}
      </footer>
    </div>
  );
}
