import { redirect } from "next/navigation";
import { entrar, usuarioAtual } from "@/lib/auth";

export const metadata = { title: "Entrar" };

async function acaoEntrar(fd: FormData) {
  "use server";
  const erro = await entrar(String(fd.get("email") ?? ""), String(fd.get("senha") ?? ""));
  if (erro) redirect(`/login?erro=${encodeURIComponent(erro)}`);
  redirect("/");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  if (await usuarioAtual()) redirect("/");
  const { erro, ok } = await searchParams;
  return (
    <div className="entrada">
      <div className="painel">
        <img src="/marca/logo.png" width={202} height={116} alt="Virtual Cosméticos" style={{ alignSelf: "center", margin: "-8px 0 -12px" }} />
        <div>
          <h1 className="sr-only">Virtual Cosméticos</h1>
          <div className="suave pequeno">Sistema comercial · acesso da equipe</div>
        </div>
        {erro && <div className="aviso-caixa erro">{erro}</div>}
        {ok && <div className="aviso-caixa ok">{ok}</div>}
        <form action={acaoEntrar} className="campos" style={{ gridTemplateColumns: "1fr" }}>
          <label>
            E-mail
            <input id="email" name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Senha
            <input id="senha" name="senha" type="password" autoComplete="current-password" required />
          </label>
          <button className="principal" type="submit">Entrar</button>
        </form>
      </div>
    </div>
  );
}
