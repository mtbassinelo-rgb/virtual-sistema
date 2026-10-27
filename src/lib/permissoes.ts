/**
 * Permissões por área do sistema. Cada perfil tem um padrão; na tela Equipe o gerente liga ou desliga áreas de cada pessoa
 * (fica guardado só o que difere do padrão). Áreas marcadas "só gestão" dependem de regras do banco que só gerente e dono
 * passam, então não podem ser dadas a vendedora ou estoquista.
 */
export type Perfil = "dono" | "gerente" | "vendedora" | "consulta" | "estoquista";

export type Permissao = { chave: string; nome: string; rotas: string[]; gestao?: boolean; soDono?: boolean };

export const PERMISSOES: Permissao[] = [
  { chave: "pedidos", nome: "Pedidos e orçamentos (ver, criar e separar)", rotas: ["/pedidos", "/orcamentos"] },
  { chave: "caixa", nome: "Caixa do dia", rotas: ["/caixa"] },
  { chave: "clientes", nome: "Clientes", rotas: ["/clientes"] },
  { chave: "metas", nome: "Metas", rotas: ["/metas"] },
  { chave: "whatsapp", nome: "Acompanhamento do WhatsApp (vendedora vê só o número dela)", rotas: ["/whatsapp"] },
  { chave: "desempenho", nome: "Desempenho das vendedoras (WhatsApp)", rotas: ["/desempenho"], gestao: true },
  { chave: "whatsapp_conexoes", nome: "Conectar números de WhatsApp (QR Code)", rotas: ["/whatsapp/conexoes"], gestao: true },
  { chave: "promocoes", nome: "Promoções", rotas: ["/promocoes"] },
  { chave: "catalogo", nome: "Catálogo para enviar", rotas: ["/catalogo"] },
  { chave: "procuras", nome: "Produtos procurados", rotas: ["/procuras"] },
  { chave: "produtos", nome: "Ver produtos", rotas: ["/produtos"] },
  { chave: "produtos_editar", nome: "Cadastrar produtos, preços, kits e fotos", gestao: true,
    rotas: ["/produtos/novo", "/produtos/precos-rapido", "/produtos/precos-cde", "/produtos/custos", "/produtos/kits", "/produtos/grupos", "/produtos/categorias", "/produtos/subcategorias", "/produtos/marcas", "/produtos/fotos", "/produtos/fotos-faltando", "/estoque/precos"] },
  { chave: "estoque", nome: "Estoque (saldos, movimentos, compras)", rotas: ["/estoque"] },
  { chave: "separacao", nome: "Área do estoquista: separar pedidos e pedidos entre unidades", rotas: ["/estoque/separacao", "/estoque/transferencias"] },
  { chave: "inventario", nome: "Balanço de estoque (contagem)", rotas: ["/estoque/inventario"] },
  { chave: "estoque_historico", nome: "Histórico de movimentos do estoque (inclui vendas)", rotas: ["/estoque/historico"] },
  { chave: "marketplace", nome: "Vendas Shopee / Mercado Livre", rotas: ["/estoque/marketplace"] },
  { chave: "estoque_importar", nome: "Importar estoque do Bling", rotas: ["/estoque/importar"], gestao: true },
  { chave: "estoque_notas", nome: "Notas a chegar (entrada de compra)", rotas: ["/estoque/notas"], gestao: true },
  { chave: "relatorios", nome: "Relatórios", rotas: ["/relatorios"] },
  { chave: "comissoes", nome: "Comissões", rotas: ["/comissoes"] },
  { chave: "inteligencia", nome: "Inteligência comercial (rentabilidade e custos)", rotas: ["/inteligencia"], gestao: true },
  { chave: "financeiro", nome: "Financeiro: painel, contas a pagar e a receber, parâmetros", rotas: ["/financeiro", "/unidades", "/despesas", "/parametros"], gestao: true },
  // Área exclusiva do dono: ninguém recebe por padrão e só o dono libera para alguém (Equipe → Acessos)
  { chave: "saude_financeira", nome: "Saúde financeira (área do dono)", rotas: ["/saude-financeira"], gestao: true, soDono: true },
  { chave: "site", nome: "Loja online (banners e destaques)", rotas: ["/site"] },
  { chave: "abertura", nome: "Abertura da loja", rotas: ["/abertura"], gestao: true },
  { chave: "equipe", nome: "Equipe e acessos", rotas: ["/equipe"], gestao: true },
  { chave: "marketplace", nome: "Marketplace (Shopee, Mercado Livre, TikTok): anúncios, kits e vendas", rotas: ["/marketplace"] },
  { chave: "rh", nome: "RH: funcionários, salários, férias e aniversários", rotas: ["/rh"], gestao: true },
  { chave: "calendario", nome: "Calendário comercial (datas e dicas de vendas)", rotas: ["/calendario"] },
];

const TODAS = PERMISSOES.filter((p) => !p.soDono).map((p) => p.chave);
const PADRAO: Record<Perfil, string[]> = {
  dono: TODAS,
  gerente: TODAS,
  consulta: TODAS.filter((c) => c !== "caixa" && c !== "equipe" && c !== "rh"),
  // Vendedora: só a área dela (pedidos e clientes dela, metas, comissão, catálogo e produtos sem custo). Sem estoque geral nem relatórios da empresa.
  vendedora: ["pedidos", "caixa", "clientes", "metas", "promocoes", "catalogo", "procuras", "produtos", "separacao", "inventario", "comissoes", "calendario"],
  // Estoquista: funções de estoque (saldos, entrada, transferências, separação, balanço), sem vendas, custo nem histórico de movimentos
  estoquista: ["estoque", "separacao", "inventario"],
};

/** Só o dono pode ligar ou desligar esta área para alguém. */
export const soDono = (chave: string) => Boolean(PERMISSOES.find((p) => p.chave === chave)?.soDono);

export const PERFIL_GESTAO = (p: string) => p === "dono" || p === "gerente" || p === "consulta";

/** A área pode ser ligada para este perfil? (as "só gestão" não podem para vendedora/estoquista) */
export const permitidaParaPerfil = (perfil: string, chave: string) =>
  !PERMISSOES.find((p) => p.chave === chave)?.gestao || PERFIL_GESTAO(perfil);

export const padraoDoPerfil = (perfil: string, chave: string) =>
  (PADRAO[perfil as Perfil] ?? []).includes(chave) && permitidaParaPerfil(perfil, chave);

/** Pode usar a área? Dono: sempre. Senão: o que foi ligado/desligado para a pessoa, ou o padrão do perfil. */
export function pode(u: { perfil: string; permissoes?: Record<string, boolean> | null }, chave: string): boolean {
  if (u.perfil === "dono") return true;
  if (!permitidaParaPerfil(u.perfil, chave)) return false;
  const o = u.permissoes?.[chave];
  return typeof o === "boolean" ? o : padraoDoPerfil(u.perfil, chave);
}

/** Qual permissão protege este caminho (a rota mais específica que bate). null = livre (Início, Minha conta, busca...). */
export function permissaoDaRota(caminho: string): string | null {
  let melhor: string | null = null, tam = -1;
  for (const p of PERMISSOES) for (const r of p.rotas) {
    if ((caminho === r || caminho.startsWith(r + "/")) && r.length > tam) { melhor = p.chave; tam = r.length; }
  }
  return melhor;
}

/** Permissão de um link do menu (ignora ?filtros). */
export const permissaoDoLink = (href: string) => permissaoDaRota(href.split("?")[0]);
