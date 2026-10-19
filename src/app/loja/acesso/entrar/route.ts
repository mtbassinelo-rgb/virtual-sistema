import { NextResponse, type NextRequest } from "next/server";
import { idiomaAtual } from "@/lib/idioma";
import { abrirSessaoCliente, conferirCliente } from "@/lib/portal";

/**
 * Login do cliente por formulário comum (POST) com redirecionamento 303: o navegador carrega a loja inteira de novo,
 * já como cliente (cabeçalho, preços e carrinho), e o cookie de sessão fica gravado por 90 dias.
 */
export async function POST(req: NextRequest) {
  const fd = await req.formData();
  const es = (await idiomaAtual()) === "es";
  const base = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? base.host;
  const proto = req.headers.get("x-forwarded-proto") ?? base.protocol.replace(":", "");
  const para = (caminho: string) => NextResponse.redirect(`${proto}://${host}${caminho}`, 303);
  const r = await conferirCliente(String(fd.get("documento") ?? ""), String(fd.get("senha") ?? ""), es);
  if (!r.id) return para(`/loja/acesso?erro=${encodeURIComponent(r.erro ?? "")}`);
  await abrirSessaoCliente(r.id);
  const volta = String(fd.get("volta") ?? "");
  return para(volta.startsWith("/loja") && !volta.startsWith("//") ? volta : "/loja");
}
