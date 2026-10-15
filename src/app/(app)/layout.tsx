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
          <Link href="/" className="marca">
            Virtual Cosméticos<small>Sistema comercial</small>
          </Link>
          <nav className="menu" aria-label="Seções">
            <Link href="/">Hoje</Link>
            <Link href="/pedidos">Pedidos</Link>
            <Link href="/clientes">Clientes</Link>
            <Link href="/metas">Metas</Link>
            <Link href="/estoque">Estoque</Link>
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
