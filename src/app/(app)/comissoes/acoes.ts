"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";

/** Gerente define (ou muda) o percentual e a base da comissão de uma vendedora, a partir de um mês. */
export async function definirComissao(fd: FormData) {
  const u = await exigirUsuario();
  const mes = texto(fd, "mes");
  let erro: string | null = null;
  try {
    const vendedora = texto(fd, "vendedora_id");
    const percentual = numero(fd, "percentual");
    const base = texto(fd, "base");
    const desde = texto(fd, "vigente_desde");
    if (!vendedora) throw new Error("Escolha a vendedora.");
    if (percentual === null || percentual < 0 || percentual > 100) throw new Error("Informe um percentual entre 0 e 100.");
    if (!["vendido", "recebido", "lucro"].includes(base)) throw new Error("Escolha a base da comissão.");
    if (!/^\d{4}-\d{2}$/.test(desde)) throw new Error("Informe o mês a partir do qual vale.");
    await comUsuario(u.id, (c) => c.query(
      `insert into app.comissao_regras (vendedora_id, vigente_desde, percentual, base, observacao)
       values ($1, ($2 || '-01')::date, $3, $4, nullif($5, ''))
       on conflict (vendedora_id, vigente_desde) do update set percentual = excluded.percentual, base = excluded.base, observacao = excluded.observacao`,
      [vendedora, desde, percentual, base, texto(fd, "observacao")]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/comissoes");
  redirect(`/comissoes?mes=${encodeURIComponent(mes)}&${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Comissão definida.")}`);
}
