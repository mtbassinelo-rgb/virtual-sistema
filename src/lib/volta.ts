/**
 * Telas que decidem coisas de outras telas (ex.: Aprovações, Início) mandam o campo "volta".
 * Só aceita estes destinos internos; sem "volta" cada ação continua indo para a tela de sempre.
 */
const PERMITIDOS = ["/aprovacoes", "/"];

export function destinoVolta(fd: FormData): string | null {
  const v = String(fd.get("volta") ?? "").split("#")[0];
  const base = v.split("?")[0];
  return PERMITIDOS.includes(base) ? v : null;
}

/** Junta a mensagem de ok/erro ao endereço de volta. */
export function comAviso(url: string, erro: string | null, ok: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`;
}
