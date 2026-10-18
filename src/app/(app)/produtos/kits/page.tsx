import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirUsuario, ehGestao } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";
import { Avisos, Selo } from "../../avisos";

export const metadata = { title: "Kits capilares" };

// Preços iniciais: planilha de preços (MAY-001 Kits Capilares e MAY-002 Kits Capilares Matizadores)
const PADRAO = {
  normal: { py_normal: "33.000", py_vip: "33.000", br_normal: "36,27", br_vip: "27,20", custo: "20,40" },
  matizador: { py_normal: "37.000", py_vip: "35.000", br_normal: "36,27", br_vip: "27,20", custo: "20,40" },
};
const CAMPOS = [["py_normal", "PY Normal (Gs)"], ["py_vip", "PY VIP (Gs)"], ["br_normal", "BR Normal (R$)"], ["br_vip", "BR VIP (R$)"], ["custo", "Custo do kit (R$)"]] as const;

async function criar(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  const marca = texto(fd, "marca") || "Maycrene";
  let msg: string;
  try {
    const linhas = fd.getAll("linha").map(String).filter(Boolean);
    if (linhas.length === 0) throw new Error("Marque pelo menos uma linha.");
    const precos: Record<string, Record<string, number | null>> = {};
    for (const g of ["normal", "matizador"]) {
      precos[g] = {};
      for (const [k] of CAMPOS) {
        const v = numero(fd, `${g}_${k}`);
        if (v !== null && v < 0) throw new Error("Preço inválido.");
        precos[g][k] = v;
      }
    }
    const n = await comUsuario(u.id, async (c) => (await c.query("select app.criar_kits_capilares($1, $2, $3::jsonb, $4) as n",
      [marca, linhas, JSON.stringify(precos), fd.get("esconder") === "on"])).rows[0].n as number);
    msg = "ok=" + encodeURIComponent(`${n} kit(s) criado(s).${fd.get("esconder") === "on" ? " Shampoo, condicionador e máscara dessas linhas saíram do site (continuam no sistema)." : ""}`);
  } catch (e) {
    msg = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  revalidatePath("/produtos");
  revalidatePath("/loja");
  redirect(`/produtos/kits?marca=${encodeURIComponent(marca)}&${msg}`);
}

async function mostrarSoltos(fd: FormData) {
  "use server";
  const u = await exigirUsuario();
  const marca = texto(fd, "marca") || "Maycrene";
  const ids = fd.getAll("id").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const mostrar = texto(fd, "mostrar") === "1";
  let msg: string;
  try {
    const n = await comUsuario(u.id, async (c) => (await c.query("select app.definir_mostrar_no_site($1::uuid[], $2) as n", [ids, mostrar])).rows[0].n);
    msg = "ok=" + encodeURIComponent(`${n} produto(s) ${mostrar ? "voltaram para o site" : "saíram do site"}.`);
  } catch (e) {
    msg = "erro=" + encodeURIComponent(mensagemErro(e));
  }
  revalidatePath("/loja");
  redirect(`/produtos/kits?marca=${encodeURIComponent(marca)}&${msg}`);
}

export default async function Kits({ searchParams }: { searchParams: Promise<{ marca?: string; ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  if (!ehGestao(u)) redirect("/produtos");
  const f = await searchParams;
  const marca = (f.marca ?? "Maycrene").slice(0, 60);
  const d = await comUsuario(u.id, async (c) => {
    const sug = (await c.query("select * from app.sugerir_kits_capilares($1)", [marca])).rows;
    const ids = sug.flatMap((s) => [s.shampoo_id, s.condicionador_id, s.mascara_id]);
    const site = new Map((await c.query("select id, mostrar_no_site from app.produtos where id = any($1::uuid[])", [ids])).rows
      .map((r) => [String(r.id), r.mostrar_no_site as boolean]));
    return { sug, site };
  });
  const novos = d.sug.filter((s) => !s.kit_id);

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <Link href="/produtos">← Produtos</Link>
          <h1 style={{ marginTop: 4 }}>Kits capilares</h1>
          <p>Junta shampoo + condicionador + máscara da mesma linha num kit. O kit aparece no site; os produtos soltos continuam no sistema (estoque e pedidos da vendedora) e podem sair do site. O estoque do kit é o dos produtos.</p>
        </div>
        <form className="linha" method="get"><label>Marca<input name="marca" defaultValue={marca} /></label><button>Buscar</button></form>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      {d.sug.length === 0 ? <div className="painel vazio">Nenhuma linha com shampoo, condicionador e máscara encontrada para “{marca}”. Importe os produtos do Bling primeiro.</div> : (
        <form action={criar} className="coluna">
          <input type="hidden" name="marca" value={marca} />
          <section className="painel">
            <h2>{d.sug.length} linhas encontradas · {novos.length} sem kit</h2>
            <div className="tabela"><table>
              <thead><tr><th></th><th>Linha</th><th>Shampoo</th><th>Condicionador</th><th>Máscara</th><th>No site</th></tr></thead>
              <tbody>{d.sug.map((s) => {
                const soltosNoSite = [s.shampoo_id, s.condicionador_id, s.mascara_id].filter((id) => d.site.get(String(id))).length;
                return (
                  <tr key={s.linha}>
                    <td><input type="checkbox" name="linha" value={s.linha} defaultChecked style={{ width: "auto" }} /></td>
                    <td><b>{s.linha}</b> {s.matizador && <Selo cor="marca">matizador</Selo>}
                      {s.kit_id && <div className="pequeno"><Link href={`/produtos/${s.kit_id}`}>{s.kit}</Link> <Selo cor="ok">kit já existe</Selo></div>}</td>
                    <td className="pequeno">{s.shampoo}</td><td className="pequeno">{s.condicionador}</td><td className="pequeno">{s.mascara}</td>
                    <td>{soltosNoSite === 0 ? <Selo cor="ok">só o kit</Selo> : <Selo cor="aviso">{soltosNoSite} solto(s)</Selo>}</td>
                  </tr>);
              })}</tbody>
            </table></div>
          </section>
          <section className="painel">
            <h2>Preços dos kits novos</h2>
            <p className="pequeno suave" style={{ margin: 0 }}>Vêm da planilha de preços (Kits Capilares e Kits Capilares Matizadores). Valem para os kits criados agora; depois ajuste em Produtos como qualquer preço.</p>
            {(["normal", "matizador"] as const).map((g) => (
              <div key={g} className="campos">
                <b className="largo">{g === "normal" ? "Kit normal" : "Kit matizador"}</b>
                {CAMPOS.map(([k, rot]) => <label key={k}>{rot}<input name={`${g}_${k}`} inputMode="decimal" defaultValue={PADRAO[g][k]} /></label>)}
              </div>
            ))}
            <label className="linha"><input type="checkbox" name="esconder" defaultChecked style={{ width: "auto" }} /> Tirar shampoo, condicionador e máscara soltos do site (continuam no sistema)</label>
            <button className="principal">Criar kits das linhas marcadas</button>
          </section>
        </form>
      )}

      {d.sug.length > 0 && (
        <section className="painel">
          <h2>Produtos soltos no site</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>Se quiser vender algum solto também pelo site, volte a mostrar. Também dá para mudar em cada produto (“Mostrar no site”).</p>
          <div className="linha">
            {[["0", "Tirar todos os soltos destas linhas do site"], ["1", "Mostrar todos os soltos no site"]].map(([v, t]) => (
              <form key={v} action={mostrarSoltos}>
                <input type="hidden" name="marca" value={marca} /><input type="hidden" name="mostrar" value={v} />
                {d.sug.flatMap((s) => [s.shampoo_id, s.condicionador_id, s.mascara_id]).map((id) => <input key={String(id)} type="hidden" name="id" value={String(id)} />)}
                <button>{t}</button>
              </form>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
