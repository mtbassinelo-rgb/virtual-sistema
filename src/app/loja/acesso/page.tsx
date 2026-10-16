export const metadata = { title: "Acesso" };

export default async function Acesso({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  const { motivo } = await searchParams;
  return (
    <section className="painel" style={{ maxWidth: 520 }}>
      <h1>Área do cliente</h1>
      {motivo === "link" ? (
        <p>Este link de acesso já foi usado ou expirou. Peça um novo para a sua vendedora pelo WhatsApp.</p>
      ) : (
        <p>Para fazer pedidos, use o link de acesso que a sua vendedora envia pelo WhatsApp. Se ainda não recebeu, peça para ela.</p>
      )}
      <p className="suave pequeno">O link é pessoal: ele abre o catálogo com os seus preços.</p>
    </section>
  );
}
