import { NextResponse } from "next/server";

/**
 * Redireciona para um caminho do próprio site (ex.: "/loja") sem montar o endereço completo.
 * Atrás do proxy, o endereço interno do servidor é 0.0.0.0:3000; com o caminho relativo o navegador
 * continua no domínio em que está.
 */
export function redirecionar(caminho: string, status = 303): NextResponse {
  const seguro = caminho.startsWith("/") && !caminho.startsWith("//") ? caminho : "/";
  return new NextResponse(null, { status, headers: { Location: seguro } });
}
