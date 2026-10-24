import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { comUsuario, pool } from "@/lib/db";
import { dataHora } from "@/lib/formato";
import { contatoLegivel, estadoAtual, whatsappInstalado } from "@/lib/whatsapp";
import { Avisos, Selo } from "../../avisos";
import { AtualizarSozinho } from "../atualizar-sozinho";
import { criarConexao, desconectar, editarConexao, importarHistorico, novoQr, removerConexao, codigoConexao } from "./acoes";

export const metadata = { title: "Conexões do WhatsApp" };

type Conexao = {
  id: string; nome: string; instancia: string; pais: string; vendedora_id: string | null; vendedora: string | null; numero: string | null;
  estado: string; qr: string | null; qr_em: string | null; conectado_em: string | null; ultima_mensagem_em: string | null; mensagens: number;
};

const ESTADOS: Record<string, { t: string; cor: string }> = {
  conectado: { t: "Conectado", cor: "ok" },
  aguardando_qr: { t: "Esperando o QR Code", cor: "aviso" },
  conectando: { t: "Conectando…", cor: "info" },
  desconectado: { t: "Desconectado", cor: "erro" },
};

export default async function Conexoes({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; qr?: string; codigo?: string; cid?: string }> }) {
  const u = await exigirUsuario();
  const f = await searchParams;
  const instalado = whatsappInstalado();
  const carregar = () => comUsuario(u.id, async (c) => (await c.query(`
    select w.id, w.nome, w.instancia, w.pais, w.vendedora_id, v.nome as vendedora, w.numero, w.estado, w.qr, w.qr_em, w.conectado_em, w.ultima_mensagem_em,
           (select count(*) from app.whatsapp_mensagens m where m.conexao_id = w.id)::int as mensagens
      from app.whatsapp_conexoes w left join app.vendedoras v on v.id = w.vendedora_id
     where w.ativo order by w.nome`)).rows as Conexao[]);

  let lista = await carregar();
  // Confere no servidor de WhatsApp se o estado mudou (ex.: QR escaneado agora)
  if (instalado && lista.length) {
    const mudou = await Promise.all(lista.map(async (w) => {
      const a = await estadoAtual(w.instancia);
      if (!a) return false;
      const novo = a.estado === "desconectado" && w.estado === "aguardando_qr" ? "aguardando_qr" : a.estado;
      if (novo === w.estado && (!a.numero || a.numero === w.numero)) return false;
      await pool.query("select app.whatsapp_estado($1, $2, $3, null)", [w.instancia, novo, a.numero]);
      return true;
    }));
    if (mudou.some(Boolean)) lista = await carregar();
  }
  const vendedoras = await comUsuario(u.id, async (c) => (await c.query(
    "select id, nome from app.vendedoras where ativo and nome <> 'Marketplace' order by nome")).rows as { id: string; nome: string }[]);
  const esperando = lista.some((w) => w.estado === "aguardando_qr" || w.estado === "conectando");

  return (
    <>
      {esperando && <AtualizarSozinho segundos={5} />}
      <section className="cabecalho-pagina">
        <div>
          <h1>Conexões do WhatsApp</h1>
          <p>Cada número da equipe conectado por QR Code, igual ao WhatsApp Web. A pessoa continua usando o WhatsApp normalmente no celular ou no
            navegador; o sistema só recebe uma cópia das mensagens para o <Link href="/whatsapp">acompanhamento</Link>.</p>
        </div>
      </section>
      <Avisos ok={f.ok} erro={f.erro} />

      {!instalado && (
        <section className="painel">
          <h2>WhatsApp ainda não instalado neste ambiente</h2>
          <p className="suave">O servidor de WhatsApp é instalado junto com a próxima publicação em <b>produção</b> (Actions → Publicar → producao).
            O ambiente de teste não conecta números.</p>
        </section>
      )}

      {lista.map((w) => {
        const e = ESTADOS[w.estado] ?? ESTADOS.desconectado;
        const mostrarQr = w.estado === "aguardando_qr" && w.qr;
        return (
          <section key={w.id} className="painel">
            <div className="linha entre">
              <div>
                <h2 style={{ margin: 0 }}>{w.nome} <Selo cor={e.cor}>{e.t}</Selo></h2>
                <div className="pequeno suave">
                  {w.numero ? contatoLegivel(w.numero) : "Número aparece depois de escanear o QR"} · {w.pais === "PY" ? "Paraguai" : "Brasil"}
                  {w.vendedora ? ` · ${w.vendedora}` : " · sem vendedora ligada"}
                </div>
                <div className="pequeno suave">
                  {w.mensagens.toLocaleString("pt-BR")} mensagens no sistema
                  {w.ultima_mensagem_em ? ` · última ${dataHora(w.ultima_mensagem_em)}` : ""}
                  {w.conectado_em && w.estado === "conectado" ? ` · conectado desde ${dataHora(w.conectado_em)}` : ""}
                </div>
              </div>
              {instalado && (
                <div className="linha" style={{ gap: 6, flexWrap: "wrap" }}>
                  {w.estado !== "conectado" && (
                    <form action={novoQr}><input type="hidden" name="id" value={w.id} /><button className="principal">{w.qr ? "Gerar novo QR Code" : "Conectar (QR Code)"}</button></form>
                  )}
                  {w.estado === "conectado" && (
                    <form action={importarHistorico}><input type="hidden" name="id" value={w.id} />
                      <button title="Traz as conversas antigas que o WhatsApp já enviou ao conectar">Importar histórico</button></form>
                  )}
                  {w.estado === "conectado" && (
                    <form action={desconectar}><input type="hidden" name="id" value={w.id} /><button className="discreto">Desconectar</button></form>
                  )}
                </div>
              )}
            </div>

            {f.codigo && f.cid === w.id && w.estado !== "conectado" && (
              <div className="linha" style={{ gap: 24, alignItems: "flex-start", flexWrap: "wrap", marginTop: 16 }}>
                <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: 4, padding: "16px 24px", background: "#fff", color: "#111", borderRadius: 8, border: "2px solid var(--marca)" }}>
                  {f.codigo}
                </div>
                <ol className="pequeno" style={{ maxWidth: 400, lineHeight: 1.7 }}>
                  <li>No celular do número, abra o <b>WhatsApp</b>.</li>
                  <li>Toque em <b>⋮</b> (Android) ou <b>Configurações</b> (iPhone) → <b>Dispositivos conectados</b> → <b>Conectar um dispositivo</b>.</li>
                  <li>Toque em <b>Conectar com número de telefone</b> e digite este código.</li>
                  <li>Pronto: esta tela muda para <b>Conectado</b> sozinha.</li>
                  <li className="suave">O código vale poucos minutos. Se expirar, gere outro.</li>
                </ol>
              </div>
            )}

            {instalado && w.estado !== "conectado" && (
              <form action={codigoConexao} className="linha" style={{ gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                <input type="hidden" name="id" value={w.id} />
                <input name="numero" inputMode="tel" required defaultValue={w.numero ?? ""} placeholder="Número com DDI: 595981… ou 5545…" style={{ minWidth: 240 }} aria-label="Número do WhatsApp" />
                <button>Entrar por código (sem câmera)</button>
              </form>
            )}

            {mostrarQr && (
              <div className="linha" style={{ gap: 24, alignItems: "flex-start", flexWrap: "wrap", marginTop: 16 }}>
                <img src={w.qr!} alt="QR Code para conectar o WhatsApp" width={260} height={260} style={{ background: "#fff", padding: 8, borderRadius: 8 }} />
                <ol className="pequeno" style={{ maxWidth: 380, lineHeight: 1.7 }}>
                  <li>No celular do número, abra o <b>WhatsApp</b>.</li>
                  <li>Toque em <b>⋮</b> (Android) ou <b>Configurações</b> (iPhone) → <b>Dispositivos conectados</b>.</li>
                  <li>Toque em <b>Conectar um dispositivo</b> e aponte a câmera para este QR Code.</li>
                  <li>Pronto: esta tela muda para <b>Conectado</b> sozinha.</li>
                  <li className="suave">O QR Code troca a cada poucos segundos (atualiza sozinho). Se parar, toque em &quot;Gerar novo QR Code&quot;.</li>
                </ol>
              </div>
            )}

            <details style={{ marginTop: 12 }}>
              <summary className="pequeno">Editar ou remover</summary>
              <form action={editarConexao} className="filtros" style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={w.id} />
                <label>Nome<input name="nome" defaultValue={w.nome} required maxLength={60} /></label>
                <label>País<select name="pais" defaultValue={w.pais}><option value="PY">Paraguai (Gs)</option><option value="BR">Brasil (R$)</option></select></label>
                <label>Vendedora deste número<select name="vendedora_id" defaultValue={w.vendedora_id ?? ""}>
                  <option value="">Nenhuma (número da empresa)</option>{vendedoras.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
                </select></label>
                <button>Salvar</button>
              </form>
              <form action={removerConexao} style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={w.id} />
                <button className="discreto">Remover conexão (as mensagens já recebidas ficam)</button>
              </form>
            </details>
          </section>
        );
      })}

      <section className="painel">
        <h2>{lista.length ? "Conectar outro número" : "Conectar o primeiro número"}</h2>
        <form action={criarConexao} className="filtros">
          <label>Nome da conexão<input name="nome" placeholder="Ex.: Paraguai" required maxLength={60} /></label>
          <label>País<select name="pais" defaultValue="PY"><option value="PY">Paraguai (Gs)</option><option value="BR">Brasil (R$)</option></select></label>
          <label>Vendedora deste número<select name="vendedora_id" defaultValue="">
            <option value="">Nenhuma (número da empresa)</option>{vendedoras.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
          </select></label>
          <label>Número (opcional: para entrar por código)<input name="numero" inputMode="tel" placeholder="595981… ou 5545…" /></label>
          <button className="principal" disabled={!instalado}>Criar e conectar</button>
        </form>
        <p className="pequeno suave" style={{ margin: 0 }}>Sem número: aparece o QR Code para escanear. Com o número (DDI + DDD): aparece um código de 8 letras para digitar no celular, em
          Dispositivos conectados → Conectar com número de telefone.
          Grupos são ignorados. O sistema não marca mensagens como lidas e o celular continua recebendo as notificações.</p>
      </section>
    </>
  );
}
