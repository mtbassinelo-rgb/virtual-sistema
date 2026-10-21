import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario, sair } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { PERFIS } from "@/lib/formato";
import { MenuLateral, type GrupoMenu } from "./menu-lateral";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { permissaoDoLink, pode } from "@/lib/permissoes";

async function acaoSair() {
  "use server";
  await sair();
  redirect("/login");
}

export default async function AreaInterna({ children }: { children: React.ReactNode }) {
  const u = await exigirUsuario();
  const gestao = ehGestao(u);
  const un = await unidadeSistema(u);
  // Contadores ao lado dos itens do menu: o que está esperando alguém
  const n = await comUsuario(u.id, async (c) => (await c.query(`
    select (select count(*) from app.pedidos where status_comercial::text in ('aguardando_cliente','aguardando_aprovacao','em_separacao'))::int as pedidos_abertos,
           ${gestao ? `(select count(*) from app.v_despesas where situacao = 'vencida')::int` : "0"} as contas_vencidas,
           ${gestao ? `(select count(*) from app.procuras where visto_em is null)::int` : "0"} as procuras,
           ${gestao ? `(select count(*) from app.fotos_catalogo where status = 'pendente')::int` : "0"} as fotos,
           (select count(*) from app.produtos p where p.ativo and not exists (select 1 from app.precos z where z.produto_id = p.id))::int as sem_preco,
           (select count(*) from app.carrinhos_parados() where avisado_em is null)::int as carrinhos,
           (select count(*) from app.procuras_chegaram())::int as chegaram,
           (select count(*) from app.pedidos where desconto_qtd_status = 'pendente' and status_comercial <> 'cancelado')::int as descontos
  `)).rows[0] as { pedidos_abertos: number; contas_vencidas: number; procuras: number; fotos: number; sem_preco: number; carrinhos: number; chegaram: number; descontos: number }).catch(() => ({ pedidos_abertos: 0, contas_vencidas: 0, procuras: 0, fotos: 0, sem_preco: 0, carrinhos: 0, chegaram: 0, descontos: 0 }));

  // Menu: Dashboard → operação do dia (vendas, clientes) → cadastro (produtos, estoque) → loja e marketing → análise → financeiro → configurações
  const todos: GrupoMenu[] = [
    gestao
      ? { id: "inicio", titulo: "Dashboard", icone: "inicio", itens: [
          { href: "/", texto: "Painel do dia", dica: "Pedidos, pagamentos, envios e pendências de hoje" },
          { href: "/saude-financeira", texto: "Saúde financeira", dica: "Vendas, compras, despesas, margens e plano de ação (área do dono)" },
          { href: "/relatorios?aba=resultado", texto: "Resultado do mês" },
        ] }
      : { id: "inicio", titulo: "Início", icone: "inicio", itens: [{ href: "/", texto: "Meu dia" }] },
    { id: "vendas", titulo: "Vendas", icone: "vendas", itens: [
      { href: "/pedidos", texto: "Pedidos", contador: n.pedidos_abertos, dica: "Pedidos abertos: em separação ou aguardando" },
      { href: "/pedidos/novo", texto: "Novo pedido" },
      { href: "/caixa", texto: "Caixa do dia", dica: "Abrir e fechar o caixa, vender no balcão e receber pedidos" },
      ...(gestao ? [{ href: "/pedidos?desconto=pendente", texto: "Descontos a liberar", contador: n.descontos, dica: "Pedidos do site que atingiram o desconto por quantidade: o gerente libera ou não" }] : []),
    ] },
    { id: "clientes", titulo: "Clientes", icone: "clientes", itens: [
      { href: "/clientes/recompra", texto: "Recompra (quem chamar)", dica: "Clientes que passaram do ritmo normal de compra, com WhatsApp pronto" },
      { href: "/clientes", texto: "Clientes" },
      { href: "/clientes/carrinhos", texto: "Carrinhos parados", contador: n.carrinhos, dica: "Clientes que montaram carrinho e não enviaram" },
      { href: "/procuras", texto: gestao ? "Procurados sem estoque" : "Cliente pediu e não temos", contador: gestao ? n.procuras + n.chegaram : n.chegaram,
        dica: "Produtos pedidos que estavam esgotados e os que já chegaram: avisar o cliente" },
      { href: "/metas", texto: "Metas" },
    ] },
    { id: "produtos", titulo: "Produtos", icone: "produtos", itens: [
      { href: "/produtos", texto: "Todos os produtos" },
      ...(gestao ? [
        { href: "/produtos/novo", texto: "Novo produto" },
        { href: "/produtos/precos-rapido", texto: "Editar preços rápido", contador: n.sem_preco, dica: "Produtos ativos sem nenhum preço" },
        { href: "/estoque/precos", texto: "Preços por planilha" },
        { href: "/produtos/kits", texto: "Kits capilares (montar)" },
        { href: "/produtos/grupos", texto: "Fragrâncias agrupadas", dica: "Mesmo produto em várias fragrâncias vira um cartão só no site" },
        { href: "/produtos/fotos", texto: "Fotos do catálogo", contador: n.fotos, dica: "Fotos esperando conferência" },
        { href: "/produtos/fotos-faltando", texto: "Buscar fotos", dica: "Produtos sem foto: procure no Google e arraste a foto aprovada" },
      ] : [{ href: "/produtos?filtro=sem-foto", texto: "Sem foto" }]),
      { href: "/produtos?filtro=inativos", texto: "Inativos" },
    ] },
    { id: "estoque", titulo: "Estoque e compras", icone: "estoque", itens: [
      { href: "/estoque", texto: "Saldo e movimentos" },
      { href: "/estoque/inventario", texto: "Inventário (contagem)" },
      { href: "/relatorios?aba=estoque", texto: "Para comprar / estoque baixo" },
      { href: "/relatorios/compra", texto: "Planejar compra por marca", dica: "Escolha a marca: estoque, venda por mês, quando acaba e quanto comprar" },
      ...(gestao ? [{ href: "/inteligencia?aba=compras", texto: "Compras e fornecedores", dica: "Compras com frete e câmbio, e prazo de reposição" }] : []),
      { href: "/estoque/historico", texto: "Histórico do estoque", dica: "Quem mexeu no estoque, quando e em quais produtos" },
      ...(gestao ? [{ href: "/estoque/importar", texto: "Importar do Bling" }] : []),
    ] },
    { id: "site", titulo: "Loja e marketing", icone: "site", itens: [
      { href: "/promocoes", texto: "Promoções" },
      { href: "/catalogo", texto: "Catálogo para enviar", dica: "Catálogo por marca com fotos e preços, para salvar em PDF e mandar no WhatsApp" },
      { href: "/site", texto: "Banners e destaques" },
      ...(gestao ? [
        { href: "/inteligencia?aba=retirada", texto: "Retire em Foz", dica: "Clientes locais e simulação do desconto por caixa retirada" },
        { href: "/relatorios?aba=site", texto: "Funil do site", dica: "Visitas, carrinhos, pedidos e o que os clientes procuram" },
        { href: "/abertura", texto: "Abertura da loja", dica: "O que falta para os clientes comprarem pelo site" },
      ] : []),
    ] },
    ...(gestao ? [{ id: "inteligencia", titulo: "Inteligência comercial", icone: "inteligencia", itens: [
      { href: "/inteligencia?aba=marcas", texto: "Marcas do motor", dica: "Marcas que o motor usa como gatilho, papel e margem-alvo" },
      { href: "/inteligencia?aba=sugestoes", texto: "Sugestões de preço", dica: "Preço Normal e VIP sugerido para as marcas-gatilho (simulação)" },
      { href: "/inteligencia?aba=classificacao", texto: "Classificação e recomendações", dica: "Atração, rentabilidade, diferenciação e estoque parado, com o que fazer" },
      { href: "/inteligencia?aba=rentabilidade", texto: "Rentabilidade PY", dica: "Margem e preço mínimo por produto nas tabelas do Paraguai" },
      { href: "/inteligencia", texto: "Saúde dos dados", dica: "O que falta no cadastro para calcular margem e preço mínimo" },
    ] }] : []),
    { id: "relatorios", titulo: "Relatórios", icone: "relatorios", itens: [
      { href: "/relatorios", texto: "Resumo de vendas" },
      { href: "/relatorios?aba=produtos", texto: "Mais vendidos" },
      { href: "/relatorios?aba=catalogo", texto: "Saúde do catálogo" },
      ...(gestao ? [
        { href: "/relatorios?aba=lucro", texto: "Lucro e rankings" },
        { href: "/relatorios?aba=envios", texto: "Envios ao Paraguai" },
      ] : []),
    ] },
    gestao
      ? { id: "financeiro", titulo: "Financeiro", icone: "financeiro", itens: [
          { href: "/despesas", texto: "Despesas e contas", contador: n.contas_vencidas, dica: "Contas vencidas" },
          { href: "/comissoes", texto: "Comissões" },
        ] }
      : { id: "financeiro", titulo: "Comissão", icone: "financeiro", itens: [{ href: "/comissoes", texto: "Minha comissão" }] },
    { id: "admin", titulo: "Configurações", icone: "admin", itens: [
      ...(gestao ? [
        { href: "/parametros", texto: "Parâmetros" },
        { href: "/inteligencia?aba=custos", texto: "Custos e frete", dica: "Frete por marca, imposto e entrega usados nos cálculos" },
        { href: "/equipe", texto: "Equipe e acessos" },
      ] : []),
      { href: "/conta", texto: "Minha conta" },
    ] },
  ];


  // Cada pessoa vê só as áreas liberadas para ela (Equipe → Acessos)
  const grupos = todos
    .map((g) => ({ ...g, itens: g.itens.filter((i) => { const k = permissaoDoLink(i.href); return !k || pode(u, k); }) }))
    .filter((g) => g.itens.length > 0);

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
          {un.lista.length > 1 && (
            <nav className="troca-unidade" aria-label="Unidade">
              <a href="/unidade" className={!un.atual ? "atual" : ""} aria-current={!un.atual ? "true" : undefined}>Todas</a>
              {un.lista.map((x) => (
                <a key={x.id} href={`/unidade?d=${x.id}`} className={un.atual?.id === x.id ? "atual" : ""} aria-current={un.atual?.id === x.id ? "true" : undefined}
                   title={`Ver estoque e pedidos de ${x.nome}`}>{x.codigo === "loja-cde" ? "CD CDE" : x.codigo === "cd-foz" ? "CD Foz" : x.nome}</a>
              ))}
            </nav>
          )}
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
