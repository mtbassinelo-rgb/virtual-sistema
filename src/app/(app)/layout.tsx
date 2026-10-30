import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario, sair } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { PERFIS } from "@/lib/formato";
import { MenuLateral, type GrupoMenu } from "./menu-lateral";
import { FiltrosAutomaticos } from "./filtros-automaticos";
import { Atalhos, type Atalho } from "./atalhos";
import { OcultarValores } from "./ocultar-valores";
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
           app.pode_confirmar_envio_py() as confirma_py, (select count(*) from app.cde_chegando())::int as envios_py,
           ${gestao ? `(select count(*) from app.v_despesas where situacao = 'vencida')::int` : "0"} as contas_vencidas,
           ${gestao ? `(select count(*) from app.procuras where visto_em is null)::int` : "0"} as procuras,
           ${gestao ? `(select count(*) from app.fotos_catalogo where status = 'pendente')::int` : "0"} as fotos,
           (select count(*) from app.produtos p where p.ativo and not p.marketplace and not exists (select 1 from app.precos z where z.produto_id = p.id))::int as sem_preco,
           (select count(*) from app.produtos p where p.ativo and p.mostrar_no_site and (not exists (select 1 from app.precos z where z.produto_id = p.id and z.tabela = 'br_normal') or not exists (select 1 from app.precos z where z.produto_id = p.id and z.tabela = 'py_normal')))::int as fora_site,
           (select count(*) from app.carrinhos_parados() where avisado_em is null)::int as carrinhos,
           (select count(*) from app.procuras_chegaram())::int as chegaram,
           (select count(*) from app.pedidos where desconto_qtd_status = 'pendente' and status_comercial <> 'cancelado')::int as descontos,
           ${gestao ? `(select count(distinct pedido_id) from app.pedido_remocoes where status = 'pendente')::int` : "0"} as remocoes,
           ${gestao ? `(select count(*) from app.produtos_pendentes where status = 'pendente')::int` : "0"} as prod_pendentes,
           ((select count(*) from app.pedidos where status_comercial = 'em_separacao' and origem <> 'bling' and separacao_conferida_em is null and app.pode_operar_deposito(deposito_id))
            + (select count(*) from app.transferencias where status = 'solicitada' and app.pode_separar_transferencia(origem_id)))::int as a_separar,
           (select count(*) from app.transferencias where (status = 'separada' and app.pode_aprovar_transferencia())
               or (status = 'enviada' and (app.pode_operar_deposito(destino_id) or app.trabalha_na_unidade(destino_id))))::int as transf_acao
  `)).rows[0] as { pedidos_abertos: number; confirma_py: boolean; envios_py: number; contas_vencidas: number; procuras: number; fotos: number; sem_preco: number; fora_site: number; carrinhos: number; chegaram: number; descontos: number; remocoes: number; prod_pendentes: number; a_separar: number; transf_acao: number }).catch(() => ({ pedidos_abertos: 0, confirma_py: false, envios_py: 0, contas_vencidas: 0, procuras: 0, fotos: 0, sem_preco: 0, fora_site: 0, carrinhos: 0, chegaram: 0, descontos: 0, remocoes: 0, prod_pendentes: 0, a_separar: 0, transf_acao: 0 }));

  // Menu: Dashboard → operação do dia (vendas, clientes) → cadastro (produtos, estoque) → loja e marketing → análise → financeiro → configurações
  const todos: GrupoMenu[] = [
    gestao
      ? { id: "inicio", titulo: "Dashboard", icone: "inicio", itens: [
          { href: "/", texto: "Painel do dia", dica: "Pedidos, pagamentos, envios e pendências de hoje" },
          { href: "/saude-financeira", texto: "Saúde financeira", dica: "Vendas, compras, despesas, margens e plano de ação (área do dono)" },
          { href: "/relatorios?aba=resultado", texto: "Resultado do mês" },
          { href: "/inteligencia/fornecedores", texto: "Comparativo de fornecedores", dica: "Cílios e unhas: onde comprar mais barato (Dafu, Zhang, Fonte da Beleza, Nexxo e outros), com a planilha" },
        ] }
      : { id: "inicio", titulo: "Início", icone: "inicio", itens: [{ href: "/", texto: "Meu dia" }] },
    { id: "vendas", titulo: "Vendas", icone: "vendas", itens: [
      { href: "/pedidos", texto: "Pedidos", contador: n.pedidos_abertos, dica: "Pedidos abertos: em separação ou aguardando" },
      { href: "/pedidos/novo", texto: "Novo pedido" },
      ...(n.confirma_py ? [{ href: "/pedidos/envios-py", texto: "Chegando na CDE", contador: n.envios_py, dica: "O que saiu do CD com o passeiro: envios para outras cidades e retiradas na loja, com os itens" }] : []),
      ...(gestao ? [{ href: "/desempenho", texto: "Desempenho das vendedoras", dica: "Pelo WhatsApp de cada número: atendimento, tempo de resposta, quem chamou, fechamento e vendas" }] : []),
      { href: "/orcamentos", texto: "Orçamentos", dica: "Orçamento para cliente (ou para quem ainda não é): WhatsApp, depois vira pedido" },
      { href: "/caixa", texto: "Caixa do dia", dica: "Abrir e fechar o caixa, vender no balcão e receber pedidos" },
      { href: "/caixa/contas", texto: "Contas da unidade", dica: "Contas a pagar da unidade em que você trabalha (ex.: CDE)" },
      ...(gestao ? [{ href: "/pedidos?desconto=pendente", texto: "Descontos a liberar", contador: n.descontos, dica: "Pedidos do site que atingiram o desconto por quantidade: o gerente libera ou não" }] : []),
      ...(gestao ? [{ href: "/pedidos?remocao=pendente", texto: "Tirar produto: autorizar", contador: n.remocoes, dica: "Vendedora pediu para tirar um produto sem estoque do pedido (cliente não quis trocar)" }] : []),
    ] },
    { id: "marketplace", titulo: "Marketplace", icone: "marketplace", itens: [
      { href: "/marketplace", texto: "Visão geral", dica: "Shopee, Mercado Livre, TikTok: vendas do mês e o que pede atenção" },
      { href: "/marketplace?aba=anuncios", texto: "Anúncios e kits", dica: "Kits dos marketplaces, composição, quanto dá para montar e o que mais vende" },
      { href: "/estoque/marketplace", texto: "Lançar vendas do dia", dica: "Relatório do dia: pedidos entram e o estoque sai" },
      ...(gestao ? [{ href: "/marketplace/conexoes", texto: "Conectar Shopee / Mercado Livre", dica: "Pedidos chegam sozinhos e viram envios para o estoquista" }] : []),
    ] },
    { id: "clientes", titulo: "Clientes", icone: "clientes", itens: [
      { href: "/clientes/recompra", texto: "Recompra (quem chamar)", dica: "Clientes que passaram do ritmo normal de compra, com WhatsApp pronto" },
      { href: "/clientes", texto: "Clientes" },
      { href: "/clientes/carrinhos", texto: "Carrinhos parados", contador: n.carrinhos, dica: "Clientes que montaram carrinho e não enviaram" },
      { href: "/procuras", texto: gestao ? "Procurados sem estoque" : "Cliente pediu e não temos", contador: gestao ? n.procuras + n.chegaram : n.chegaram,
        dica: "Produtos pedidos que estavam esgotados e os que já chegaram: avisar o cliente" },
      { href: "/metas", texto: "Metas" },
    ] },
    { id: "whatsapp", titulo: "WhatsApp", icone: "whatsapp", itens: [
      { href: "/whatsapp", texto: "Acompanhamento", dica: "Mensagens enviadas e recebidas, tempo de resposta, quem está esperando e pedidos de cada conversa" },
      { href: "/whatsapp?f=aguardando&o=espera", texto: "Esperando resposta", dica: "Conversas em que a última mensagem foi do cliente" },
      { href: "/whatsapp/conexoes", texto: "Conexões (QR Code)", dica: "Conectar os números da equipe" },
    ] },
    { id: "produtos", titulo: "Produtos", icone: "produtos", itens: [
      { href: "/produtos/pendentes", texto: "Novos produtos (pendentes)", contador: n.prod_pendentes, dica: "Vendedora fotografa o produto com quantidade e preço; o gerente clica em Atualizar" },
      { href: "/produtos", texto: "Todos os produtos" },
      { href: "/produtos/vendas", texto: "Vendas por produto", dica: "Quem comprou um produto, quanto, a que preço e quando" },
      ...(gestao ? [
        { href: "/produtos/novo", texto: "Novo produto" },
        { href: "/produtos/precos-rapido", texto: "Editar preços rápido", contador: n.sem_preco, dica: "Produtos ativos sem nenhum preço" },
        { href: "/produtos?filtro=fora-do-site", texto: "Sem preço (fora do site)", contador: n.fora_site, dica: "Sem preço Normal em R$ ou em Gs: ficam ocultos no site para quem não tem o preço. Arrume e eles voltam a aparecer" },
        { href: "/estoque/precos", texto: "Preços por planilha" },
        { href: "/produtos/precos-cde", texto: "Preços da loja CDE" },
        { href: "/produtos/custos", texto: "Revisar custos", dica: "Custo da caixa gravado como custo da unidade" },
        { href: "/produtos/kits", texto: "Kits capilares (montar)" },
        { href: "/produtos/grupos", texto: "Fragrâncias agrupadas", dica: "Mesmo produto em várias fragrâncias vira um cartão só no site" },
        { href: "/produtos/fotos", texto: "Fotos do catálogo", contador: n.fotos, dica: "Fotos esperando conferência" },
        { href: "/produtos/marcas", texto: "Marcas", dica: "Juntar marcas escritas diferente e renomear" },
        { href: "/produtos/categorias", texto: "Categorias do site", dica: "Em que categoria cada produto aparece na loja: mudar, somar outra categoria, trocar marca em massa" },
        { href: "/produtos/fotos-faltando", texto: "Buscar fotos", dica: "Produtos sem foto: procure no Google e arraste a foto aprovada" },
      ] : [{ href: "/produtos?filtro=sem-foto", texto: "Sem foto" }]),
      { href: "/produtos?filtro=inativos", texto: "Inativos" },
    ] },
    { id: "estoque", titulo: "Estoque e compras", icone: "estoque", itens: [
      { href: "/estoque/separacao", texto: "Área do estoquista", contador: n.a_separar, dica: "Pedidos e transferências a separar" },
      { href: "/estoque/transferencias", texto: "Pedidos entre unidades", contador: n.transf_acao, dica: "A aprovar ou a receber" },
      { href: "/estoque", texto: "Saldo e movimentos" },
      { href: "/estoque/inventario", texto: "Inventário (contagem)" },
      { href: "/relatorios?aba=estoque", texto: "Para comprar / estoque baixo" },
      { href: "/relatorios/compra", texto: "Planejar compra por marca", dica: "Escolha a marca: estoque, venda por mês, quando acaba e quanto comprar" },
      ...(gestao ? [{ href: "/estoque/notas", texto: "Notas a chegar", dica: "Lance a nota do fornecedor; o estoque sobe quando confirmar a chegada" }] : []),
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
      { href: "/inteligencia/precificacao", texto: "Precificação", dica: "Custo, frete, caixa e preços PY numa tabela editável, com margem e preço sugerido" },
      { href: "/inteligencia?aba=classificacao", texto: "Classificação e recomendações", dica: "Atração, rentabilidade, diferenciação e estoque parado, com o que fazer" },
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
          { href: "/unidades", texto: "Painel das unidades", dica: "Geral, CD Foz e CDE: vendas, lucro, despesas, caixa, estoque" },
          { href: "/financeiro", texto: "Painel financeiro", dica: "DRE, ponto de equilíbrio, lucro por marca e cliente, metas" },
          { href: "/despesas", texto: "Contas a pagar", contador: n.contas_vencidas, dica: "Contas vencidas" },
          { href: "/financeiro/receber", texto: "Contas a receber" },
          { href: "/financeiro/vendas-avulsas", texto: "Vendas avulsas", dica: "Vendas fora do sistema, lançadas só pelo valor" },
          { href: "/estoque/notas", texto: "Notas de entrada (XML)" },
          { href: "/comissoes", texto: "Comissões" },
        ] }
      : { id: "financeiro", titulo: "Comissão", icone: "financeiro", itens: [{ href: "/comissoes", texto: "Minha comissão" }] },
    { id: "rh", titulo: gestao ? "RH e calendário" : "Calendário", icone: "rh", itens: [
      ...(gestao ? [
        { href: "/rh", texto: "Painel do RH", dica: "Férias, fim de experiência, aniversários e datas que estão chegando" },
        { href: "/rh/funcionarios", texto: "Funcionários", dica: "Cadastro, salário, comissão, contrato e contatos" },
        { href: "/rh/ferias", texto: "Férias", dica: "Saldo, prazo e férias programadas" },
        { href: "/rh/aniversariantes", texto: "Aniversariantes do mês" },
      ] : []),
      { href: "/calendario", texto: "Calendário comercial", dica: "Datas do Brasil e do Paraguai com dicas de vendas e eventos do mês" },
    ] },
    { id: "admin", titulo: "Configurações", icone: "admin", itens: [
      ...(gestao ? [
        { href: "/parametros", texto: "Parâmetros" },
        { href: "/inteligencia?aba=custos", texto: "Custos e frete", dica: "Frete por marca, imposto e entrega usados nos cálculos" },
        { href: "/equipe", texto: "Equipe e acessos" },
      ] : []),
      { href: "/conta", texto: "Minha conta" },
    ] },
  ];


  // Menu simples por função: cada pessoa vê só o que usa no dia a dia (pode abrir o menu completo no rodapé).
  const ESSENCIAL: Partial<Record<string, string[]>> = {
    vendedora: ["/", "/pedidos", "/pedidos/novo", "/orcamentos", "/clientes", "/clientes/recompra", "/procuras", "/produtos", "/produtos/vendas", "/catalogo", "/comissoes", "/whatsapp", "/conta"],
    estoquista: ["/", "/estoque/separacao", "/estoque/transferencias", "/estoque", "/estoque/inventario", "/pedidos", "/produtos", "/conta"],
  };
  const essencial = ESSENCIAL[u.perfil];
  const extras = n.confirma_py && !gestao ? ["/pedidos/envios-py", "/caixa", "/caixa/contas", "/estoque/transferencias"] : [];
  const menuCompleto = (await cookies()).get("menu_completo")?.value === "1";
  const simples = Boolean(essencial) && !menuCompleto;
  // Cada pessoa vê só as áreas liberadas para ela (Equipe → Acessos)
  const grupos = todos
    .map((g) => ({ ...g, itens: g.itens.filter((i) => { const k = permissaoDoLink(i.href); return !k || pode(u, k); })
      .filter((i) => !simples || essencial!.includes(i.href) || extras.includes(i.href)) }))
    .filter((g) => g.itens.length > 0);

  // Teclas de atalho (só das telas que a pessoa pode abrir)
  const liberado = (href: string) => { const k = permissaoDoLink(href); return !k || pode(u, k); };
  const atalhos: Atalho[] = ([
    { tecla: "N", href: "/pedidos/novo", texto: "Novo pedido" },
    { tecla: "P", href: "/pedidos", texto: "Pedidos" },
    { tecla: "O", href: "/orcamentos/novo", texto: "Novo orçamento" },
    { tecla: "C", href: "/clientes", texto: "Clientes" },
    { tecla: "X", href: "/caixa", texto: "Caixa do dia" },
    { tecla: "W", href: "/whatsapp?f=aguardando&o=espera", texto: "WhatsApp esperando resposta" },
    { tecla: "R", href: "/produtos", texto: "Produtos" },
    { tecla: "V", href: "/produtos/vendas", texto: "Vendas por produto" },
    { tecla: "E", href: "/estoque/separacao", texto: "Área do estoquista (separar e envios)" },
    { tecla: "T", href: "/estoque/transferencias/nova", texto: "Pedir mercadoria à outra unidade" },
    { tecla: "S", href: "/estoque", texto: "Saldo do estoque" },
    { tecla: "M", href: "/marketplace", texto: "Marketplace" },
    { tecla: "H", href: "/", texto: "Início (painel do dia)" },
  ] as Atalho[]).filter((a) => liberado(a.href));
  const rapidos = atalhos.filter((a) => (u.perfil === "estoquista" ? ["E", "T"] : ["N", "O", "X"]).includes(a.tecla));

  return (
    <div className="casca">
      <aside className="lateral">
        <Link href="/" className="marca-lateral">
          <img src="/marca/icone.png" width={34} height={32} alt="" />
          <span>Virtual Cosméticos<small>Sistema comercial</small></span>
        </Link>
        <Suspense fallback={null}><MenuLateral grupos={grupos} /></Suspense>
        <div className="lateral-rodape">
          {essencial && <a href={`/menu?completo=${simples ? "1" : "0"}`}>{simples ? "Ver menu completo" : "Voltar ao menu simples"}</a>}
          <a href="/loja" target="_blank" rel="noopener noreferrer">Ver a loja como cliente ↗</a>
        </div>
      </aside>
      <div className="principal-area">
        <header className="barra-topo">
          <form action="/busca" className="busca-geral" role="search">
            <label className="sr-only" htmlFor="busca-geral">Buscar no sistema</label>
            <input id="busca-geral" name="q" type="search" placeholder="Buscar produto, cliente ou pedido…" autoComplete="off" />
          </form>
          <Atalhos atalhos={atalhos} rapidos={rapidos} />
          <OcultarValores />
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
        <Suspense fallback={null}><FiltrosAutomaticos /></Suspense>
      </div>
    </div>
  );
}
