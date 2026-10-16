import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario } from "@/lib/db";
import { dataHora, linkWhatsApp, telefone } from "@/lib/formato";
import { Avisos, Selo } from "../avisos";
import { alternarBanner, apagarBanner, atenderCadastro, criarBanner, ordemBanner } from "./acoes";

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
      `select s.*, us.nome as atendente from app.cadastros_site s left join app.usuarios us on us.id = s.atendido_por
        order by (s.atendido_em is null) desc, s.criado_em desc limit 100`)).rows,
  }));

  return (
    <>
      <section>
        <h1>Site</h1>
        <div className="suave pequeno">Banners do início do site e cadastros de quem quer ser cliente. O site: <a href="https://distribuidoravirtualcosmeticos.com" target="_blank" rel="noopener noreferrer">distribuidoravirtualcosmeticos.com</a></div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

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
                  <td>{s.atendido_em ? <span className="pequeno suave">Atendido por {s.atendente ?? "—"}</span> : (
                    <form action={atenderCadastro}><input type="hidden" name="id" value={s.id} /><button>Atendido</button></form>)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        <p className="pequeno suave">Para virar cliente com preços: cadastre em Clientes e mande o link de acesso pelo WhatsApp.</p>
      </section>

      <section className="painel">
        <h2>Banners do início</h2>
        <p className="pequeno suave">Aparecem no topo da página inicial, na ordem abaixo (dá para deslizar entre eles). Imagem larga, de preferência 1600 × 600.</p>
        {d.banners.length === 0 && <p className="suave">Nenhum banner. Sem banners, o site mostra a abertura com a cartela de matizadores.</p>}
        {d.banners.map((b) => (
          <div key={b.id} className="painel linha" style={{ background: "var(--afundado)", alignItems: "flex-start" }}>
            {b.imagem ? <img src={b.imagem} alt="" style={{ width: 200, aspectRatio: "16/6", objectFit: "cover", borderRadius: 8 }} />
              : <div style={{ width: 200, aspectRatio: "16/6", borderRadius: 8, background: "var(--marca)" }} />}
            <div style={{ flex: 1, minWidth: 200 }}>
              <b>{b.titulo}</b> {!b.ativo && <Selo>desligado</Selo>}
              {b.subtitulo && <div className="pequeno">{b.subtitulo}</div>}
              <div className="pequeno suave">
                {IDIOMA[b.idioma]} · ordem {b.ordem}
                {b.inicio && ` · de ${String(b.inicio)}`}{b.fim && ` até ${String(b.fim)}`}
              </div>
              {b.link && <div className="pequeno">Link: <a href={b.link.startsWith("/") ? `https://distribuidoravirtualcosmeticos.com${b.link}` : b.link} target="_blank" rel="noopener noreferrer">{b.link}</a></div>}
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
              <label className="largo">Título<input name="titulo" required maxLength={120} placeholder="Ex.: Semana dos kits Maycrene" /></label>
              <label className="largo">Texto (opcional)<input name="subtitulo" maxLength={200} placeholder="Ex.: Kits com 10% de desconto até domingo" /></label>
              <label className="largo">Imagem (JPG, PNG ou WEBP)<input type="file" name="imagem" accept="image/jpeg,image/png,image/webp" /></label>
              <label className="largo">Link ao clicar (opcional)
                <input name="link" placeholder="Ex.: /loja?marca=Maycrene  ou  /loja?q=platinum  ou  /loja?linha=kits" />
              </label>
              <label>Idioma
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
