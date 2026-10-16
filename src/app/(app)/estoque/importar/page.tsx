import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { analisar, lerLote, type LinhaBling } from "@/lib/importar-bling";
import { Avisos, Selo } from "../../avisos";
import { confirmarImportacao, descartarLote, enviarPlanilha } from "./acoes";

export const metadata = { title: "Importar produtos do Bling" };

const reais = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

function Lista({ titulo, cor, ajuda, linhas }: { titulo: string; cor: string; ajuda: string; linhas: LinhaBling[] }) {
  if (linhas.length === 0) return null;
  return (
    <details className="painel">
      <summary><Selo cor={cor}>{linhas.length}</Selo> {titulo}</summary>
      <p className="pequeno suave">{ajuda}</p>
      <div className="tabela"><table>
        <thead><tr><th>ID Bling</th><th>Código</th><th>Descrição</th><th>Estoque</th><th>Preço</th></tr></thead>
        <tbody>{linhas.map((l, i) => (
          <tr key={`${l.bling_id}-${i}`}>
            <td className="num">{l.bling_id}</td><td className="num">{l.codigo || "—"}</td><td>{l.nome}</td>
            <td className="num">{l.estoque ?? "—"}</td><td className="num">{reais(l.preco)}</td>
          </tr>))}
        </tbody></table></div>
    </details>
  );
}

export default async function Importar({ searchParams }: { searchParams: Promise<{ lote?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono importa produtos.</div>;
  const lote = f.lote ? await lerLote(f.lote, u.id) : null;

  if (!lote) {
    return (
      <>
        <section>
          <h1>Importar produtos do Bling</h1>
          <p className="suave">No Bling: <b>Cadastros → Produtos</b>, selecione todos, <b>Exportar dados para planilha</b> no formato <b>CSV</b>. Depois envie o arquivo aqui. Você vê uma prévia antes de qualquer coisa ser gravada.</p>
        </section>
        <Avisos erro={f.erro ?? (f.lote ? "Essa prévia expirou. Envie o arquivo de novo." : undefined)} />
        <form action={enviarPlanilha} className="painel campos">
          <label className="largo">Arquivo CSV do Bling<input type="file" name="arquivo" accept=".csv,text/csv" required /></label>
          <button className="principal">Ver prévia</button>
        </form>
        <p className="pequeno suave">Importar de novo é seguro: o produto é reconhecido pelo ID do Bling e é atualizado, nunca duplicado.</p>
      </>
    );
  }

  const a = analisar(lote.linhas);
  const d = await comUsuario(u.id, async (c) => {
    const existentes = (await c.query("select bling_produto_id from app.produtos where bling_produto_id = any($1::bigint[])",
      [lote.linhas.map((l) => l.bling_id)])).rows.length;
    const depositos = (await c.query("select id, codigo, nome from app.depositos where ativo order by tipo, nome")).rows;
    return { existentes, depositos };
  });
  const cd = d.depositos.find((x) => x.codigo === "cd-foz");

  return (
    <>
      <section>
        <h1>Prévia da importação</h1>
        <div className="suave pequeno">{lote.arquivo} · nada foi gravado ainda</div>
      </section>
      <Avisos erro={f.erro} />

      <div className="indicadores">
        <div className="indicador"><span className="rotulo">Produtos</span><span className="valor">{lote.linhas.length}</span></div>
        <div className="indicador"><span className="rotulo">Novos</span><span className="valor">{lote.linhas.length - d.existentes}</span></div>
        <div className="indicador"><span className="rotulo">Já cadastrados</span><span className="valor">{d.existentes}</span></div>
        <div className="indicador"><span className="rotulo">Com estoque</span><span className="valor">{a.comEstoque.length}</span></div>
        <div className="indicador"><span className="rotulo">Unidades</span><span className="valor">{a.unidades.toLocaleString("pt-BR")}</span></div>
      </div>

      <section className="coluna">
        <h2>Para conferir</h2>
        <Lista titulo="sem código (SKU) no Bling" cor="erro" linhas={a.semCodigo}
          ajuda="Entram com código provisório BLING-<id>. Sem código, pedidos da Shopee e do ML não acham o produto. Preencha o código no Bling e importe de novo: o provisório é trocado sozinho." />
        <Lista titulo="com código repetido" cor="erro" linhas={a.codigoRepetido}
          ajuda="Dois produtos com o mesmo código: a importação para nesse ponto. Corrija no Bling antes." />
        <Lista titulo="com descrição repetida" cor="aviso" linhas={a.nomeRepetido}
          ajuda="Podem ser cadastros duplicados no Bling (ou variações com o mesmo nome). Entram como produtos separados." />
        <Lista titulo="com estoque negativo" cor="aviso" linhas={a.negativo} ajuda="Entram com estoque zero." />
        <Lista titulo="sem preço" cor="" linhas={a.semPreco} ajuda="Entram sem preço; defina nas tabelas de preço." />
        <Lista titulo="parecem kits" cor="info" linhas={a.pareceKit}
          ajuda="O Bling não exporta a composição. Depois da importação, monte cada kit em Estoque → Kits (o estoque passa a ser o dos componentes)." />
      </section>

      <form action={confirmarImportacao} className="painel campos">
        <input type="hidden" name="lote" value={lote.id} />
        <label className="largo">Estoque da planilha
          <select name="deposito_id" defaultValue={cd?.id ?? ""}>
            <option value="">Não lançar estoque (só cadastro)</option>
            {d.depositos.map((x) => <option key={x.id} value={x.id}>Usar como contagem do {x.nome}</option>)}
          </select>
        </label>
        <p className="largo pequeno suave">A quantidade da planilha vira o saldo do depósito escolhido, como ajuste de inventário registrado no histórico. Um inventário novo depois corrige o que for preciso.</p>
        <label className="largo">Preço do Bling (R$)
          <select name="tabela_preco" defaultValue="">
            <option value="">Não alterar preços (só guardar como referência)</option>
            <option value="br_normal">Usar como tabela Brasil · Normal</option>
            <option value="br_vip">Usar como tabela Brasil · VIP</option>
          </select>
        </label>
        <div className="largo linha">
          <button className="principal">Importar {lote.linhas.length} produtos</button>
        </div>
      </form>
      <form action={descartarLote}><input type="hidden" name="lote" value={lote.id} /><button>Descartar e enviar outro arquivo</button></form>
    </>
  );
}
