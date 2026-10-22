"use server";

import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { texto } from "@/lib/formato";

/** Pedido de visitante do site já respondido no WhatsApp. */
export async function marcarPedidoSiteAtendido(fd: FormData) {
  const u = await exigirUsuario();
  await comUsuario(u.id, (c) => c.query(
    "update app.pedidos_site set atendido_em = now(), atendido_por = app.uid() where id = $1 and atendido_em is null", [texto(fd, "id")]));
  revalidatePath("/");
}

/** Gerente/dono apaga pedidos do site feitos só para teste (um ou vários: campos "id"). */
export async function apagarPedidosSite(fd: FormData) {
  const u = await exigirUsuario();
  const ids = fd.getAll("id").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return;
  await comUsuario(u.id, (c) => c.query("select app.apagar_pedidos_site($1::uuid[])", [ids]));
  revalidatePath("/");
}
