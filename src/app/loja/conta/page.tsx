import { hash } from "@node-rs/argon2";
import { redirect } from "next/navigation";
import { pool, mensagemErro } from "@/lib/db";
import { idiomaAtual } from "@/lib/idioma";
import { conferirCliente, exigirCliente } from "@/lib/portal";

export const metadata = { title: "Minha conta" };

const T = {
  pt: { titulo: "Minha conta", doc: "Seu usuário (documento)", troca: "Trocar senha", atual: "Senha atual", nova: "Nova senha (mínimo 6 caracteres)",
        repetir: "Repita a nova senha", salvar: "Trocar senha", ok: "Senha trocada. Use a nova senha da próxima vez.",
        curta: "A nova senha precisa ter pelo menos 6 caracteres.", diferente: "As duas senhas novas não são iguais.", atualErrada: "A senha atual não confere." },
  es: { titulo: "Mi cuenta", doc: "Su usuario (documento)", troca: "Cambiar contraseña", atual: "Contraseña actual", nova: "Nueva contraseña (mínimo 6 caracteres)",
        repetir: "Repita la nueva contraseña", salvar: "Cambiar contraseña", ok: "Contraseña cambiada. Use la nueva la próxima vez.",
        curta: "La nueva contraseña debe tener al menos 6 caracteres.", diferente: "Las dos contraseñas nuevas no son iguales.", atualErrada: "La contraseña actual no es correcta." },
};

async function trocar(fd: FormData) {
  "use server";
  const idioma = await idiomaAtual();
  const t = T[idioma];
  const { sessao } = await exigirCliente();
  const atual = String(fd.get("atual") ?? ""), nova = String(fd.get("nova") ?? ""), repetir = String(fd.get("repetir") ?? "");
  let q: string;
  try {
    if (nova.length < 6) throw new Error(t.curta);
    if (nova !== repetir) throw new Error(t.diferente);
    const doc = String((await pool.query("select app.portal_documento($1) as d", [sessao])).rows[0]?.d ?? "");
    const r = await conferirCliente(doc, atual, idioma === "es");
    if (!r.id) throw new Error(r.erro?.includes("15") ? r.erro : t.atualErrada);
    const senhaHash = await hash(nova, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await pool.query("select app.portal_trocar_senha($1, $2)", [sessao, senhaHash]);
    q = "ok=" + encodeURIComponent(t.ok);
  } catch (e) {
    q = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  redirect(`/loja/conta?${q}`);
}

export default async function Conta({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { cliente, sessao } = await exigirCliente();
  const f = await searchParams;
  const t = T[await idiomaAtual()];
  const doc = String((await pool.query("select app.portal_documento($1) as d", [sessao])).rows[0]?.d ?? "");
  return (
    <div className="in pagina">
      <h1>{t.titulo}</h1>
      <section className="painel acesso-cliente">
        <p style={{ margin: 0 }}><b>{cliente.nome}</b><br /><span className="suave">{t.doc}: {doc}</span></p>
        {f.ok && <div className="aviso-ok" role="status">{f.ok}</div>}
        {f.erro && <div className="aviso-erro" role="alert">{f.erro}</div>}
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{t.troca}</h2>
        <form action={trocar} className="acesso-form">
          <input name="usuario" value={doc} autoComplete="username" readOnly hidden />
          <label>{t.atual}<input name="atual" type="password" required autoComplete="current-password" /></label>
          <label>{t.nova}<input name="nova" type="password" required minLength={6} autoComplete="new-password" /></label>
          <label>{t.repetir}<input name="repetir" type="password" required minLength={6} autoComplete="new-password" /></label>
          <button className="adicionar">{t.salvar}</button>
        </form>
      </section>
    </div>
  );
}
