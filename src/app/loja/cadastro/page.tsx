import { TEXTOS, idiomaAtual } from "@/lib/idioma";
import { FormularioCadastro } from "./formulario";

export const metadata = { title: "Quero ser cliente" };

export default async function Cadastro() {
  const t = TEXTOS[await idiomaAtual()];
  return (
    <div className="in pagina cadastro">
      <h1>{t.cadTitulo}</h1>
      <p className="cadastro-texto">{t.cadTexto}</p>
      <FormularioCadastro t={{
        cadNome: t.cadNome, cadContato: t.cadContato, whatsapp: t.whatsapp, cadEmail: t.cadEmail, cadCidade: t.cadCidade,
        cadTipo: t.cadTipo, cadDoc: t.cadDoc, cadMsg: t.cadMsg, cadEnviar: t.cadEnviar, cadAviso: t.cadAviso, enviando: t.enviando,
        tipos: Object.entries(t.cadTipos),
      }} />
    </div>
  );
}
