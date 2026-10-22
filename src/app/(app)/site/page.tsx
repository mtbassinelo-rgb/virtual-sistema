import Link from "next/link";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dataHora, linkWhatsApp, telefone } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import { alternarBanner, apagarBanner, aprovarCadastro, atenderCadastro, celularBanner, criarBanner, idiomaBanner, ordemBanner, salvarMensagemCliente } from "./acoes";
import { TextoMensagem } from "@/app/loja/boas-vindas";

export const metadata = { title: "Site" };

const IDIOMA: Record<string, string> = { todos: "Português e espanhol", pt: "Só português", es: "Só espanhol" };
const TIPO: Record<string, string> = { salao: "Salão", perfumaria: "Perfumaria", revenda: "Revendedora", farmacia: "Farmácia", loja: "Loja", outro: "Outro" };

export default async function Site({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const gestao = ehGestao(u);
  const d = await comUsuario(u.id, async (c) => ({
    banners: (await c.query("select * from app.banners order by ativo desc, ordem, criado_em desc")).rows,
    cadastros: (await c.query(
      `select s.*, us.nome as atendente, cl.nome as cliente_nome, vv.nome as vendedora_nome from app.cadastros_site s
         left join app.usuarios us on us.id = s.atendido_por left join app.clientes cl on cl.id = s.cliente_id
         left join app.vendedoras vv on vv.id = s.vendedora_id
        order by (s.cliente_id is null and s.atendido_em is null) desc, (s.cliente_id is null) desc, s.criado_em desc limit 150`)).rows,
    vendedoras: (await c.query("select id, nome from app.vendedoras where ativo order by nome")).rows as { id: string; nome: string }[],
    mensagem: (await c.query(`select m.*, (select count(*) from app.clientes c where c.mensagem_versao_vista >= m.versao)::int vistos from app.mensagem_cliente m where id = 1`)).rows[0] as
      { ativo: boolean; titulo_pt: string; texto_pt: string; botao_pt: string; titulo_es: string; texto_es: string; botao_es: string; versao: number; vistos: number; atualizado_em: string } | undefined,
  }));

  return (
    <>
      <section>
        <h1>Site</h1>
        <div className="suave pequeno">Banners do início do site e cadastros de quem quer ser cliente. O site: <a href="https://distribuidoravirtualcosmeticos.com" target="_blank" rel="noopener noreferrer">distribuidoravirtualcosmeticos.com</a></div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      {d.mensagem && gestao && (
        <section className="painel" id="mensagem">
          <h2 style={{ margin: 0 }}>Mensagem ao cliente ao abrir a loja</h2>
          <p className="pequeno suave" style={{ margin: 0 }}>Aparece numa janela quando o cliente entra na loja, uma vez só. Para avisar algo novo (promoção, feriado, mudança), mude o texto e marque
            <b> “mostrar de novo para todos”</b>. Use <b>{"{nome}"}</b> para o nome do cliente e <b>{"{vendedora}"}</b> para a vendedora dele; linha começando com <b>-</b> vira lista; <b>**texto**</b> fica em negrito.
            {" "}Já viram a mensagem atual: <b>{d.mensagem.vistos}</b> cliente(s).</p>
          <form action={salvarMensagemCliente} className="mensagem-editor">
            <div className="mensagem-colunas">
              <fieldset>
                <legend>Português (clientes do Brasil)</legend>
                <label>Título<input name="titulo_pt" defaultValue={d.mensagem.titulo_pt} maxLength={120} /></label>
                <label>Mensagem<textarea name="texto_pt" defaultValue={d.mensagem.texto_pt} rows={9} maxLength={3000} required /></label>
                <label>Botão<input name="botao_pt" defaultValue={d.mensagem.botao_pt} maxLength={40} /></label>
              </fieldset>
              <fieldset>
                <legend>Espanhol (clientes do Paraguai)</legend>
                <label>Título<input name="titulo_es" defaultValue={d.mensagem.titulo_es} maxLength={120} /></label>
                <label>Mensaje<textarea name="texto_es" defaultValue={d.mensagem.texto_es} rows={9} maxLength={3000} required /></label>
                <label>Botón<input name="botao_es" defaultValue={d.mensagem.botao_es} maxLength={40} /></label>
              </fieldset>
            </div>
            <div className="linha" style={{ gap: 14, flexWrap: "wrap", alignItems: "center" }}>
              <label className="pequeno" style={{ display: "flex", gap: 6, alignItems: "center", flexDirection: "row" }}><input type="checkbox" name="ativo" value="1" defaultChecked={d.mensagem.ativo} style={{ width: "auto" }} /> Mostrar mensagem na loja</label>
              <label className="pequeno" style={{ display: "flex", gap: 6, alignItems: "center", flexDirection: "row" }}><input type="checkbox" name="de_novo" value="1" style={{ width: "auto" }} /> Mostrar de novo para todos os clientes</label>
              <button className="principal">Salvar mensagem</button>
            </div>
          </form>
          <details>
            <summary className="pequeno">Ver como o cliente vê (espanhol)</summary>
            <div className="boas-vindas-previa"><h3>{d.mensagem.titulo_es.replace(/\{(nome|nombre)\}/gi, "María")}</h3><TextoMensagem texto={d.mensagem.texto_es.replace(/\{(nome|nombre)\}/gi, "María").replace(/\{vendedora\}/gi, "Crislaine")} /><span className="botao principal">{d.mensagem.botao_es}</span></div>
          </details>
        </section>
      )}

      <section className="painel" id="cadastros">
        <h2>Quero ser cliente</h2>
        {d.cadastros.length === 0 ? <p className="suave">Nenhum cadastro ainda.</p> : (
          <div className="tabela"><table>
            <thead><tr><th>Quando</th><th>Empresa</th><th>Contato</th><th>Mensagem</th><th></th></tr></thead>
            <tbody>{d.cadastros.map((s) => {
              const zap = linkWhatsApp(s.whatsapp, s.idioma === "es"
                ? `¡Hola, ${s.contato ?? s.nome}! Le escribimos de Virtual Cosméticos por su registro en el sitio.`
                : `Olá, ${s.contato ?? s.nome}! Aqui é da Virtual Cosméticos, recebemos o seu cadastro no site.`);
              return (
                <tr key={s.id}>
                  <td className="num">{dataHora(s.criado_em)}</td>
                  <td><b>{s.nome}</b><div className="pequeno suave">{[TIPO[s.tipo], s.cidade, s.documento].filter(Boolean).join(" · ")}</div>
                    {s.idioma === "es" && <Selo>espanhol</Selo>}</td>
                  <td>{s.contato ?? "—"}<div className="pequeno">{zap && <a href={zap} target="_blank" rel="noopener noreferrer">{telefone(s.whatsapp)}</a>}</div>
                    {s.email && <div className="pequeno"><a href={`mailto:${s.email}`}>{s.email}</a></div>}</td>
                  <td className="pequeno">{s.mensagem ?? ""}</td>
                  <td style={{ minWidth: 230 }}>
                    {s.cliente_id ? (
                      <><Link href={`/clientes/${s.cliente_id}`}>Ver cliente: {s.cliente_nome}</Link>
                        <div className="pequeno suave">Aprovado por {s.atendente ?? "—"}{s.vendedora_nome ? ` · vendedora ${s.vendedora_nome}` : ""}</div></>
                    ) : (
                      <>
                        {s.atendido_em && <div className="pequeno"><Selo cor="aviso">Marcado atendido, mas sem cliente</Selo></div>}
                        <form action={aprovarCadastro} className="linha" style={{ gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                          <input type="hidden" name="id" value={s.id} />
                          <select name="vendedora_id" defaultValue={s.vendedora_id ?? ""} aria-label="Vendedora do cliente" required>
                            <option value="" disabled>Vendedora…</option>
                            {d.vendedoras.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
                          </select>
                          <button className="principal">Aprovar e criar cliente</button>
                        </form>
                        {!s.atendido_em && <form action={atenderCadastro} style={{ marginTop: 4 }}><input type="hidden" name="id" value={s.id} /><button className="discreto">Só marcar atendido (não vira cliente)</button></form>}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        <p className="pequeno suave"><b>Aprovar e criar cliente</b> cadastra o cliente com os dados do site (nome, WhatsApp, cidade, documento, país pelo idioma) e abre a ficha dele para criar o acesso à loja. Se já existe cliente com o mesmo WhatsApp ou documento, liga ao cadastro que já existe.</p>
      </section>

      <section className="painel">
        <h2>Banners do início</h2>
        <p className="pequeno suave">Só estes banners aparecem no site, no topo da página inicial e na área do cliente, na ordem abaixo. Cada cliente vê só os banners do idioma dele. A imagem aparece inteira, sem nome por cima. Tamanhos: <b>computador 1800 × 600</b>; <b>celular 1080 × 1080</b> (quadrada). Sem imagem de celular, o celular mostra a imagem do computador inteira, em tamanho menor.</p>
        {d.banners.length === 0 && <p className="suave">Nenhum banner cadastrado: o site fica sem banners no topo até você subir o primeiro.</p>}
        {d.banners.map((b) => (
          <div key={b.id} className="painel linha" style={{ background: "var(--afundado)", alignItems: "flex-start" }}>
            {b.imagem ? <img src={b.imagem} alt="" style={{ width: 200, aspectRatio: "16/6", objectFit: "cover", borderRadius: 8 }} />
              : <div style={{ width: 200, aspectRatio: "16/6", borderRadius: 8, background: "var(--marca)" }} />}
            <div style={{ flex: 1, minWidth: 200 }}>
              <b>{b.titulo}</b> <span className="pequeno suave">(nome interno)</span> {!b.ativo && <Selo>desligado</Selo>}
              {b.subtitulo && <div className="pequeno">No site: “{b.subtitulo}”</div>}
              <div className="pequeno suave">
                {IDIOMA[b.idioma]} · ordem {b.ordem}
                {b.inicio && ` · de ${String(b.inicio)}`}{b.fim && ` até ${String(b.fim)}`}
              </div>
              {b.link && <div className="pequeno">Link: <a href={b.link.startsWith("/") ? `https://distribuidoravirtualcosmeticos.com${b.link}` : b.link} target="_blank" rel="noopener noreferrer">{b.link}</a></div>}
              <div className="pequeno">{b.imagem_celular ? "✓ Tem imagem para celular" : "Sem imagem para celular: no celular aparece a imagem do computador inteira"}</div>
              {gestao && (
                <div className="linha" style={{ gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <form action={idiomaBanner} className="linha" style={{ gap: 6, alignItems: "center" }}>
                    <input type="hidden" name="id" value={b.id} />
                    <select name="idioma" defaultValue={b.idioma} aria-label="Quem vê este banner">
                      <option value="todos">Português e espanhol</option><option value="pt">Só português</option><option value="es">Só espanhol</option>
                    </select>
                    <button>Salvar idioma</button>
                  </form>
                  <form action={celularBanner} className="linha" style={{ gap: 6, alignItems: "center" }}>
                    <input type="hidden" name="id" value={b.id} />
                    <input type="file" name="imagem_celular" accept="image/jpeg,image/png,image/webp" aria-label="Imagem para celular" style={{ maxWidth: 220 }} />
                    <button>{b.imagem_celular ? "Trocar imagem do celular" : "Enviar imagem do celular"}</button>
                  </form>
                  {b.imagem_celular && <form action={celularBanner}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="tirar" value="1" /><button className="discreto">Tirar imagem do celular</button></form>}
                </div>
              )}
            </div>
            {gestao && (
              <div className="linha">
                <form action={ordemBanner}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="passo" value="-1" /><button aria-label="Subir">↑</button></form>
                <form action={ordemBanner}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="passo" value="1" /><button aria-label="Descer">↓</button></form>
                <form action={alternarBanner}><input type="hidden" name="id" value={b.id} /><button>{b.ativo ? "Desligar" : "Ligar"}</button></form>
                <form action={apagarBanner}><input type="hidden" name="id" value={b.id} /><button className="perigo">Apagar</button></form>
              </div>
            )}
          </div>
        ))}

        {gestao && (
          <details>
            <summary>Novo banner</summary>
            <form action={criarBanner} className="campos" style={{ marginTop: 10 }}>
              <label className="largo">Nome do banner (só para sua organização, não aparece no site)<input name="titulo" required maxLength={120} placeholder="Ex.: Mais vendidos outubro" /></label>
              <label className="largo">Frase escrita por cima da imagem no site (opcional; deixe vazio se a imagem já tem tudo)<input name="subtitulo" maxLength={200} placeholder="Ex.: Kits com 10% de desconto até domingo" /></label>
              <label className="largo">Imagem para computador: 1800 × 600 (JPG, PNG ou WEBP)<input type="file" name="imagem" accept="image/jpeg,image/png,image/webp" required /></label>
              <label className="largo">Imagem para celular: 1080 × 1080 (opcional, recomendada)<input type="file" name="imagem_celular" accept="image/jpeg,image/png,image/webp" /></label>
              <label className="largo">Link ao clicar (opcional)
                <input name="link" placeholder="Ex.: /loja?marca=Maycrene  ou  /loja?q=platinum  ou  /loja?linha=kits" />
              </label>
              <label>Quem vê (idioma do cliente)
                <select name="idioma" defaultValue="todos">
                  <option value="todos">Português e espanhol</option><option value="pt">Só português</option><option value="es">Só espanhol</option>
                </select>
              </label>
              <label>Ordem<input name="ordem" inputMode="numeric" defaultValue="0" /></label>
              <label>Começa em (opcional)<input name="inicio" type="date" /></label>
              <label>Termina em (opcional)<input name="fim" type="date" /></label>
              <p className="largo pequeno suave">Dica para o link: abra o site, faça a busca ou escolha a marca/linha e copie o endereço da barra do navegador.</p>
              <button className="principal">Criar banner</button>
            </form>
          </details>
        )}
      </section>
    </>
  );
}
