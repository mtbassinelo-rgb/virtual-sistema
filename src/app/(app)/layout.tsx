import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario, sair } from "@/lib/auth";
import { PERFIS } from "@/lib/formato";

async function acaoSair() {
  "use server";
  await sair();
  redirect("/login");
}

export default async function AreaInterna({ children }: { children: React.ReactNode }) {
  const u = await exigirUsuario();
  return (
    <>
      <header className="topo">
        <div className="topo-interno">
          <Link href="/" className="marca" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <img src="/marca/icone.png" width={34} height={32} alt="" style={{ borderRadius: 7 }} />
            <span>Virtual Cosméticos<small>Sistema comercial</small></span>
          </Link>
          <nav className="menu" aria-label="Seções">
            <Link href="/">Hoje</Link>
            <Link href="/pedidos">Pedidos</Link>
            <Link href="/clientes">Clientes</Link>
            <Link href="/metas">Metas</Link>
            <Link href="/produtos">Produtos</Link>
            <Link href="/estoque">Estoque</Link>
            <Link href="/promocoes">Promoções</Link>
          </nav>
          <div className="quem">
            <span>
              {u.nome} · {PERFIS[u.perfil]}
            </span>
            <form action={acaoSair}>
              <button type="submit">Sair</button>
            </form>
          </div>
        </div>
      </header>
      <main className="conteudo">{children}</main>
    </>
  );
}
