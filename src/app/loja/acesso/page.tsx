import Link from "next/link";
import { redirect } from "next/navigation";
import { idiomaAtual } from "@/lib/idioma";
import { abrirSessaoCliente, clienteAtual, conferirCliente } from "@/lib/portal";

export const metadata = { title: "Área do cliente" };

const T = {
  pt: { titulo: "Área do cliente", texto: "Entre com o número do seu documento e a senha que a sua vendedora enviou pelo WhatsApp.",
        doc: "CPF, CNPJ, CI ou RUC", senha: "Senha", entrar: "Entrar", esqueci: "Esqueceu a senha? Peça uma nova para a sua vendedora pelo WhatsApp.",
        link: "Este link de acesso já foi usado ou expirou. Entre com o seu documento e senha, ou peça a senha para a sua vendedora.",
        novo: "Ainda não é cliente?", cadastro: "Quero ser cliente" },
  es: { titulo: "Área de clientes", texto: "Ingrese con el número de su documento y la contraseña que su vendedora le envió por WhatsApp.",
        doc: "CI, RUC, CPF o CNPJ", senha: "Contraseña", entrar: "Ingresar", esqueci: "¿Olvidó su contraseña? Pida una nueva a su vendedora por WhatsApp.",
        link: "Este enlace de acceso ya fue usado o venció. Ingrese con su documento y contraseña, o pida la contraseña a su vendedora.",
        novo: "¿Todavía no es cliente?", cadastro: "Quiero ser cliente" },
};

async function entrar(fd: FormData) {
  "use server";
  const es = (await idiomaAtual()) === "es";
  const r = await conferirCliente(String(fd.get("documento") ?? ""), String(fd.get("senha") ?? ""), es);
  if (!r.id) redirect(`/loja/acesso?erro=${encodeURIComponent(r.erro ?? "")}`);
  await abrirSessaoCliente(r.id);
  redirect("/loja");
}

export default async function Acesso({ searchParams }: { searchParams: Promise<{ motivo?: string; erro?: string }> }) {
  const { motivo, erro } = await searchParams;
  if (await clienteAtual()) redirect("/loja");
  const t = T[await idiomaAtual()];
  return (
    <div className="in pagina">
      <section className="painel acesso-cliente">
        <h1>{t.titulo}</h1>
        <p style={{ margin: 0 }}>{motivo === "link" ? t.link : t.texto}</p>
        {erro && <div className="aviso-erro" role="alert">{erro}</div>}
        <form action={entrar} className="acesso-form">
          <label>{t.doc}<input name="documento" required autoComplete="username" inputMode="text" maxLength={30} /></label>
          <label>{t.senha}<input name="senha" type="password" required autoComplete="current-password" maxLength={100} /></label>
          <button className="adicionar">{t.entrar}</button>
        </form>
        <p className="suave pequeno" style={{ margin: 0 }}>{t.esqueci}</p>
        <p style={{ margin: 0 }}>{t.novo} <Link href="/loja/cadastro">{t.cadastro}</Link></p>
      </section>
    </div>
  );
}
