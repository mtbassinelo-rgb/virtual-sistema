import path from "node:path";

/** Pasta onde ficam os comprovantes no servidor (fora da pasta pública). */
export function pastaArquivos(): string {
  return process.env.ARQUIVOS_DIR ?? path.join(process.cwd(), "dados", "comprovantes");
}
