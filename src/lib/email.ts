import "server-only";
import nodemailer from "nodemailer";

/** Envia um aviso por e-mail para a equipe. Sem SMTP configurado no servidor, não faz nada (e não atrapalha o site). */
export async function avisarEquipe(assunto: string, texto: string): Promise<void> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USUARIO, SMTP_SENHA, EMAIL_AVISOS } = process.env;
  if (!SMTP_HOST || !SMTP_USUARIO || !SMTP_SENHA || !EMAIL_AVISOS) return;
  try {
    const t = nodemailer.createTransport({
      host: SMTP_HOST, port: Number(SMTP_PORT || 587), secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USUARIO, pass: SMTP_SENHA },
    });
    await t.sendMail({ from: `"Site Virtual Cosméticos" <${SMTP_USUARIO}>`, to: EMAIL_AVISOS, subject: assunto, text: texto });
  } catch (e) {
    console.error("Falha ao enviar e-mail de aviso:", (e as Error).message);
  }
}
