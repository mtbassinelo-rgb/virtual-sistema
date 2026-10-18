import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_UNIDADE } from "@/lib/unidade";

// Volta o visitante para o site principal (CD Foz).
export async function GET(req: NextRequest) {
  const r = NextResponse.redirect(new URL("/loja", req.url), 303);
  r.cookies.delete(COOKIE_UNIDADE);
  return r;
}
