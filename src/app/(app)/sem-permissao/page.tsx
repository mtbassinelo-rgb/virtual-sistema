import Link from "next/link";
import { PERMISSOES } from "@/lib/permissoes";

export const metadata = { title: "Sem acesso" };

export default async function SemPermissao({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const { area } = await searchParams;
  const nome = PERMISSOES.find((p) => p.chave === area)?.nome;
  return (
    <section className="painel" style={{ maxWidth: 560 }}>
      <h1 style={{ marginTop: 0 }}>Sem acesso a esta área</h1>
      <p>{nome ? <>A área <b>{nome}</b> não está liberada para o seu usuário.</> : "Esta área não está liberada para o seu usuário."} Se precisar, peça ao gerente para liberar em Equipe e acessos.</p>
      <Link href="/" className="botao">Voltar ao início</Link>
    </section>
  );
}
