/**
 * Levantamento financeiro da distribuidora (fotografia de 20/10/2026).
 * Fontes: planilhas "Distribuidora – Controle Mensal", "Central Financeira 2026" e "Financas 2026".
 * Valores em milhões de Gs, salvo quando indicado. Para atualizar, troque os números aqui
 * (ou, quando as compras e despesas estiverem no sistema, passe a calcular a partir do banco).
 */

export const LEVANTAMENTO = {
  data: "2026-10-20",
  relatorio: "https://claude.ai/code/artifact/ffe6d166-0b2a-4f8a-a408-884fb6f51116",

  resumo: {
    vendas: 1063.3,
    compras: 743.6,
    despesas: 82.6,
    resultado: 237.1,
    margem: 22.3,
    empate: 92,
    concentracaoKeila: "66–71%",
  },

  /** Vendas por mês (mi Gs): recorrente + pedido pontual */
  vendasMensais: [
    { mes: "2025-05", recorrente: 107.6, pontual: 0 },
    { mes: "2025-06", recorrente: 114.4, pontual: 0 },
    { mes: "2025-07", recorrente: 131.5, pontual: 0 },
    { mes: "2025-08", recorrente: 123.2, pontual: 0 },
    { mes: "2025-09", recorrente: 145.6, pontual: 0 },
    { mes: "2025-10", recorrente: 154.3, pontual: 0 },
    { mes: "2025-11", recorrente: 130.9, pontual: 0 },
    { mes: "2025-12", recorrente: 125.1, pontual: 0 },
    { mes: "2026-01", recorrente: 132.9, pontual: 0 },
    { mes: "2026-02", recorrente: 193.9, pontual: 0 },
    { mes: "2026-03", recorrente: 239.5, pontual: 0 },
    { mes: "2026-04", recorrente: 263.9, pontual: 0 },
    { mes: "2026-05", recorrente: 255.4, pontual: 0 },
    { mes: "2026-06", recorrente: 215.8, pontual: 0 },
    { mes: "2026-07", recorrente: 300.2, pontual: 0 },
    { mes: "2026-08", recorrente: 358.4, pontual: 0 },
    { mes: "2026-09", recorrente: 263.9, pontual: 140.7 },
  ],
  metaMensal: 293.9,

  /** Vendas por canal (mi Gs) */
  canais: [
    { canal: "Keila", jul: 206.0, ago: 238.4, set: 187.0, meta: 200.0 },
    { canal: "Yessica", jul: 73.0, ago: 96.3, set: 58.6, meta: 70.0 },
    { canal: "Marketplace (Shopee + ML)", jul: 17.0, ago: 17.0, set: 14.3, meta: 17.1 },
    { canal: "Crislaine (Brasil)", jul: 4.2, ago: 6.6, set: 4.0, meta: 6.8 },
  ],

  /** Resultado de caixa (mi Gs) */
  resultado: [
    { mes: "2026-07", vendas: 300.2, compras: 196.8, despesas: 24.5, resultado: 79.0, nota: "" },
    { mes: "2026-08", vendas: 358.4, compras: 277.2, despesas: 29.4, resultado: 51.8, nota: "Inclui a Castanha da Índia (28,8 mi) que estava fora da aba Compras" },
    { mes: "2026-09", vendas: 404.7, compras: 269.6, despesas: 28.7, resultado: 106.4, nota: "Inclui o pedido pontual do Freddy (140,7 mi)" },
  ],

  /** Compras com frete por fornecedor, jul a 20/out/26 (R$) */
  compras: {
    total: 681553,
    frete: 42396,
    fretePct: 6.6,
    cambio: [
      { mes: "2026-07", produtos: 161650, frete: 9035, cambio: 1153, totalGs: 196.8 },
      { mes: "2026-08", produtos: 203557, frete: 13162, cambio: 1146, totalGs: 248.4 },
      { mes: "2026-09", produtos: 219128, frete: 17599, cambio: 1139, totalGs: 269.6 },
      { mes: "2026-10", produtos: 54821, frete: 2600, cambio: 1120, totalGs: 64.3 },
    ],
    fornecedores: [
      { nome: "Soul", reais: 237364, fretePct: 7 },
      { nome: "Maycrene", reais: 120511, fretePct: 12 },
      { nome: "Rhenuks", reais: 91390, fretePct: 7 },
      { nome: "Bio Instinto", reais: 79762, fretePct: 7 },
      { nome: "Zap", reais: 28375, fretePct: 8 },
      { nome: "Nelo", reais: 20524, fretePct: 4 },
      { nome: "Farmax", reais: 17642, fretePct: 0 },
      { nome: "Super Poderes", reais: 14314, fretePct: 0 },
      { nome: "Papel para Mecha", reais: 13147, fretePct: 0 },
      { nome: "Lua e Neve", reais: 12938, fretePct: 0 },
      { nome: "Phallebeauty", reais: 12325, fretePct: 0 },
      { nome: "Fashion", reais: 8880, fretePct: 0 },
      { nome: "Maria Escandalosa", reais: 8850, fretePct: 3 },
      { nome: "Outros (4 fornecedores)", reais: 15531, fretePct: 0 },
    ],
  },

  /** Despesas (mi Gs) */
  despesas: [
    { tipo: "Salários", jul: 8.70, ago: 9.13, set: 9.13 },
    { tipo: "Aluguel (R$ 5.000)", jul: 4.08, ago: 6.20, set: 6.20 },
    { tipo: "Pasero", jul: 6.70, ago: 8.60, set: 7.90 },
    { tipo: "Comissões", jul: 5.00, ago: 5.47, set: 5.47 },
  ],
  despesasFaltando: [
    "Taxas de Shopee e Mercado Livre (R$ 5 a 6 mil por mês)",
    "Aduana e transportadora",
    "Bling, servidor do sistema e telefones",
    "Custos da Crislaine no Brasil (R$ 2,7 a 2,8 mil por mês)",
  ],

  /** Margem média do preço VIP em Gs sobre custo com frete (%) */
  margens: [
    { fornecedor: "Cap Life", produtos: 15, planilha: 18.8, real: 30.0 },
    { fornecedor: "Nívea", produtos: 1, planilha: 21.6, real: 32.5 },
    { fornecedor: "Lua e Neve", produtos: 5, planilha: 22.6, real: 33.3 },
    { fornecedor: "Zap", produtos: 15, planilha: 23.6, real: 34.1 },
    { fornecedor: "Magic Color", produtos: 3, planilha: 24.8, real: 35.2 },
    { fornecedor: "Fashion", produtos: 6, planilha: 25.4, real: 35.8 },
    { fornecedor: "Bonequinha / Maria Escandalosa", produtos: 17, planilha: 27.3, real: 37.4 },
    { fornecedor: "Papel para Mecha", produtos: 5, planilha: 27.6, real: 37.6 },
    { fornecedor: "Maycrene", produtos: 15, planilha: 31.7, real: 41.2 },
    { fornecedor: "Naxos", produtos: 5, planilha: 32.4, real: 41.7 },
    { fornecedor: "Phallebeauty", produtos: 12, planilha: 32.5, real: 41.8 },
    { fornecedor: "Makiaj", produtos: 4, planilha: 33.1, real: 42.4 },
    { fornecedor: "Nelo", produtos: 4, planilha: 33.5, real: 42.7 },
    { fornecedor: "CBB", produtos: 1, planilha: 35.0, real: 44.0 },
    { fornecedor: "Farmax", produtos: 2, planilha: 35.6, real: 44.5 },
    { fornecedor: "Bio Instinto", produtos: 19, planilha: 37.4, real: 46.1 },
    { fornecedor: "Super Poderes", produtos: 20, planilha: 38.2, real: 46.7 },
    { fornecedor: "Fonte da Beleza", produtos: 8, planilha: 38.4, real: 46.9 },
    { fornecedor: "Sexy Fantasy", produtos: 5, planilha: 40.1, real: 48.4 },
    { fornecedor: "Shine", produtos: 7, planilha: 41.1, real: 49.2 },
    { fornecedor: "Rhenuks", produtos: 14, planilha: 43.0, real: 50.9 },
    { fornecedor: "Soul", produtos: 33, planilha: 45.0, real: 52.6 },
    { fornecedor: "Real Love", produtos: 5, planilha: 45.4, real: 52.9 },
  ],
  margemMedia: { planilha: 34, real: 43, normalReal: 48 },

  alertas: [
    { titulo: "Setembro recorrente caiu 26%", texto: "Sem o pedido do Freddy, setembro vendeu 264 mi Gs contra 358 mi em agosto. Keila (−22%), Yessica (−39%) e marketplace caíram juntos." },
    { titulo: "Dependência da Keila", texto: "Ela responde por 66–71% das vendas recorrentes." },
    { titulo: "Planilhas não batem", texto: "Na Central Financeira a distribuidora recebe só as vendas da Keila e paga todas as compras; as vendas da Yessica entram como Top Cosméticos sem custo. Por isso a distribuidora aparece com prejuízo em maio e agosto." },
    { titulo: "Reais lançados como guaranis", texto: "Crislaine e marketplace foram lançados em R$ como se fossem milhares de Gs (R$ 14.289 virou 14.289.000 Gs): vendas desses canais ficam ~12% abaixo." },
    { titulo: "Dinheiro da empresa para outros fins", texto: "Em set/26, R$ 14,3 mil dos câmbios foram para Móveis, Efetivo e Compra Terra, e R$ 8,8 mil para destinos sem identificação. Lançar como retirada do dono." },
    { titulo: "Outubro sem vendas", texto: "Até 20/10 há 64,3 mi Gs em compras e 11,6 mi em despesas, mas nenhuma venda lançada." },
  ],

  plano: [
    { grupo: "Corrigir agora", itens: [
      "Lançar as vendas de outubro (Keila, Yessica, Crislaine, marketplace)",
      "Informar o valor em reais da Castanha da Índia de agosto",
      "Converter Crislaine e marketplace de R$ para Gs pelo câmbio do mês, com as taxas como despesa",
      "Juntar Distribuidora e Top Cosméticos numa só linha na Central Financeira",
      "Lançar Pasero e comissões de outubro",
    ] },
    { grupo: "Passar a medir todo mês", itens: [
      "Saldo de caixa e contas no fim do mês",
      "Contas a receber de clientes e contas a pagar a fornecedores",
      "Valor do estoque (Foz e CDE) pelo custo com frete",
      "Retiradas do dono separadas das despesas da empresa",
      "Despesas que faltam: aduana, transportadora, Bling, servidor, telefones",
    ] },
    { grupo: "Proteger a margem", itens: [
      "Revisar os 15 produtos com margem VIP abaixo de 20% na planilha (9 da Cap Life)",
      "Atrelar as comissões a um percentual das vendas",
      "Reduzir a dependência da Keila: carteira e metas para Yessica e Crislaine",
      "Confirmar o frete real por unidade da Maycrene e atualizar a tabela de preços",
    ] },
  ],
} as const;
