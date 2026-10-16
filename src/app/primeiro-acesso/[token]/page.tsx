import { hash } from "@node-rs/argon2";
import { redirect } from "next/navigation";
import { pool, mensagemErro } from "@/lib/db";
import { sha256 } from "@/lib/portal";

export const metadata = { title: "Criar senha" };
export const dynamic = "force-dynamic";

async function criarSenha(fd: FormData) {
  "use server";
  const token = String(fd.get("token") ?? "");
  const senha = String(fd.get("senha") ?? "");
  const repetir = String(fd.get("repetir") ?? "");
  const voltar = (erro: string): never => redirect(`/primeiro-acesso/${encodeURIComponent(token)}?erro=${encodeURIComponent(erro)}`);
  if (senha.length < 10) voltar("Use pelo menos 10 caracteres.");
  if (senha !== repetir) voltar("As duas senhas não são iguais.");
  let email: string;
  try {
    const senhaHash = await hash(senha, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const r = await pool.query("select app.usar_convite_usuario($1, $2) as email", [sha256(token), senhaHash]);
    email = String(r.rows[0].email);
  } catch (e) {
    return voltar(mensagemErro(e));
  }
  redirect(`/login?ok=${encodeURIComponent("Senha criada. Entre com " + email + ".")}`);
}

export default async function PrimeiroAcesso({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ erro?: string }>;
}) {
  const { token } = await params;
  const { erro } = await searchParams;
  const { rows } = await pool.query("select nome, email from app.convite_usuario($1)", [sha256(token)]);
  const u = rows[0] as { nome: string; email: string } | undefined;
  return (
    <div className="entrada">
      <div className="painel">
        <img src="/marca/logo.png" width={202} height={116} alt="Virtual Cosméticos" style={{ alignSelf: "center", margin: "-8px 0 -12px" }} />
        <div>
          <h1 className="sr-only">Virtual Cosméticos</h1>
          <div className="suave pequeno">Primeiro acesso da equipe</div>
        </div>
        {!u ? (
          <div className="aviso-caixa erro">Este link já foi usado ou expirou. Peça um novo ao responsável pelo sistema.</div>
        ) : (
          <>
            <p>Olá, <b>{u.nome}</b>. Crie sua senha para <b>{u.email}</b>. Ninguém mais vai conhecê-la.</p>
            {erro && <div className="aviso-caixa erro" role="alert">{erro}</div>}
            <form action={criarSenha} className="campos" style={{ gridTemplateColumns: "1fr" }}>
              <input type="hidden" name="token" value={token} />
              <input type="email" name="email" value={u.email} autoComplete="username" readOnly hidden />
              <label>Nova senha (mínimo 10 caracteres)
                <input name="senha" type="password" autoComplete="new-password" minLength={10} required />
              </label>
              <label>Repita a senha
                <input name="repetir" type="password" autoComplete="new-password" minLength={10} required />
              </label>
              <button className="principal" type="submit">Criar senha</button>
            </form>
            <p className="pequeno suave">Dica: uma frase fácil de lembrar, como “cafe-com-leite-na-loja-2026”.</p>
          </>
        )}
      </div>
    </div>
  );
}
