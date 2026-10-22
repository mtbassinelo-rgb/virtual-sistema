import { ehGestao, exigirUsuario } from "@/lib/auth";
import { PLANILHA_FORNECEDORES } from "./dados";

export const metadata = { title: "Comparativo de fornecedores" };

// Onde comprar mais barato cada item (preço por unidade, sem frete) – resumo da planilha
const RESUMO: { item: string; melhor: string; obs: string }[] = [
  { item: "Extensão fio a fio (YY, 3D–6D W)", melhor: "Dafu – Fadvan R$11 a 22", obs: "Nagaraku/DeceMars no atacado R$20 a 38. Fábrica Fadvan na China ~R$10 a 15 posto no Brasil." },
  { item: "Tufinho / cluster", melhor: "Maquiagem Atacado R$2,19 · Zhang R$3,70+", obs: "Mega caixas: Dafu R$9,58 a 13." },
  { item: "Kit tufinho + pinça + cola", melhor: "Zaxapp R$16,67", obs: "Dafu R$19,80 a 20." },
  { item: "Cílios postiços em tira", melhor: "Maquiagem Atacado R$1,50 o par", obs: "Zhang R$3 a 3,50; Dafu R$5 a 7,50." },
  { item: "Cola de cílios", melhor: "Nexxo Duo Eye R$1,54 (caixa fechada)", obs: "Zhang Eye R$1,66. Salon Pro 30ml na Nexxo R$4,20 (varejo ~R$25–30)." },
  { item: "Unha postiça press-on", melhor: "Dafu R$1,83 a 6", obs: "Zaxapp R$2,33 a 2,50. Macrilan na Zhang R$7 a 9." },
  { item: "Esmalte em gel", melhor: "Fonte da Beleza R$5,00", obs: "Zhang R$5,50; Dafu R$8 a 11 (marca conhecida)." },
  { item: "Esmalte comum", melhor: "Zhang R$1,50 a 1,75", obs: "Dafu R$3 a 7,50." },
  { item: "Base / top / prep", melhor: "Fonte da Beleza R$4 (X&D)", obs: "Dafu R$7,50 a 12." },
  { item: "Gel (painting / construtor)", melhor: "Fonte da Beleza R$5 / R$6", obs: "Dafu R$6 / R$8." },
  { item: "Cola de unha", melhor: "Zaxapp R$1,00 · Nexxo R$1,27", obs: "Dafu R$2,25." },
  { item: "Lixas, alicates, pincéis", melhor: "Fonte da Beleza", obs: "Lixa R$0,64 a 1,28, alicate R$5, pincel R$1,50." },
  { item: "Cabines e motor", melhor: "Fonte da Beleza", obs: "Mini cabine R$5,50, motor caneta R$20, cabine R$60." },
];

export default async function Fornecedores() {
  const u = await exigirUsuario();
  if (!ehGestao(u)) return <div className="painel">Só gerente ou dono vê o comparativo de fornecedores.</div>;
  return (
    <>
      <section className="cabecalho-pagina">
        <div>
          <h1>Comparativo de fornecedores</h1>
          <p>Cílios e unhas: Dafu, Zhang, Fonte da Beleza, Nexxo, outros atacados e China. Preços de {PLANILHA_FORNECEDORES.data}.</p>
        </div>
        <a className="botao principal" href="/inteligencia/fornecedores/planilha">Baixar planilha (Excel)</a>
      </section>

      <section className="painel">
        <h2>Onde está mais barato</h2>
        <div className="tabela">
          <table>
            <thead><tr><th>Item</th><th>Melhor preço por unidade</th><th>Comparação</th></tr></thead>
            <tbody>
              {RESUMO.map((r) => (
                <tr key={r.item}><td>{r.item}</td><td><b>{r.melhor}</b></td><td className="pequeno">{r.obs}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pequeno suave" style={{ margin: 0 }}>
          A planilha tem todos os itens (abas Dafu, Zhang, Outros fornecedores e Referência de varejo), com filtros e uma coluna
          para lançar o preço de venda e ver a margem. Preços sem frete; confirme com o fornecedor antes de comprar.
        </p>
      </section>
    </>
  );
}
