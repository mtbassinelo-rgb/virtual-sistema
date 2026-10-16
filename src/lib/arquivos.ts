import path from "node:path";

/** Pasta onde ficam os comprovantes no servidor (fora da pasta pública). */
export function pastaArquivos(): string {
  return process.env.ARQUIVOS_DIR ?? path.join(process.cwd(), "dados", "comprovantes");
}

/** Pasta das fotos de produto (públicas, aparecem no site). */
export function pastaFotos(): string {
  return path.join(path.dirname(pastaArquivos()), "fotos");
}

/** Tipo da imagem pelo conteúdo do arquivo (não pela extensão informada). */
export function tipoImagem(b: Buffer): "jpg" | "png" | "webp" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}
