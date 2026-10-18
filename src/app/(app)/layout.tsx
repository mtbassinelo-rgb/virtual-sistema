import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario, sair } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { PERFIS } from "@/lib/formato";
import { MenuLateral, type GrupoMenu } from "./menu-lateral";

async function acaoSair() {
  "use server";
  await sair();
  redirect("/login");
}

export default async function AreaInterna({ children }: { children: React.ReactNode }) {
  const u = await exigirUsuario();
  const gestao = ehGestao(u);
  // Contadores ao lado dos itens do menu: o que está esperando alguém
  const n = await comUsuario(u.id, async (c) => (await c.query(`
    select (select count(*) from app.pedidos where status_comercial::text in ('aguardando_cliente','aguardando_aprovacao','em_separacao'))::int as pedidos_abertos,
           ${gestao ? `(select count(*) from app.v_despesas where situacao = 'vencida')::int` : "0"} as contas_vencidas,
           ${gestao ? `(select count(*) from app.procuras where visto_em is null)::int` : "0"} as procuras,
           ${gestao ? `(select count(*) from app.fotos_catalogo where status = 'pendente')::int` : "0"} as fotos,
           (select count(*) from app.produtos p where p.ativo and not exists (select 1 from app.precos z where z.produto_id = p.id))::int as sem_preco,
           (select count(*) from app.carrinhos_parados() where avisado_em is null)::int as carrinhos
  `)).rows[0] as { pedidos_abertos: number; contas_vencidas: number; procuras: number; fotos: number; sem_preco: number; carrinhos: number }).catch(() => ({ pedidos_abertos: 0, contas_vencidas: 0, procuras: 0, fotos: 0, sem_preco: 0, carrinhos: 0 }));

  const grupos: GrupoMenu[] = [
    gestao
      ? { id: "inicio", titulo: "Início", icone: "inicio", itens: [{ href: "/", texto: "Painel do dia" }, { href: "/abertura", texto: "Abertura da loja", dica: "O que falta para os clientes comprarem pelo site" }] }
      : { id: "inicio", titulo: "Início", icone: "inicio", itens: [{ href: "/", texto: "Início" }] },
    { id: "vendas", titulo: "Vendas", icone: "vendas", itens: [
      { href: "/pedidos", texto: "Pedidos", contador: n.pedidos_abertos, dica: "Pedidos abertos: em separação ou aguardando" },
      { href: "/pedidos/novo", texto: "Novo pedido" },
      { href: "/clientes", texto: "Clientes" },
      { href: "/clientes/carrinhos", texto: "Carrinhos parados", contador: n.carrinhos, dica: "Clientes que montaram carrinho e não enviaram" },
      { href: "/metas", texto: "Metas" },
      { href: "/promocoes", texto: "Promoções" },
      ...(gestao ? [] : [{ href: "/procuras", texto: "Cliente pediu e não temos" }]),
    ] },
    { id: "produtos", titulo: "Produtos", icone: "produtos", itens: [
      { href: "/produtos", texto: "Todos os produtos" },
      ...(gestao ? [
        { href: "/produtos/precos-rapido", texto: "Editar preços rápido", contador: n.sem_preco, dica: "Produtos ativos sem nenhum preço" },
        { href: "/produtos/novo", texto: "Novo produto" },
        { href: "/produtos/kits", texto: "Kits capilares (montar)" },
        { href: "/produtos/fotos", texto: "Fotos do catálogo", contador: n.fotos, dica: "Fotos esperando conferência" },
        { href: "/estoque/precos", texto: "Preços por planilha" },
      ] : []),
      ...(gestao ? [{ href: "/produtos/fotos-faltando", texto: "Buscar fotos", dica: "Produtos sem foto: procure no Google e arraste a foto aprovada" }] : [{ href: "/produtos?filtro=sem-foto", texto: "Sem foto" }]),
      { href: "/produtos?filtro=inativos", texto: "Inativos" },
    ] },
    { id: "estoque", titulo: "Estoque", icone: "estoque", itens: [
      { href: "/estoque", texto: "Saldo e movimentos" },
      ...(gestao ? [{ href: "/estoque/importar", texto: "Importar do Bling" }] : []),
    ] },
    { id: "relatorios", titulo: "Relatórios", icone: "relatorios", itens: [
      { href: "/relatorios", texto: "Resumo de vendas" },
      { href: "/relatorios?aba=produtos", texto: "Mais vendidos" },
      { href: "/relatorios?aba=estoque", texto: "Estoque baixo e parado" },
      { href: "/relatorios?aba=catalogo", texto: "Saúde do catálogo" },
      ...(gestao ? [
        { href: "/relatorios?aba=lucro", texto: "Lucro e rankings" },
        { href: "/relatorios?aba=envios", texto: "Envios ao Paraguai" },
        { href: "/procuras", texto: "Procurados sem estoque", contador: n.procuras, dica: "Pedidos de produtos esgotados ainda não vistos" },
      ] : []),
    ] },
    gestao
      ? { id: "financeiro", titulo: "Financeiro", icone: "financeiro", itens: [
          { href: "/despesas", texto: "Despesas e contas", contador: n.contas_vencidas, dica: "Contas vencidas" },
          { href: "/relatorios?aba=resultado", texto: "Resultado do mês" },
          { href: "/comissoes", texto: "Comissões" },
          { href: "/parametros", texto: "Parâmetros" },
        ] }
      : { id: "financeiro", titulo: "Comissão", icone: "financeiro", itens: [{ href: "/comissoes", texto: "Minha comissão" }] },
    { id: "site", titulo: "Loja online", icone: "site", itens: [
      { href: "/site", texto: "Banners e destaques" },
    ] },
    { id: "admin", titulo: "Administração", icone: "admin", itens: [
      ...(gestao ? [{ href: "/equipe", texto: "Equipe e acessos" }] : []),
      { href: "/conta", texto: "Minha conta" },
    ] },
  ];

  return (
    <div className="casca">
      <aside className="lateral">
        <Link href="/" className="marca-lateral">
          <img src="/marca/icone.png" width={34} height={32} alt="" />
          <span>Virtual Cosméticos<small>Sistema comercial</small></span>
        </Link>
        <Suspense fallback={null}><MenuLateral grupos={grupos} /></Suspense>
        <div className="lateral-rodape">
          <a href="/loja" target="_blank" rel="noopener noreferrer">Ver a loja como cliente ↗</a>
        </div>
      </aside>
      <div className="principal-area">
        <header className="barra-topo">
          <form action="/busca" className="busca-geral" role="search">
            <label className="sr-only" htmlFor="busca-geral">Buscar no sistema</label>
            <input id="busca-geral" name="q" type="search" placeholder="Buscar produto, cliente ou pedido…" autoComplete="off" />
          </form>
          <div className="quem">
            <Link href="/conta" title="Minha conta: trocar senha">{u.nome}<small>{PERFIS[u.perfil]}</small></Link>
            <form action={acaoSair}><button type="submit">Sair</button></form>
          </div>
        </header>
        <main className="conteudo">{children}</main>
      </div>
    </div>
  );
}
