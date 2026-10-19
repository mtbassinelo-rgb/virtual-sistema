import Link from "next/link";
import { hash } from "@node-rs/argon2";
import { redirect } from "next/navigation";
import { pool, mensagemErro } from "@/lib/db";
import { idiomaAtual } from "@/lib/idioma";
import { abrirSessaoCliente, sha256 } from "@/lib/portal";

export const metadata = { title: "Nova senha" };

const T = {
  pt: { titulo: "Crie uma senha nova", nova: "Nova senha (mínimo 6 caracteres)", repetir: "Repita a nova senha", salvar: "Salvar e entrar",
        curta: "A senha precisa ter pelo menos 6 caracteres.", diferente: "As duas senhas não são iguais.", fraca: "Escolha uma senha mais difícil (não use 123456 nem números repetidos).",
        vencido: "Este link já foi usado ou venceu.", pedir: "Pedir um link novo" },
  es: { titulo: "Cree una contraseña nueva", nova: "Nueva contraseña (mínimo 6 caracteres)", repetir: "Repita la nueva contraseña", salvar: "Guardar e ingresar",
        curta: "La contraseña debe tener al menos 6 caracteres.", diferente: "Las dos contraseñas no son iguales.", fraca: "Elija una contraseña más difícil (no use 123456 ni números repetidos).",
        vencido: "Este enlace ya fue usado o venció.", pedir: "Pedir un enlace nuevo" },
};

async function salvar(fd: FormData) {
  "use server";
  const t = T[await idiomaAtual()];
  const token = String(fd.get("token") ?? "");
  const nova = String(fd.get("nova") ?? ""), repetir = String(fd.get("repetir") ?? "");
  let id: string | null = null, erro: string | null = null;
  try {
    if (nova.length < 6) throw new Error(t.curta);
    if (nova !== repetir) throw new Error(t.diferente);
    if (/^(\d)\1+$/.test(nova) || nova === "123456" || nova === "654321") throw new Error(t.fraca);
    const senhaHash = await hash(nova, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    id = (await pool.query("select app.portal_redefinir_senha($1, $2) as id", [sha256(token), senhaHash])).rows[0].id;
  } catch (e) {
    erro = mensagemErro(e);
  }
  if (!id) redirect(`/loja/redefinir/${encodeURIComponent(token)}?erro=${encodeURIComponent(erro ?? "")}`);
  await abrirSessaoCliente(id);
  redirect("/loja");
}

export default async function Redefinir({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ erro?: string }> }) {
  const { token } = await params;
  const { erro } = await searchParams;
  const t = T[await idiomaAtual()];
  const valido = /^[A-Za-z0-9_-]{20,100}$/.test(token) && Boolean((await pool.query("select app.portal_redefinicao_valida($1) as v", [sha256(token)])).rows[0]?.v);
  return (
    <div className="in pagina">
      <section className="painel acesso-cliente">
        <h1>{t.titulo}</h1>
        {!valido ? (
          <><div className="aviso-erro" role="alert">{t.vencido}</div><p style={{ margin: 0 }}><Link href="/loja/esqueci">{t.pedir}</Link></p></>
        ) : (
          <>
            {erro && <div className="aviso-erro" role="alert">{erro}</div>}
            <form action={salvar} className="acesso-form">
              <input type="hidden" name="token" value={token} />
              <label>{t.nova}<input name="nova" type="password" required minLength={6} autoComplete="new-password" maxLength={100} /></label>
              <label>{t.repetir}<input name="repetir" type="password" required minLength={6} autoComplete="new-password" maxLength={100} /></label>
              <button className="adicionar">{t.salvar}</button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
