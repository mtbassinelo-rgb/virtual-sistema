import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";
import { Avisos } from "../avisos";

export const metadata = { title: "Parâmetros" };

// Ordem e grupo de cada parâmetro na tela
const GRUPOS: { titulo: string; chaves: string[] }[] = [
  { titulo: "Vendas e lucro", chaves: ["cambio_custo_gs", "pedido_exige_estoque", "link_pedido_validade_dias", "arredondamento_gs"] },
  { titulo: "Envios ao Paraguai", chaves: ["passeiro_custo_volume"] },
  { titulo: "Inteligência comercial", chaves: ["cambio_compra_gs", "margem_minima_contribuicao", "classif_atracao_pct", "classif_margem_baixa"] },
  { titulo: "Retire em Foz", chaves: ["retirada_foz_ativa", "retirada_foz_desconto_caixa", "retirada_foz_teto_mes"] },
  { titulo: "Promoções", chaves: ["promo_desconto_maximo", "promo_sugerida_desconto"] },
  { titulo: "Estoque", chaves: ["giro_janela_dias", "giro_parado_cobertura", "giro_baixo_cobertura", "giro_ultimas_unidades"] },
  { titulo: "Área do cliente", chaves: ["convite_validade_dias", "sessao_cliente_dias"] },
];

async function salvar(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  let erro: string | null = null;
  try {
    const chave = texto(fd, "chave");
    const valor = numero(fd, "valor");
    if (valor === null || valor < 0) throw new Error("Informe um número válido.");
    if ((chave === "pedido_exige_estoque" || chave === "retirada_foz_ativa") && valor !== 0 && valor !== 1) throw new Error("Use 1 (sim) ou 0 (não).");
    if ((chave === "cambio_custo_gs" || chave === "cambio_compra_gs") && (valor < 100 || valor > 100000)) throw new Error("Câmbio fora do esperado (Gs por R$).");
    if (chave === "margem_minima_contribuicao" && valor >= 90) throw new Error("Margem mínima deve ficar abaixo de 90%.");
    const r = await comUsuario(u.id, (c) => c.query("update app.parametros set valor = $2 where chave = $1", [chave, valor]));
    if (r.rowCount === 0) throw new Error("Você não tem permissão para alterar este parâmetro.");
  } catch (e) {
    erro = mensagemErro(e);
  }
  revalidatePath("/parametros");
  redirect(`/parametros?${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent("Parâmetro salvo.")}`);
}

export default async function Parametros({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) redirect("/");
  const f = await searchParams;
  const lista = await comUsuario(u.id, async (c) => (await c.query("select chave, valor, descricao from app.parametros order by chave")).rows);
  const porChave = new Map(lista.map((p) => [p.chave as string, p]));
  const usados = new Set(GRUPOS.flatMap((g) => g.chaves));
  const outros = lista.filter((p) => !usados.has(p.chave));
  const grupos = [...GRUPOS, ...(outros.length ? [{ titulo: "Outros", chaves: outros.map((p) => p.chave as string) }] : [])];

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Parâmetros</h1>
          <p>Ajustes que o gerente configura. Valem a partir do momento em que são salvos; vendas já feitas não mudam.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />
      {grupos.map((g) => (
        <section key={g.titulo} className="painel">
          <h2>{g.titulo}</h2>
          <div className="tabela"><table style={{ minWidth: 0 }}><tbody>
            {g.chaves.map((k) => porChave.get(k)).filter(Boolean).map((p) => (
              <tr key={p!.chave}>
                <td>{p!.descricao}<div className="pequeno suave">{p!.chave}</div></td>
                <td style={{ width: 260 }}>
                  <form action={salvar} className="linha">
                    <input type="hidden" name="chave" value={p!.chave} />
                    <input name="valor" inputMode="decimal" defaultValue={Number(p!.valor).toLocaleString("pt-BR")} aria-label={p!.descricao} style={{ width: 120 }} />
                    <button>Salvar</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody></table></div>
        </section>
      ))}
    </>
  );
}
