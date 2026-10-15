# Instalação no servidor (Hostinger VPS)

Feita uma única vez, com você logado no painel da Hostinger.
Depois disso, cada atualização é um comando (ver "Atualizar").

## Antes de começar

1. **VPS:** Hostinger KVM 2 com **Ubuntu 24.04**.
2. **Domínio:** crie dois registros do tipo **A** apontando para o IP da VPS:
   `app` (produção) e `teste` (ambiente de teste).
3. **GitHub:** repositório `mtbassinelo-rgb/virtual-sistema` (já criado).

## Passo a passo (terminal do painel da Hostinger)

```bash
# 1. Instalar Docker
curl -fsSL https://get.docker.com | sh

# 2. Baixar o código (o GitHub pede autorização na primeira vez)
git clone https://github.com/mtbassinelo-rgb/virtual-sistema.git /opt/virtual
cd /opt/virtual/infra

# 3. Configuração: domínio e senhas longas (só neste servidor, nunca no GitHub)
cp .env.exemplo .env
nano .env

# 4. Subir tudo: bancos, aplicação, HTTPS e backup
./atualizar.sh teste
./atualizar.sh producao
docker compose --env-file .env up -d backup
```

## Criar os usuários

Rode uma vez para cada pessoa (a senha é pedida na tela e não aparece):

```bash
cd /opt/virtual/infra && set -a && . ./.env && set +a
usuario() {
  docker compose --env-file .env run --rm -e DATABASE_URL_ADMIN="postgresql://virtual_admin:${DB_PRODUCAO_SENHA}@db-producao/virtual" \
    app-producao node scripts/criar-usuario.mjs "$@"
}
usuario seu@email.com "Seu Nome" dono
usuario gerente@email.com "Nome do Gerente" gerente
```

Para vendedoras, cadastre a vendedora primeiro (nome, país e moeda) e depois o usuário:

```bash
docker compose --env-file .env exec -T db-producao psql -U virtual_admin -d virtual -c \
  "insert into app.vendedoras (nome, pais, moeda, whatsapp) values ('Keila','PY','GS','5959...')"
usuario keila@email.com "Keila" vendedora Keila
```

## Atualizar

1. `./atualizar.sh teste` → confira em `https://teste.<dominio>`.
2. Aprovado? `./atualizar.sh producao`.

Os testes do GitHub precisam estar verdes antes de qualquer atualização.

## Conferir

- `https://app.<dominio>` abre a tela de login com cadeado (HTTPS).
- `docker compose ps` mostra os serviços "running".
- `docker compose logs backup` mostra o backup diário.

## Pendente

- Copiar o backup diário (banco e comprovantes) para fora do servidor (Google Drive).
- Atualização automática do ambiente de teste a cada envio ao GitHub.
