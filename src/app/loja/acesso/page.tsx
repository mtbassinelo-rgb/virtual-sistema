import Link from "next/link";
import { idiomaAtual } from "@/lib/idioma";

export const metadata = { title: "Área do cliente" };

const T = {
  pt: { titulo: "Área do cliente", link: "Este link de acesso já foi usado ou expirou. Peça um novo para a sua vendedora pelo WhatsApp.",
        texto: "Para ver os seus preços e fazer pedidos, use o link de acesso que a sua vendedora envia pelo WhatsApp. Se ainda não recebeu, peça para ela.",
        nota: "O link é pessoal: ele abre o catálogo com os seus preços.", novo: "Ainda não é cliente?", cadastro: "Quero ser cliente" },
  es: { titulo: "Área de clientes", link: "Este enlace de acceso ya fue usado o venció. Pida uno nuevo a su vendedora por WhatsApp.",
        texto: "Para ver sus precios y hacer pedidos, use el enlace de acceso que su vendedora envía por WhatsApp. Si todavía no lo recibió, pídaselo.",
        nota: "El enlace es personal: abre el catálogo con sus precios.", novo: "¿Todavía no es cliente?", cadastro: "Quiero ser cliente" },
};

export default async function Acesso({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  const { motivo } = await searchParams;
  const t = T[await idiomaAtual()];
  return (
    <div className="in pagina">
      <section className="painel" style={{ maxWidth: 560 }}>
        <h1>{t.titulo}</h1>
        <p>{motivo === "link" ? t.link : t.texto}</p>
        <p className="suave pequeno">{t.nota}</p>
        <p>{t.novo} <Link href="/loja/cadastro">{t.cadastro}</Link></p>
      </section>
    </div>
  );
}
