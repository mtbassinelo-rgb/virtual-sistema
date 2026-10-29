"use server";

import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { sincronizarMarketplaces } from "@/lib/marketplace-api";

export async function buscarAgora() {
  const u = await exigirUsuario();
  if (!ehGestao(u)) redirect("/marketplace/conexoes?erro=" + encodeURIComponent("Só gerente ou dono."));
  const r = await sincronizarMarketplaces();
  const erros = r.filter((x) => x.erro);
  const msg = erros.length ? erros.map((x) => `${x.canal}: ${x.erro}`).join(" · ") : `Busca feita: ${r.reduce((s, x) => s + x.pedidos, 0)} pedido(s) lidos.`;
  redirect(`/marketplace/conexoes?${erros.length ? "erro" : "ok"}=${encodeURIComponent(msg)}`);
}
