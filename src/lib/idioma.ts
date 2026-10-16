import "server-only";
import { cookies, headers } from "next/headers";

export type Idioma = "pt" | "es";
export const COOKIE_IDIOMA = "vc_idioma";

/** Idioma do site: escolha do visitante (cookie) ou, na primeira visita, o idioma do navegador. */
export async function idiomaAtual(): Promise<Idioma> {
  const c = (await cookies()).get(COOKIE_IDIOMA)?.value;
  if (c === "pt" || c === "es") return c;
  const al = (await headers()).get("accept-language") ?? "";
  return /^es\b/i.test(al.trim()) ? "es" : "pt";
}

const PT = {
  buscar: "Buscar shampoo, matizador, kit…",
  querSerCliente: "Quero ser cliente",
  cadTitulo: "Quero ser cliente",
  cadTexto: "Preencha seus dados e a nossa equipe de vendas fala com você no WhatsApp com a tabela de atacado e o link de acesso aos seus preços.",
  cadNome: "Nome do salão ou da empresa", cadContato: "Seu nome", cadEmail: "E-mail", cadCidade: "Cidade",
  cadTipo: "Tipo de negócio", cadDoc: "CNPJ ou documento da empresa (opcional)", cadMsg: "O que você procura? (opcional)",
  cadTipos: { salao: "Salão de beleza", perfumaria: "Perfumaria", revenda: "Revendedora", farmacia: "Farmácia", loja: "Loja", outro: "Outro" } as Record<string, string>,
  cadEnviar: "Enviar cadastro pelo WhatsApp",
  cadAviso: "Ao enviar, abrimos o WhatsApp com os seus dados para confirmar o cadastro.",
  cadMsgZap: (d: Record<string, string>) =>
    `Olá! Quero ser cliente da Virtual Cosméticos.\nEmpresa: ${d.nome}${d.contato ? `\nContato: ${d.contato}` : ""}${d.cidade ? `\nCidade: ${d.cidade}` : ""}${d.tipo ? `\nTipo: ${d.tipo}` : ""}${d.email ? `\nE-mail: ${d.email}` : ""}${d.mensagem ? `\nProcuro: ${d.mensagem}` : ""}`,

  jaSouCliente: "Já sou cliente", meusPedidos: "Meus pedidos", pedido: "Pedido",
  categorias: "Categorias", verAgora: "Ver produtos", promocoes: "Promoções", maisVendidos: "Mais vendidos", destaques: "Destaques", marcas: "Marcas", novidades: "Novidades",
  verTodas: "Ver todas", verTodosKits: "Ver todos os kits", verTodasMarcas: "Ver todas as marcas", verTodasPromocoes: "Ver todas as promoções",
  kitsCompletos: "Kits completos", catalogo: "Catálogo", tudo: "Tudo",
  heroTitulo: "Distribuidora de cosméticos direto de fábrica em Foz do Iguaçu.",
  heroTexto: "Atacado para salões, perfumarias e revendedores, com preço de distribuidora e envio a partir de Foz do Iguaçu.",
  verProdutos: (n: string) => `Ver os ${n} produtos`,
  cartela: "Cartela de matizadores", cartelaLegenda: "Matizadores em todos os tons. Toque numa mecha para ver os produtos.",
  produto: "produto", produtos: "produtos",
  resultados: (q: string) => `Resultados para “${q}”`,
  limparBusca: "Limpar a busca", todasMarcas: "Todas as marcas", todosProdutos: "Todos os produtos",
  semPromocao: "Nenhuma promoção agora. Volte em breve ou peça no WhatsApp.",
  semResultado: (q: string) => `Nenhum produto${q ? ` com “${q}”` : " aqui"}. Tente outra palavra, como “shampoo” ou “kit”, ou peça no WhatsApp.`,
  anterior: "Anterior", proxima: "Próxima", pagina: (a: number, b: number) => `Página ${a} de ${b}`,
  comoComprar: "Como comprar",
  passos: [
    ["Monte o pedido", "Escolha os produtos e as quantidades aqui no site."],
    ["Envie pelo WhatsApp", "O pedido chega direto para a nossa equipe de vendas."],
    ["Receba o total", "Conferimos o estoque e enviamos o valor de atacado e os dados para pagamento."],
    ["Receba o pedido", "Enviamos a partir de Foz do Iguaçu."],
  ],
  ola: (n: string) => `Olá, ${n}.`,
  precosCliente: (vip: boolean, gs: boolean, vend: string) =>
    `Preços ${vip ? "VIP " : ""}em ${gs ? "guaranis" : "reais"}. Monte o pedido: ${vend} confere o estoque, confirma o total e envia os dados para pagamento.`,
  adicionar: "Adicionar", adicionarPedido: "Adicionar ao pedido",
  precoVendedora: "Preço com a vendedora", emEstoque: "Em estoque", ultimas: "Últimas unidades",
  encomenda: (p: string | null) => `Sob encomenda (${p ?? "alguns dias"})`, semEstoque: "Sem estoque agora: confirmamos o prazo",
  comprouEm: (d: string) => `Você comprou em ${d}`, kit: "Kit", maisVendido: "Mais vendido", novo: "Novo",
  rodapeTexto: "Distribuidora de cosméticos direto de fábrica em Foz do Iguaçu. Atacado para salões, perfumarias e revendedores.",
  atendimento: "Atendimento", rodapeZap: "Fale com a nossa equipe de vendas.",
  clientes: "Clientes", rodapeClientes: "Clientes cadastrados recebem um link de acesso com os preços de atacado.",
  atendimentoDe: (v: string) => `Atendimento: ${v}`, sair: "Sair da área do cliente",
  linhas: { kits: "Kits", matizadores: "Matizadores", cabelo: "Cabelo", corpo: "Corpo e banho", rosto: "Rosto", maquiagem: "Maquiagem", unhas: "Unhas e cílios", perfumaria: "Perfumaria", outros: "Outros" } as Record<string, string>,
  marcasTexto: (n: number) => `${n} marcas no catálogo. Toque numa marca para ver os produtos.`,
  zapMsg: "Olá! Quero comprar no atacado da Virtual Cosméticos.",
  idioma: "Español", idiomaCodigo: "es",
  // carrinho
  seuPedido: "Seu pedido", fechar: "Fechar",
  vazio: "Escolha os produtos e as quantidades no catálogo. Eles aparecem aqui.",
  precoConfirmar: "Preço a confirmar", total: "Total",
  semPrecoTabela: (n: number) => `${n} produto(s) sem preço na sua tabela: a vendedora confirma o valor.`,
  observacao: "Observação", obsExemplo: "Ex.: entregar na sexta",
  confere: (v: string) => `${v} confere o estoque, confirma o total e manda os dados para pagamento.`,
  naoCliente: "Ainda não é cliente? Mande o pedido e a nossa equipe responde no WhatsApp com os preços de atacado.",
  seuNome: "Seu nome ou do salão", whatsapp: "WhatsApp com DDD", cidade: "Cidade",
  enviando: "Enviando…", enviarPara: (v: string) => `Enviar pedido para ${v}`, enviarZap: "Enviar pedido pelo WhatsApp",
  mandarZap: "Mandar este pedido pelo WhatsApp", diminuir: "Diminuir", aumentar: "Aumentar", quantidade: "Quantidade",
  abrirPedido: (n: number) => `Abrir pedido (${n} itens)`,
  msgVisitante: (nome: string, cidade: string, lista: string, obs: string) =>
    `Olá! Sou ${nome}${cidade ? ` (${cidade})` : ""}. Quero fazer este pedido pelo site:\n${lista}${obs ? "\nObs.: " + obs : ""}\nPode me passar os preços de atacado?`,
};

const ES: typeof PT = {
  buscar: "Buscar champú, matizador, kit…",
  querSerCliente: "Quiero ser cliente",
  cadTitulo: "Quiero ser cliente",
  cadTexto: "Complete sus datos y nuestro equipo de ventas le escribe por WhatsApp con la lista mayorista y el enlace de acceso a sus precios.",
  cadNome: "Nombre del salón o de la empresa", cadContato: "Su nombre", cadEmail: "Correo electrónico", cadCidade: "Ciudad",
  cadTipo: "Tipo de negocio", cadDoc: "RUC o documento de la empresa (opcional)", cadMsg: "¿Qué busca? (opcional)",
  cadTipos: { salao: "Salón de belleza", perfumaria: "Perfumería", revenda: "Revendedora", farmacia: "Farmacia", loja: "Tienda", outro: "Otro" },
  cadEnviar: "Enviar registro por WhatsApp",
  cadAviso: "Al enviar, abrimos WhatsApp con sus datos para confirmar el registro.",
  cadMsgZap: (d: Record<string, string>) =>
    `¡Hola! Quiero ser cliente de Virtual Cosméticos.\nEmpresa: ${d.nome}${d.contato ? `\nContacto: ${d.contato}` : ""}${d.cidade ? `\nCiudad: ${d.cidade}` : ""}${d.tipo ? `\nTipo: ${d.tipo}` : ""}${d.email ? `\nCorreo: ${d.email}` : ""}${d.mensagem ? `\nBusco: ${d.mensagem}` : ""}`,

  jaSouCliente: "Ya soy cliente", meusPedidos: "Mis pedidos", pedido: "Pedido",
  categorias: "Categorías", verAgora: "Ver productos", promocoes: "Promociones", maisVendidos: "Más vendidos", destaques: "Destacados", marcas: "Marcas", novidades: "Novedades",
  verTodas: "Ver todas", verTodosKits: "Ver todos los kits", verTodasMarcas: "Ver todas las marcas", verTodasPromocoes: "Ver todas las promociones",
  kitsCompletos: "Kits completos", catalogo: "Catálogo", tudo: "Todo",
  heroTitulo: "Distribuidora de cosméticos directo de fábrica en Foz do Iguaçu.",
  heroTexto: "Venta mayorista para salones, perfumerías y revendedores, con precio de distribuidora y envío desde Foz do Iguaçu.",
  verProdutos: (n: string) => `Ver los ${n} productos`,
  cartela: "Carta de matizadores", cartelaLegenda: "Matizadores en todos los tonos. Toque un mechón para ver los productos.",
  produto: "producto", produtos: "productos",
  resultados: (q: string) => `Resultados para “${q}”`,
  limparBusca: "Limpiar la búsqueda", todasMarcas: "Todas las marcas", todosProdutos: "Todos los productos",
  semPromocao: "No hay promociones ahora. Vuelva pronto o pida por WhatsApp.",
  semResultado: (q: string) => `Ningún producto${q ? ` con “${q}”` : " aquí"}. Pruebe otra palabra, como “champú” o “kit”, o pida por WhatsApp.`,
  anterior: "Anterior", proxima: "Siguiente", pagina: (a: number, b: number) => `Página ${a} de ${b}`,
  comoComprar: "Cómo comprar",
  passos: [
    ["Arme el pedido", "Elija los productos y las cantidades aquí en el sitio."],
    ["Envíelo por WhatsApp", "El pedido llega directo a nuestro equipo de ventas."],
    ["Reciba el total", "Verificamos el stock y le enviamos el precio mayorista y los datos para el pago."],
    ["Reciba el pedido", "Enviamos desde Foz do Iguaçu."],
  ],
  ola: (n: string) => `Hola, ${n}.`,
  precosCliente: (vip: boolean, gs: boolean, vend: string) =>
    `Precios ${vip ? "VIP " : ""}en ${gs ? "guaraníes" : "reales"}. Arme el pedido: ${vend} verifica el stock, confirma el total y le envía los datos para el pago.`,
  adicionar: "Agregar", adicionarPedido: "Agregar al pedido",
  precoVendedora: "Precio con la vendedora", emEstoque: "En stock", ultimas: "Últimas unidades",
  encomenda: (p: string | null) => `Por encargo (${p ?? "algunos días"})`, semEstoque: "Sin stock ahora: confirmamos el plazo",
  comprouEm: (d: string) => `Usted compró el ${d}`, kit: "Kit", maisVendido: "Más vendido", novo: "Nuevo",
  rodapeTexto: "Distribuidora de cosméticos directo de fábrica en Foz do Iguaçu. Venta mayorista para salones, perfumerías y revendedores.",
  atendimento: "Atención", rodapeZap: "Hable con nuestro equipo de ventas.",
  clientes: "Clientes", rodapeClientes: "Los clientes registrados reciben un enlace de acceso con los precios mayoristas.",
  atendimentoDe: (v: string) => `Atención: ${v}`, sair: "Salir del área de clientes",
  linhas: { kits: "Kits", matizadores: "Matizadores", cabelo: "Cabello", corpo: "Cuerpo y baño", rosto: "Rostro", maquiagem: "Maquillaje", unhas: "Uñas y pestañas", perfumaria: "Perfumería", outros: "Otros" },
  marcasTexto: (n: number) => `${n} marcas en el catálogo. Toque una marca para ver los productos.`,
  zapMsg: "¡Hola! Quiero comprar al por mayor en Virtual Cosméticos.",
  idioma: "Português", idiomaCodigo: "pt",
  seuPedido: "Su pedido", fechar: "Cerrar",
  vazio: "Elija los productos y las cantidades en el catálogo. Aparecen aquí.",
  precoConfirmar: "Precio a confirmar", total: "Total",
  semPrecoTabela: (n: number) => `${n} producto(s) sin precio en su tabla: la vendedora confirma el valor.`,
  observacao: "Observación", obsExemplo: "Ej.: entregar el viernes",
  confere: (v: string) => `${v} verifica el stock, confirma el total y le envía los datos para el pago.`,
  naoCliente: "¿Todavía no es cliente? Envíe el pedido y nuestro equipo responde por WhatsApp con los precios mayoristas.",
  seuNome: "Su nombre o el del salón", whatsapp: "WhatsApp con código de área", cidade: "Ciudad",
  enviando: "Enviando…", enviarPara: (v: string) => `Enviar pedido a ${v}`, enviarZap: "Enviar pedido por WhatsApp",
  mandarZap: "Enviar este pedido por WhatsApp", diminuir: "Disminuir", aumentar: "Aumentar", quantidade: "Cantidad",
  abrirPedido: (n: number) => `Abrir pedido (${n} ítems)`,
  msgVisitante: (nome: string, cidade: string, lista: string, obs: string) =>
    `¡Hola! Soy ${nome}${cidade ? ` (${cidade})` : ""}. Quiero hacer este pedido por el sitio:\n${lista}${obs ? "\nObs.: " + obs : ""}\n¿Me pasa los precios mayoristas?`,
};

export const TEXTOS = { pt: PT, es: ES };
export type Textos = typeof PT;

/** Textos que o carrinho (componente do navegador) precisa: só strings, para atravessar do servidor ao cliente. */
export function textosCarrinho(t: Textos, cliente: { vendedora: string } | null) {
  return {
    seuPedido: t.seuPedido, fechar: t.fechar, vazio: t.vazio, precoConfirmar: t.precoConfirmar, total: t.total,
    observacao: t.observacao, obsExemplo: t.obsExemplo, naoCliente: t.naoCliente, seuNome: t.seuNome, whatsapp: t.whatsapp,
    cidade: t.cidade, enviando: t.enviando, enviarZap: t.enviarZap, mandarZap: t.mandarZap, diminuir: t.diminuir,
    aumentar: t.aumentar, quantidade: t.quantidade, pedido: t.pedido, adicionar: t.adicionar,
    semPrecoTabela: t.semPrecoTabela(9999), abrirPedido: t.abrirPedido(9999),
    confere: cliente ? t.confere(cliente.vendedora) : "", enviarPara: cliente ? t.enviarPara(cliente.vendedora) : "",
  };
}
export type TextosCarrinho = ReturnType<typeof textosCarrinho>;
