# Arquitetura e áreas do sistema

## Quem usa o quê

### Área da vendedora (`app.<dominio>`)
- **Hoje:** clientes para contatar e por quê (recompra, pós-venda, saldo a cobrar,
  meta perto de vencer), pedidos com envio atrasado, pagamentos recusados para corrigir.
- **Meus clientes:** só os dela. Cadastro com país e preço Normal/VIP, histórico de
  compras, pedidos em aberto, atendimentos e botão de WhatsApp com mensagem pronta,
  enviado do número dela.
- **Pedidos:** lista com filtros (nº Bling, cliente, período, status comercial, status
  de pagamento, modalidade, canal), detalhe do pedido, previsão de envio.
- **Pagamentos:** registra o pagamento e anexa o comprovante. Vê se o gerente
  conferiu ou recusou (e o motivo).
- **Metas:** propõe meta por cliente (valor a comprar, prazo, prêmio). Acompanha o
  andamento: vendido, falta, dias restantes, prêmio liberado ou bloqueado.
- **Meu resultado:** vendas do mês, recebido, saldo em aberto, metas dos clientes.

### Área do gerente
- Tudo da vendedora, para todas as vendedoras.
- **Conferência:** fila de pagamentos a conferir; confere com o nº do pedido no Bling
  ou recusa com motivo.
- **Metas:** fila de propostas para aprovar ou recusar; registro de entrega de prêmios.
- **Preços:** reajustes com data de vigência.
- **Relatórios:** por período, cliente, vendedora e canal (vendido, recebido, saldo,
  quantidade de pedidos, metas e prêmios).
- **Auditoria:** histórico de alterações de qualquer registro.

### Área do dono
- Tudo do gerente, mais: usuários e perfis, aprovação de escritas em sistemas
  externos (Bling, marketplaces), integrações.

### Área do cliente (`<dominio>`, etapa 6)
- Entra com o número de WhatsApp (código de acesso).
- Catálogo com **o preço dele** (país + Normal/VIP), na moeda dele.
- Carrinho e pedido: entra como "aguardando aprovação" para a vendedora.
- Meus pedidos: status, previsão de envio, saldo e vencimentos; envio de comprovante.
- **Minha meta:** se houver meta aprovada, mostra o andamento, por exemplo
  "Faltam Gs 5.000.000 para ganhar Gs 1.000.000 em mercadorias. Restam 12 dias."
- O cliente nunca vê dados internos (observações, outras vendedoras, margens).

## Metas com premiação
1. A vendedora propõe: cliente, período (até 1 ano), valor a comprar, prêmio.
2. O gerente aprova ou recusa (com motivo). Aprovada, não muda mais.
3. O sistema soma os pedidos do cliente no período (sem cancelados).
4. No fim do prazo: atingida ou não atingida, com o valor congelado.
5. Prêmio liberado só com as compras do período pagas e conferidas.
6. O gerente registra a entrega (pode ligar a um pedido de bonificação).

## Estoque e depósitos
- Depósitos: **CD Principal (Foz do Iguaçu)** e **Loja Ciudad del Este**. Outros podem ser criados.
- O estoque é um extrato: compra, venda, transferência, ajuste, devolução e perda são
  lançamentos que não se alteram nem se apagam. Erro se corrige com ajuste (com motivo).
- O saldo nunca fica negativo: uma saída maior que o saldo é barrada.
- **Transferência:** rascunho → enviada (sai da origem, fica "a receber" no destino)
  → recebida, com a quantidade conferida na chegada. Diferença fica registrada.
- **Quem opera cada depósito:** gerente, dono e os responsáveis do depósito
  (ex.: quem atende na loja de CDE).
- **De onde cada vendedora vende:** o gerente define os depósitos permitidos e o
  padrão de cada vendedora. Pedido de depósito não autorizado é barrado.
- Pedido marcado como "enviado" baixa o estoque do depósito; cancelado depois do
  envio, a mercadoria volta como devolução.
- Na fase A o estoque oficial continua no Bling; este roda em paralelo para conferência.

## Bling: de fonte oficial a emissor de nota

O plano é tirar aos poucos tudo do Bling, deixando com ele só a emissão de NF-e.

| Fase | Pedidos | Estoque | Bling |
|---|---|---|---|
| **A (agora)** | Nascem no Bling, sistema lê | Bling | Fonte oficial |
| **B** | Nascem no sistema (vendedora e área do cliente) | Bling | Recebe o pedido só para emitir NF-e, por escrita aprovada |
| **C** | Sistema | Sistema (entradas de compra, saídas por pedido) | Só NF-e |

A estrutura já está preparada para isso:
- A origem de cada pedido fica registrada (`bling`, `planilha`, `portal`, `manual`),
  e as regras de "não alterar" valem só para pedidos de origem Bling.
- Toda escrita no Bling passa por `escritas_externas` (proposta → aprovação → execução
  registrada); emitir NF-e será uma dessas operações.
- Antes de cada virada de fase: período em paralelo comparando sistema e Bling,
  e só então a troca.
