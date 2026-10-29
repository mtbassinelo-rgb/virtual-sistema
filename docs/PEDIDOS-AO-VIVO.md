# Pedidos da Shopee e do Mercado Livre ao vivo na área do estoquista

```
Shopee ──push──▶ /api/marketplace/shopee/webhook ──┐                         ┌─ SSE ─▶ tela do estoquista (CD Foz)
                                                   ├─▶ app.marketplace_receber ─ pg_notify ─▶ /api/estoque/ao-vivo
ML ──orders_v2──▶ /api/marketplace/mercadolivre/webhook ┘   (grava, sem repetir)              └─ SSE ─▶ outra aba / gerente
```

- **Webhook** responde 200 na hora. O aviso é gravado em `app.marketplace_avisos` (o mesmo aviso reenviado não entra duas vezes)
  e o pedido entra/atualiza em `app.marketplace_fila`.
- **Banco → telas:** `pg_notify('marketplace_fila', …)`. Cada processo do sistema mantém uma conexão `LISTEN` e repassa às telas abertas.
- **Tela:** `EventSource('/api/estoque/ao-vivo')`. Cada pedido é lido com o usuário logado (RLS): o estoquista só recebe os do estoque dele.
  Pedido novo pisca, toca bipe (depois de "Ligar som"), mostra aviso no canto e, com a aba em segundo plano, notificação do navegador.
  Cancelado: faixa vermelha ("não envie" ou "devolva à prateleira" se já estava separado).
- **Estoque:** a fila **não** baixa estoque. A baixa continua pelo lançamento das vendas (Estoque → Vendas de marketplace), que não repete pedido.
  O cartão mostra "baixa no estoque feita" quando o pedido já foi lançado.

## Segurança dos avisos
| | Mercado Livre | Shopee |
|---|---|---|
| Chave no endereço (`?chave=`) | obrigatória (`MARKETPLACE_WEBHOOK_SEGREDO`) | obrigatória |
| Assinatura | o ML **não assina** os avisos | cabeçalho `Authorization` = HMAC-SHA256 hex de `URL|corpo` com a partner key — **confirmar no console da Shopee antes de ativar** |
| Conferência | `application_id` = `ML_APP_ID`, `user_id` = `ML_USER_ID`; o pedido é **relido na API** (`GET /orders/{id}`) | `shop_id` = `SHOPEE_SHOP_ID`, `code` = 3 |
| IPs de origem (opcional, no Caddy) | 54.88.218.97, 18.215.140.160, 18.213.114.129, 18.206.34.84 | — |

## Simular (ambiente teste)
No teste, `MARKETPLACE_WEBHOOK_TESTE=1`: aceita aviso da Shopee sem assinatura e lê itens de exemplo em `_teste_detalhes`.

1. Abra `https://teste.<domínio>/estoque/separacao` logado como estoquista do CD Foz e clique em **Ligar som**.
2. Em outro terminal:
   ```
   node scripts/simular-webhook-marketplace.mjs https://teste.<domínio> <MARKETPLACE_WEBHOOK_SEGREDO_TESTE> shopee
   node scripts/simular-webhook-marketplace.mjs https://teste.<domínio> <MARKETPLACE_WEBHOOK_SEGREDO_TESTE> ml
   node scripts/simular-webhook-marketplace.mjs https://teste.<domínio> <MARKETPLACE_WEBHOOK_SEGREDO_TESTE> shopee-cancelar TESTE123
   ```
3. Postman/Insomnia: `POST https://teste.<domínio>/api/marketplace/shopee/webhook?chave=<segredo>`, corpo JSON:
   ```json
   {"shop_id":123456,"code":3,"timestamp":1761700000,
    "data":{"ordersn":"TESTE001","status":"READY_TO_SHIP","update_time":1761700000},
    "_teste_detalhes":{"comprador":"ana","itens":[{"sku":"TESTE-001","descricao":"Creme 500g","quantidade":2,"valor":29.9}],"total":59.8}}
   ```
   Repetir o mesmo corpo não cria outro cartão. Trocar `status` para `CANCELLED` mostra a faixa vermelha.
4. Ver o canal ao vivo sem a tela: `curl -N -H "Cookie: vc_sessao=<cookie>" https://teste.<domínio>/api/estoque/ao-vivo`.

## Ativar em produção (depois dos testes)
1. `.env` do servidor: `MARKETPLACE_WEBHOOK_SEGREDO` (`openssl rand -hex 24`), `ML_APP_ID`, `ML_USER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_SHOP_ID`, `SHOPEE_PUSH_URL`.
2. ML (developers.mercadolivre.com.br → seu app → Notificações): tópico **orders_v2**, URL
   `https://app.<domínio>/api/marketplace/mercadolivre/webhook?chave=<segredo>`.
3. Shopee (Open Platform → App → Push Mechanism): **Order Status Push**, a mesma URL com `/shopee/`; copiar a URL inteira para `SHOPEE_PUSH_URL`.

## Próximos passos
- OAuth com renovação automática (ML: token de 6 h; Shopee: `get_order_detail` assinado) para trazer os itens de verdade. Hoje,
  sem token, o cartão aparece com o número e "aguardando os itens do marketplace".
- Conferência periódica (`/orders/search` no ML, `get_order_list` na Shopee) para pegar aviso perdido.
- Baixa automática no estoque quando o pedido chega pago (depois de a leitura estar confiável).
