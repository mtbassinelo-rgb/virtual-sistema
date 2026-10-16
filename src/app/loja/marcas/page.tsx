import Link from "next/link";
import { pool } from "@/lib/db";
import { interno, marcaDe } from "@/lib/vitrine";
import { TEXTOS, idiomaAtual } from "@/lib/idioma";

export const metadata = { title: "Marcas" };

export default async function Marcas() {
  const idioma = await idiomaAtual();
  const t = TEXTOS[idioma];
  const rows = (await pool.query("select nome, marca from app.vitrine_publica()")).rows as { nome: string; marca: string | null }[];
  const marcas = new Map<string, number>();
  for (const r of rows) {
    if (interno(r.nome)) continue;
    const m = marcaDe(r.nome, r.marca);
    if (m) marcas.set(m, (marcas.get(m) ?? 0) + 1);
  }
  const lista = [...marcas.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  return (
    <div className="in pagina">
      <h1>{t.marcas}</h1>
      <p className="suave" style={{ margin: 0 }}>{t.marcasTexto(lista.length)}</p>
      <div className="marcas">
        {lista.map(([m, n]) => {
          return (
            <Link key={m} href={`/loja?marca=${encodeURIComponent(m)}#catalogo`} className="marca-bloco">
              <b>{m}</b><span>{n}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
