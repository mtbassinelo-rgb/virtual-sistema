import type { NextRequest } from "next/server";

// Site da loja aberto para o Google; sistema da equipe e teste fechados.
export function GET(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const loja = !/^(app|teste)\./.test(host);
  const corpo = loja
    ? `User-agent: *\nAllow: /loja\nDisallow: /loja/conta\nDisallow: /loja/pedidos\nDisallow: /loja/entrar\nDisallow: /loja/evento\nSitemap: https://${host}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n";
  return new Response(corpo, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
