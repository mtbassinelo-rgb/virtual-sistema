import { hash } from "@node-rs/argon2";
import { redirect } from "next/navigation";
import { conferirSenha, exigirUsuario, hashSessaoAtual } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { PERFIS } from "@/lib/formato";
import { Avisos } from "../avisos";

export const metadata = { title: "Minha conta" };

async function trocarSenha(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  const atual = String(fd.get("atual") ?? "");
  const nova = String(fd.get("nova") ?? "");
  const repetir = String(fd.get("repetir") ?? "");
  let q: string;
  try {
    if (nova.length < 10) throw new Error("A nova senha precisa ter pelo menos 10 caracteres.");
    if (nova !== repetir) throw new Error("As duas senhas novas não são iguais.");
    if (nova === atual) throw new Error("A nova senha precisa ser diferente da atual.");
    const email = await comUsuario(u.id, async (c) => String((await c.query("select email from app.usuarios where id = $1", [u.id])).rows[0].email));
    const erro = await conferirSenha(email, atual);
    if (erro) throw new Error(erro);
    const senhaHash = await hash(nova, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    // mantém esta sessão aberta e encerra as dos outros aparelhos
    const sessao = await hashSessaoAtual();
    await comUsuario(u.id, (c) => c.query("select app.trocar_minha_senha($1, $2)", [senhaHash, sessao]));
    q = "ok=" + encodeURIComponent("Senha trocada. Os outros aparelhos onde você estava logado precisam entrar de novo.");
  } catch (e) {
    q = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  redirect(`/conta?${q}`);
}

export default async function MinhaConta({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const email = await comUsuario(u.id, async (c) => String((await c.query("select email from app.usuarios where id = $1", [u.id])).rows[0]?.email ?? ""));
  const slug = u.vendedora_id ? await comUsuario(u.id, async (c) => (await c.query("select slug from app.vendedoras where id = $1", [u.vendedora_id])).rows[0]?.slug as string | null) : null;
  return (
    <>
      <section>
        <h1>Minha conta</h1>
        <p className="suave" style={{ margin: 0 }}>{u.nome} · {email} · {PERFIS[u.perfil]}</p>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />
      {slug && (
        <section className="painel">
          <h2 style={{ margin: 0 }}>Seu link de vendas</h2>
          <p style={{ margin: 0 }}><b>distribuidoravirtualcosmeticos.com/loja/v/{slug}</b></p>
          <p className="suave pequeno" style={{ margin: 0 }}>Mande este link nos seus status e conversas. Quem entra por ele fala com você no WhatsApp, e o cadastro e o pedido do site vão para a sua carteira.</p>
        </section>
      )}
      <form action={trocarSenha} className="painel campos" style={{ maxWidth: 520 }}>
        <h2 className="largo">Trocar senha</h2>
        <input type="email" name="email" value={email} autoComplete="username" readOnly hidden />
        <label className="largo">Senha atual<input name="atual" type="password" autoComplete="current-password" required /></label>
        <label className="largo">Nova senha (mínimo 10 caracteres)<input name="nova" type="password" autoComplete="new-password" minLength={10} required /></label>
        <label className="largo">Repita a nova senha<input name="repetir" type="password" autoComplete="new-password" minLength={10} required /></label>
        <button className="principal">Trocar senha</button>
        <p className="pequeno suave largo" style={{ margin: 0 }}>Dica: uma frase fácil de lembrar, como “cafe-com-leite-na-loja-2026”. Esqueceu a senha? Peça um link de nova senha ao dono ou à gerência (tela Equipe).</p>
      </form>
    </>
  );
}
