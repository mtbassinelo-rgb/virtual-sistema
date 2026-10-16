import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { pool } from "@/lib/db";
import { COOKIE_CLIENTE, sha256 } from "@/lib/portal";

export async function GET(req: Request) {
  const t = (await cookies()).get(COOKIE_CLIENTE)?.value;
  if (t) await pool.query("select app.portal_sair($1)", [sha256(t)]);
  const r = NextResponse.redirect(new URL("/loja/acesso", req.url), 303);
  r.cookies.set(COOKIE_CLIENTE, "", { path: "/loja", maxAge: 0 });
  return r;
}
