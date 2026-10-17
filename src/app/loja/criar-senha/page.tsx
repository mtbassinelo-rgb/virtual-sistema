import { hash } from "@node-rs/argon2";
import { redirect } from "next/navigation";
import { pool, mensagemErro } from "@/lib/db";
import { idiomaAtual } from "@/lib/idioma";
import { conferirCliente, exigirCliente } from "@/lib/portal";

export const metadata = { title: "Criar senha" };

const T = {
  pt: { titulo: "Crie a sua senha", texto: (n: string) => `Bem-vindo(a), ${n}! Você entrou com a senha provisória enviada pela sua vendedora. Agora crie a sua própria senha para os próximos acessos.`,
        nova: "Nova senha (mínimo 6 caracteres)", repetir: "Repita a nova senha", salvar: "Criar senha e continuar",
        curta: "A senha precisa ter pelo menos 6 caracteres.", diferente: "As duas senhas não são iguais.",
        igual: "Escolha uma senha diferente da provisória.", ok: "Senha criada! Use esta senha nos próximos acessos.",
        dica: "Dica: use algo fácil de lembrar e difícil de adivinhar. Não use a data de nascimento nem 123456." },
  es: { titulo: "Cree su contraseña", texto: (n: string) => `¡Bienvenido(a), ${n}! Ingresó con la contraseña provisoria que le envió su vendedora. Ahora cree su propia contraseña para los próximos ingresos.`,
        nova: "Nueva contraseña (mínimo 6 caracteres)", repetir: "Repita la nueva contraseña", salvar: "Crear contraseña y continuar",
        curta: "La contraseña debe tener al menos 6 caracteres.", diferente: "Las dos contraseñas no son iguales.",
        igual: "Elija una contraseña diferente de la provisoria.", ok: "¡Contraseña creada! Úsela en los próximos ingresos.",
        dica: "Consejo: use algo fácil de recordar y difícil de adivinar. No use su fecha de nacimiento ni 123456." },
};

async function criar(fd: FormData) {
  "use server";
  const idioma = await idiomaAtual();
  const t = T[idioma];
  const { sessao } = await exigirCliente();
  const nova = String(fd.get("nova") ?? ""), repetir = String(fd.get("repetir") ?? "");
  let erro: string | null = null;
  try {
    if (nova.length < 6) throw new Error(t.curta);
    if (nova !== repetir) throw new Error(t.diferente);
    if (/^(\d)\1+$/.test(nova) || nova === "123456" || nova === "654321") throw new Error(t.dica);
    const doc = String((await pool.query("select app.portal_documento($1) as d", [sessao])).rows[0]?.d ?? "");
    if ((await conferirCliente(doc, nova, idioma === "es")).id) throw new Error(t.igual);
    const senhaHash = await hash(nova, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await pool.query("select app.portal_criar_senha($1, $2)", [sessao, senhaHash]);
  } catch (e) {
    erro = mensagemErro(e);
  }
  if (erro) redirect(`/loja/criar-senha?erro=${encodeURIComponent(erro)}`);
  redirect(`/loja/conta?ok=${encodeURIComponent(t.ok)}`);
}

export default async function CriarSenha({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { cliente, sessao } = await exigirCliente();
  const provisoria = Boolean((await pool.query("select app.portal_senha_provisoria($1) as p", [sessao])).rows[0]?.p);
  if (!provisoria) redirect("/loja/conta");
  const { erro } = await searchParams;
  const t = T[await idiomaAtual()];
  return (
    <div className="in pagina">
      <section className="painel acesso-cliente">
        <h1>{t.titulo}</h1>
        <p style={{ margin: 0 }}>{t.texto(cliente.nome)}</p>
        {erro && <div className="aviso-erro" role="alert">{erro}</div>}
        <form action={criar} className="acesso-form">
          <label>{t.nova}<input name="nova" type="password" required minLength={6} maxLength={100} autoComplete="new-password" /></label>
          <label>{t.repetir}<input name="repetir" type="password" required minLength={6} maxLength={100} autoComplete="new-password" /></label>
          <button className="adicionar">{t.salvar}</button>
        </form>
        <p className="suave pequeno" style={{ margin: 0 }}>{t.dica}</p>
      </section>
    </div>
  );
}
