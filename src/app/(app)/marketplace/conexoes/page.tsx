import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dataHora } from "@/lib/formato";
import { mlConfigurado, shopeeConfigurada } from "@/lib/marketplace-api";
import { Avisos, Selo } from "../../avisos";
import { buscarAgora } from "./acoes";

export const metadata = { title: "Conexões com marketplaces" };
export const dynamic = "force-dynamic";

type Conta = { id: string; canal: string; conta_externa: string; nome: string | null; ativa: boolean; conectada_em: string; conectada_por: string | null;
  sincronizada_em: string | null; ultimo_erro: string | null; ultimo_erro_em: string | null; refresh_expira_em: string | null };

const CANAIS: { codigo: string; nome: string; configurado: () => boolean; envs: string }[] = [
  { codigo: "mercado_livre", nome: "Mercado Livre", configurado: mlConfigurado, envs: "ML_CLIENT_ID e ML_CLIENT_SECRET" },
  { codigo: "shopee", nome: "Shopee", configurado: shopeeConfigurada, envs: "SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY" },
];

/** Gerente conecta as lojas da Shopee e do Mercado Livre: os pedidos chegam sozinhos e viram envios para o estoquista. */
export default async function Conexoes({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono conecta as lojas.</div>;
  const contas = await comUsuario(u.id, async (c) => (await c.query("select * from app.mkt_contas_situacao()")).rows as Conta[]);

  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <div className="trilha"><Link href="/marketplace">Marketplace</Link> / Conexões</div>
          <h1>Conexões com Shopee e Mercado Livre</h1>
          <p>Com a loja conectada, o sistema busca os pedidos pagos a cada poucos minutos: a venda entra, o estoque sai
            e o pedido aparece em <Link href="/estoque/separacao#envios">Envios de hoje</Link> para o estoquista embalar.
            Pedidos do Full (armazém da plataforma) não entram. O relatório do Bling continua valendo e não duplica.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      {CANAIS.map((k) => {
        const lista = contas.filter((c) => c.canal === k.codigo);
        const pronto = k.configurado();
        return (
          <section key={k.codigo} className="painel">
            <div className="linha entre">
              <h2 style={{ margin: 0 }}>{k.nome}</h2>
              {pronto
                ? <a className="botao principal" href={`/api/marketplace/${k.codigo === "shopee" ? "shopee" : "ml"}/conectar`}>{lista.length ? "Conectar outra conta / reconectar" : `Conectar ${k.nome}`}</a>
                : <Selo cor="aviso">falta configurar no servidor</Selo>}
            </div>
            {!pronto && <p className="pequeno suave">Coloque {k.envs} no arquivo .env do servidor (os dados do app criado na plataforma) e publique de novo.</p>}
            {lista.length === 0 ? <p className="suave">Nenhuma conta conectada.</p> : (
              <ul className="lista-simples">
                {lista.map((c) => (
                  <li key={c.id}>
                    <b>{c.nome ?? c.conta_externa}</b> <span className="pequeno suave">({c.conta_externa})</span>{" "}
                    {c.ultimo_erro ? <Selo cor="erro">com erro</Selo> : c.sincronizada_em ? <Selo cor="ok">funcionando</Selo> : <Selo cor="aviso">aguardando primeira busca</Selo>}
                    <div className="pequeno suave">Conectada em {dataHora(c.conectada_em)}{c.conectada_por ? ` por ${c.conectada_por}` : ""}
                      {c.sincronizada_em ? ` · última busca ${dataHora(c.sincronizada_em)}` : ""}
                      {c.refresh_expira_em ? ` · reconectar até ${dataHora(c.refresh_expira_em)}` : ""}</div>
                    {c.ultimo_erro && <div className="pequeno" style={{ color: "var(--erro)" }}>{dataHora(c.ultimo_erro_em)}: {c.ultimo_erro}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {contas.length > 0 && <form action={buscarAgora}><button>Buscar pedidos agora</button></form>}
    </>
  );
}
