import type { GrupoMenu } from "@/app/(app)/menu-lateral";

/** Contadores ao lado dos itens do menu (o que está esperando alguém). Zerados quando só se quer a lista de telas. */
export type Contadores = { pedidos_abertos: number; confirma_py: boolean; envios_py: number; contas_vencidas: number; procuras: number; fotos: number; sem_preco: number; fora_site: number; carrinhos: number; chegaram: number; descontos: number; remocoes: number; prod_pendentes: number; a_separar: number; transf_acao: number };

export const SEM_CONTADORES: Contadores = { pedidos_abertos: 0, confirma_py: false, envios_py: 0, contas_vencidas: 0, procuras: 0, fotos: 0, sem_preco: 0, fora_site: 0, carrinhos: 0, chegaram: 0, descontos: 0, remocoes: 0, prod_pendentes: 0, a_separar: 0, transf_acao: 0 };

/**
 * Todas as telas do sistema, agrupadas como no menu lateral. A mesma lista serve à busca do topo
 * (procurar "despesas" leva à tela de Contas a pagar). Quem não pode abrir uma tela não a vê (filtro no layout e na busca).
 */
export function montarMenu(gestao: boolean, n: Contadores, aprovar = 0): GrupoMenu[] {
  const todos: GrupoMenu[] = [
    gestao
      ? { id: "inicio", titulo: "Dashboard", icone: "inicio", itens: [
          { href: "/", texto: "Painel do dia", dica: "Pedidos, pagamentos, envios e pendências de hoje" },
          { href: "/aprovacoes", texto: "Aprovações", contador: aprovar, dica: "Pagamentos, descontos, remoções, crédito, metas, cliente local e envios: tudo que espera sua decisão, numa tela só" },
          { href: "/saude-financeira", texto: "Saúde financeira", dica: "Vendas, compras, despesas, margens e plano de ação (área do dono)" },
          { href: "/relatorios?aba=resultado", texto: "Resultado do mês" },
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
      ...(gestao ? [{ href: "/estoque/pedido-compra", texto: "Pedido de compra por marca", dica: "Lista da marca com custo sem frete: preencha as quantidades e exporte a planilha" }] : []),
      ...(gestao ? [{ href: "/estoque/notas", texto: "Notas a chegar", dica: "Lance a nota do fornecedor; o estoque sobe quando confirmar a chegada" }] : []),
      ...(gestao ? [{ href: "/inteligencia?aba=compras", texto: "Compras e fornecedores", dica: "Compras com frete e câmbio, e prazo de reposição" }] : []),
      ...(gestao ? [{ href: "/inteligencia/fornecedores", texto: "Comparativo de fornecedores", dica: "Cílios e unhas: onde comprar mais barato (Dafu, Zhang, Fonte da Beleza, Nexxo e outros), com a planilha" }] : []),
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
          { href: "/estoque/notas?de=financeiro", texto: "Notas de entrada (XML)", dica: "Mesma tela de Estoque → Notas a chegar" },
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
  return todos;
}
