# Virtual Cosméticos · Sistema comercial

Sistema próprio da distribuidora: CRM, pedidos, pagamentos e integrações
(Bling, WhatsApp, marketplaces). Construído em etapas, cada uma testada antes
de ir para o ar.

## Como está organizado

| Pasta | O que tem |
|---|---|
| `db/migrations/` | Estrutura do banco, em ordem. Nunca editar uma migração já aplicada: criar a próxima. |
| `db/testes/` | Testes das regras do banco (permissões, conferência, saldo, auditoria, Bling). |
| `db/migrar.sh` | Aplica as migrações pendentes. Pode rodar várias vezes. |
| `docs/` | Arquitetura, áreas de cada perfil, metas e plano de saída do Bling. |
| `infra/` | Instalação no servidor: Docker, HTTPS (Caddy), backup diário. |
| `.github/workflows/` | Testes automáticos a cada envio ao GitHub. |

## Regras principais (garantidas pelo banco)

- **Bling é a fonte oficial.** A cópia dos pedidos do Bling (`bling_pedidos`) só é
  escrita pela rotina de sincronização. Valor, data, moeda e canal de um pedido do
  Bling não podem ser alterados pelo sistema. Dados do CRM (status comercial,
  previsão de envio, vencimento, observações) ficam separados.
- **Sem duplicidade.** Cada pedido do Bling existe uma vez (chave: ID do Bling).
  Um número do Bling não pode ser usado em dois pedidos. Pedido de planilha
  conferido com um número do Bling é ligado ao pedido do Bling quando ele chega.
- **Mudança no Bling é sinalizada.** Se o pedido muda no Bling depois de revisado,
  aparece "mudou no Bling" até alguém revisar de novo.
- **Pagamento:** a vendedora registra; só gerente ou dono confere, informando o
  número do pedido no Bling. Comprovante enviado não conta como recebido.
  Pagamento conferido ou recusado não pode mais ser alterado.
- **Status de pagamento** calculado: pago, parcial, aguardando, a crédito,
  atrasado, cancelado. Também: envio atrasado (previsão de envio vencida).
- **Perfis:** dono, gerente, vendedora (vê só os próprios clientes e pedidos),
  consulta (só leitura).
- **Auditoria:** toda alteração registra quem, quando, antes e depois. Ninguém
  altera nem apaga a auditoria, nem o administrador do banco.
- **Preços:** no cadastro do cliente ficam o País (define a moeda: Gs ou R$) e a
  categoria Normal ou VIP. O cliente só vê preços da tabela correspondente. O preço
  usado num pedido fica congelado no item; reajustes valem a partir de uma data.
- **Metas com premiação:** vendedora propõe meta por cliente; gerente aprova; o prêmio
  só é liberado com a meta atingida e as compras do período pagas e conferidas.
- **Escrita em sistemas externos** (Bling, marketplaces): só por proposta aprovada
  pelo dono. A execução será feita na etapa de escrita.

## Rodar os testes

```bash
DATABASE_URL=postgresql://usuario:senha@localhost/banco_de_teste ./db/migrar.sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/testes/regras.sql
```

Use sempre um banco de teste: o script cria dados fictícios.

## Etapas

1. Base: banco, regras, permissões, auditoria e instalação ← **em andamento**
2. Aplicação web: login, clientes, pedidos, pagamentos, comprovantes, WhatsApp (link com mensagem pronta)
3. Leitura do Bling (sincronização automática)
4. Relatórios por período, cliente, vendedora e canal
5. Escrita no Bling com aprovação
6. Área do cliente (pedidos pelo site)
7. Marketplaces diretos, WhatsApp oficial, API de otimização

## Pontos a confirmar com dados reais

- Formato exato dos pedidos do Bling (o mapeamento está em `app.bling_upsert_pedido`).
- Moeda dos pedidos do Paraguai no Bling.
- Se Shopee e Mercado Livre já entram pelo Bling.
