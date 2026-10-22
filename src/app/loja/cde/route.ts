import { redirecionar } from "@/lib/redirecionar";
import { COOKIE_UNIDADE } from "@/lib/unidade";

// Entrada do site da loja de Ciudad del Este (link: distribuidoravirtualcosmeticos.com/cde).
// Guarda a unidade no navegador do visitante; cliente logado sempre fica na unidade do cadastro dele.
export async function GET() {
  const r = redirecionar("/loja");
  r.cookies.set(COOKIE_UNIDADE, "loja-cde", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return r;
}
