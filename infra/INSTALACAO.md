# Instalação no servidor (Hostinger VPS)

Feita uma única vez, com você logado no painel da Hostinger.
Depois disso, as atualizações chegam pelo GitHub.

## Antes de começar

1. **VPS:** Hostinger KVM 2 com **Ubuntu 24.04**.
2. **Domínio:** no painel do domínio, crie dois registros do tipo **A** apontando
   para o IP da VPS:
   - `app` → IP da VPS (produção)
   - `teste` → IP da VPS (ambiente de teste)
3. **GitHub:** repositório privado `virtual-sistema` com este código.

## Passo a passo (terminal do painel da Hostinger)

```bash
# 1. Instalar Docker
curl -fsSL https://get.docker.com | sh

# 2. Baixar o código (o GitHub pede autorização na primeira vez)
git clone https://github.com/<sua-conta>/virtual-sistema.git /opt/virtual
cd /opt/virtual/infra

# 3. Criar o arquivo de configuração com senhas longas e o seu domínio
cp .env.exemplo .env
nano .env

# 4. Subir bancos, HTTPS e backup
docker compose --env-file .env up -d

# 5. Criar a estrutura dos bancos (teste e produção)
set -a; . ./.env; set +a
for alvo in teste producao; do
  senha_var="DB_$(echo $alvo | tr a-z A-Z)_SENHA"
  docker run --rm --network virtual_interna -v /opt/virtual/db:/db \
    -e DATABASE_URL="postgresql://virtual_admin:${!senha_var}@db-$alvo/virtual" \
    postgres:16 bash /db/migrar.sh
done
```

> As senhas do `.env` são digitadas por você. Elas ficam só no servidor e
> nunca vão para o GitHub.

## Conferir

- `https://app.<seu-dominio>` mostra "sistema em instalação" com cadeado (HTTPS).
- `docker compose ps` mostra todos os serviços "running".
- `docker compose logs backup` mostra o primeiro backup criado.

## Próximos passos (feitos nas próximas etapas)

- Instalar a aplicação web e ligar a publicação automática pelo GitHub.
- Enviar o backup diário também para fora do servidor (Google Drive).
- Criar os usuários: dono, gerente e as vendedoras.
