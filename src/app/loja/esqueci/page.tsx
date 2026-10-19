import Link from "next/link";
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db";
import { idiomaAtual } from "@/lib/idioma";
import { sha256 } from "@/lib/portal";
import { enviarEmail } from "@/lib/email";

export const metadata = { title: "Esqueci a senha" };

const T = {
  pt: { titulo: "Esqueci a senha", texto: "Digite o número do seu documento. Enviamos um link para o e-mail cadastrado para você criar uma senha nova.",
        doc: "CPF, CNPJ, CI ou RUC", enviar: "Enviar link", voltar: "Voltar para entrar",
        ok: "Se o documento estiver cadastrado com e-mail, enviamos um link para criar uma senha nova. Ele vale por 30 minutos. Confira também a caixa de spam." },
  es: { titulo: "Olvidé mi contraseña", texto: "Escriba el número de su documento. Le enviamos un enlace al correo registrado para crear una contraseña nueva.",
        doc: "CI, RUC, CPF o CNPJ", enviar: "Enviar enlace", voltar: "Volver a ingresar",
        ok: "Si el documento está registrado con correo, le enviamos un enlace para crear una contraseña nueva. Vale por 30 minutos. Revise también la carpeta de spam." },
};

async function pedir(fd: FormData) {
  "use server";
  const idioma = await idiomaAtual();
  const doc = String(fd.get("documento") ?? "").slice(0, 30);
  if (doc.replace(/[^0-9a-z]/gi, "").length >= 5) {
    const token = randomBytes(32).toString("base64url");
    const r = (await pool.query("select nome, email from app.portal_pedir_redefinicao($1, $2)", [doc, sha256(token)])).rows[0];
    if (r?.email) {
      const host = (await headers()).get("host") ?? "distribuidoravirtualcosmeticos.com";
      const link = `https://${host}/loja/redefinir/${token}`;
      const es = idioma === "es";
      await enviarEmail(r.email, es ? "Nueva contraseña · Virtual Cosméticos" : "Nova senha · Virtual Cosméticos",
        es ? `Hola, ${r.nome}.\n\nPara crear una contraseña nueva, abra este enlace (vale por 30 minutos y una sola vez):\n${link}\n\nSi usted no lo pidió, ignore este correo: su contraseña actual sigue igual.\n\nVirtual Cosméticos`
           : `Olá, ${r.nome}.\n\nPara criar uma senha nova, abra este link (vale por 30 minutos e uma única vez):\n${link}\n\nSe não foi você que pediu, ignore este e-mail: a sua senha atual continua a mesma.\n\nVirtual Cosméticos`);
    }
  }
  // a resposta é sempre a mesma, para ninguém descobrir quais documentos estão cadastrados
  redirect("/loja/esqueci?enviado=1");
}

export default async function Esqueci({ searchParams }: { searchParams: Promise<{ enviado?: string }> }) {
  const { enviado } = await searchParams;
  const t = T[await idiomaAtual()];
  return (
    <div className="in pagina">
      <section className="painel acesso-cliente">
        <h1>{t.titulo}</h1>
        {enviado ? <div className="aviso-caixa ok" role="status">{t.ok}</div> : (
          <>
            <p style={{ margin: 0 }}>{t.texto}</p>
            <form action={pedir} className="acesso-form">
              <label>{t.doc}<input name="documento" required autoComplete="username" maxLength={30} /></label>
              <button className="adicionar">{t.enviar}</button>
            </form>
          </>
        )}
        <p style={{ margin: 0 }}><Link href="/loja/acesso">{t.voltar}</Link></p>
      </section>
    </div>
  );
}
