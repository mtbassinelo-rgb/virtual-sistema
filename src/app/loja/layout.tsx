import Link from "next/link";
import { clienteAtual } from "@/lib/portal";
import "./loja.css";

export const metadata = { title: { default: "Pedidos", template: "%s · Virtual Cosméticos" } };

export default async function LayoutLoja({ children }: { children: React.ReactNode }) {
  const c = await clienteAtual();
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
      {c && (
        <footer className="loja-in loja-rodape">
          Atendimento: {c.vendedora}{c.vendedora_whatsapp ? ` · WhatsApp ${c.vendedora_whatsapp}` : ""} ·{" "}
          <Link href="/loja/sair">Sair</Link>
        </footer>
      )}
    </div>
  );
}
