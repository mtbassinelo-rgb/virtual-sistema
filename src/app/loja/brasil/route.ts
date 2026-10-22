import { redirecionar } from "@/lib/redirecionar";
import { COOKIE_UNIDADE } from "@/lib/unidade";

// Volta o visitante para o site principal (CD Foz).
export async function GET() {
  const r = redirecionar("/loja");
  r.cookies.delete(COOKIE_UNIDADE);
  return r;
}
