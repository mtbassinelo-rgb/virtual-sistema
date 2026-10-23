import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { lerCsv } from "@/lib/importar-bling";
import { Avisos } from "../../avisos";

export const metadata = { title: "Tabela de preços" };

const COLUNAS: Record<string, string> = {
  "py normal (gs)": "py_normal", "py vip (gs)": "py_vip", "br normal (r$)": "br_normal", "br vip (r$)": "br_vip",
};

/** "20.000" → 20000 · "39,90" → 39.9 · "39.90" → 39.9 */
function valor(s: string): number | null {
  let t = s.replace(/\s|R\$|Gs/gi, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`Valor inválido na planilha: "${s}"`);
  return n;
}

async function enviarPrecos(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  let destino: string;
  try {
    const arq = fd.get("arquivo");
    if (!(arq instanceof File) || arq.size === 0) throw new Error("Escolha a planilha de preços (CSV).");
    let texto = new TextDecoder("utf-8").decode(await arq.arrayBuffer());
    if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(await arq.arrayBuffer());
    const sep = (texto.split(/\r?\n/)[0].match(/;/g)?.length ?? 0) > 0 ? ";" : ",";
    const linhas = lerCsv(texto, sep);
    const cab = linhas[0].map((c) => c.trim().toLowerCase());
    const iCod = cab.indexOf("código") >= 0 ? cab.indexOf("código") : cab.indexOf("codigo");
    if (iCod < 0) throw new Error('A planilha precisa da coluna "Código". Baixe o modelo nesta página.');
    const cols = Object.entries(COLUNAS).map(([nome, tabela]) => ({ i: cab.indexOf(nome), tabela })).filter((c) => c.i >= 0);
    if (cols.length === 0) throw new Error("Nenhuma coluna de preço reconhecida. Use o modelo desta página.");
    const itens: { codigo: string; tabela: string; valor: number }[] = [];
    for (const l of linhas.slice(1)) {
      const codigo = (l[iCod] ?? "").trim();
      if (!codigo) continue;
      for (const c of cols) {
        const v = valor(l[c.i] ?? "");
        if (v != null) itens.push({ codigo, tabela: c.tabela, valor: v });
      }
    }
    const iCaixa = cab.indexOf("peças por caixa");
    const caixas = iCaixa < 0 ? [] : linhas.slice(1).filter((l) => (l[iCaixa] ?? "").trim() !== "" && (l[iCod] ?? "").trim())
      .map((l) => ({ codigo: l[iCod].trim(), unidades: l[iCaixa].replace(/\D/g, "") }));
    const r = await comUsuario(u.id, async (c) => {
      if (caixas.length) await c.query("select app.definir_caixas($1::jsonb)", [JSON.stringify(caixas)]);
      return c.query("select app.importar_precos($1::jsonb) as r", [JSON.stringify(itens)]);
    });
    const s = r.rows[0].r as { alterados: number; codigos_desconhecidos: string[] };
    destino = "ok=" + encodeURIComponent(`${s.alterados} preço(s) atualizado(s), valendo a partir de hoje.` +
      (s.codigos_desconhecidos.length ? ` Códigos não encontrados: ${s.codigos_desconhecidos.slice(0, 15).join(", ")}${s.codigos_desconhecidos.length > 15 ? "…" : ""}` : ""));
  } catch (e) {
    destino = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  revalidatePath("/estoque/precos");
  redirect(`/estoque/precos?${destino}`);
}

export default async function Precos({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono altera preços.</div>;
  const r = await comUsuario(u.id, async (c) => (await c.query(`
    select t.codigo, t.nome, count(distinct p.produto_id) as com_preco,
           (select count(*) from app.produtos where ativo and not marketplace) as total
      from app.tabelas_preco t left join app.precos p on p.tabela = t.codigo
     group by t.codigo, t.nome order by t.pais desc, t.codigo`)).rows);
  return (
    <>
      <section>
        <h1>Tabela de preços</h1>
        <p className="suave">Os preços de todas as tabelas numa planilha: baixe, preencha no Excel ou no Google Planilhas e envie de volta. Só o que mudou é gravado, valendo a partir de hoje, e o histórico de preços fica guardado. Preços em Gs são arredondados para múltiplos de 500.</p>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />
      <div className="indicadores">
        {r.map((t) => (
          <div key={t.codigo} className="indicador">
            <span className="rotulo">{t.nome}</span>
            <span className="valor">{Number(t.com_preco)} <span className="pequeno suave">de {Number(t.total)}</span></span>
          </div>
        ))}
      </div>
      <p className="pequeno suave">O cliente só vê na área dele os produtos que têm preço na tabela dele (país + Normal/VIP).</p>
      <section className="painel">
        <h2>1. Baixar a planilha</h2>
        <div><a className="botao principal" href="/estoque/precos/modelo">Baixar tabela de preços (CSV)</a></div>
        <p className="pequeno suave">Vem com todos os produtos, o custo e o preço do Bling como referência. Preencha as colunas PY Normal (Gs), PY VIP (Gs), BR Normal (R$) e BR VIP (R$) com o preço da UNIDADE, e "Peças por caixa" (o site mostra o preço da caixa fechada e o da unidade). Célula vazia não altera nada.</p>
      </section>
      <form action={enviarPrecos} className="painel campos">
        <h2 className="largo">2. Enviar a planilha preenchida</h2>
        <label className="largo">Arquivo CSV<input type="file" name="arquivo" accept=".csv,text/csv" required /></label>
        <button className="principal">Atualizar preços</button>
      </form>
    </>
  );
}
