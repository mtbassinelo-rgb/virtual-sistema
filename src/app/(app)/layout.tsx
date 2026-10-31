import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario, sair } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { PERFIS } from "@/lib/formato";
import { MenuLateral } from "./menu-lateral";
import { FiltrosAutomaticos } from "./filtros-automaticos";
import { Atalhos, type Atalho } from "./atalhos";
import { OcultarValores } from "./ocultar-valores";
import { unidadeSistema } from "@/lib/unidade-sistema";
import { permissaoDoLink, pode } from "@/lib/permissoes";
import { contarAprovacoes, totalAprovacoes } from "@/lib/aprovacoes";
import { montarMenu } from "@/lib/menu";

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

  // Tudo que espera decisão da gerência (tela Aprovações)
  const aprovar = gestao ? totalAprovacoes(await comUsuario(u.id, (c) => contarAprovacoes(c)).catch(() => ({} as never))) : 0;

  // Menu: Dashboard → operação do dia (vendas, clientes) → cadastro (produtos, estoque) → loja e marketing → análise → financeiro → configurações
  const todos = montarMenu(gestao, n, aprovar);


  // Menu simples por função: cada pessoa vê só o que usa no dia a dia (pode abrir o menu completo no rodapé).
  const ESSENCIAL: Partial<Record<string, string[]>> = {
    vendedora: ["/", "/pedidos", "/pedidos/novo", "/orcamentos", "/clientes", "/clientes/recompra", "/procuras", "/produtos", "/produtos/vendas", "/catalogo", "/comissoes", "/whatsapp", "/conta"],
    estoquista: ["/", "/estoque/separacao", "/estoque/transferencias", "/estoque", "/estoque/inventario", "/pedidos", "/produtos", "/conta"],
  };
  const essencial = ESSENCIAL[u.perfil];
  const extras = n.confirma_py && !gestao ? ["/pedidos/envios-py", "/caixa", "/caixa/contas", "/estoque/transferencias"] : [];
  // quem é responsável por algum estoque (ex.: vendedora da CDE) vê também o inventário daquele estoque
  const respEstoque = !gestao && u.perfil === "vendedora" && await comUsuario(u.id, async (c) =>
    (await c.query("select exists (select 1 from app.deposito_responsaveis where usuario_id = app.uid()) as ok")).rows[0].ok as boolean).catch(() => false);
  if (respEstoque) extras.push("/estoque/inventario");
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
    { tecla: "A", href: "/aprovacoes", texto: "Aprovações (tudo que espera decisão)" },
    { tecla: "F", href: "/financeiro", texto: "Painel financeiro" },
    { tecla: "D", href: "/despesas", texto: "Contas a pagar" },
    { tecla: "U", href: "/unidades", texto: "Painel das unidades" },
  ] as Atalho[]).filter((a) => liberado(a.href));
  const rapidos = atalhos.filter((a) => (u.perfil === "estoquista" ? ["E", "T"] : gestao ? ["N", "A", "X"] : ["N", "O", "X"]).includes(a.tecla));

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
            <input id="busca-geral" name="q" type="search" placeholder="Buscar tela, produto, cliente ou pedido…" autoComplete="off" />
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
