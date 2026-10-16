#!/usr/bin/env bash
# Atualiza um ambiente com a versão mais recente do GitHub.
#   ./atualizar.sh teste      -> publica em teste.<dominio>
#   ./atualizar.sh producao   -> publica em app.<dominio> (depois de aprovar no teste)
set -euo pipefail
cd "$(dirname "$0")"
alvo="${1:?Informe: teste ou producao}"
[[ "$alvo" == "teste" || "$alvo" == "producao" ]] || { echo "Use teste ou producao"; exit 1; }
set -a; . ./.env; set +a
git -C .. pull --ff-only
senha_var="DB_$(echo "$alvo" | tr a-z A-Z)_SENHA"; app_var="APP_$(echo "$alvo" | tr a-z A-Z)_SENHA"
# rede e pasta compartilhadas com o Instituto Supremo (o Caddy atende os dois sistemas)
docker network create supremo-web >/dev/null 2>&1 || true
mkdir -p /opt/caddy-extra
docker compose --env-file .env up -d "db-$alvo"
# espera o banco aceitar conexões (na primeira vez ele leva alguns segundos para iniciar)
for i in $(seq 1 60); do
  docker run --rm --network virtual_interna postgres:16 pg_isready -q -h "db-$alvo" -U virtual_admin && break
  [ "$i" = 60 ] && { echo "O banco db-$alvo não respondeu."; exit 1; }
  sleep 2
done
# 1) estrutura do banco
docker run --rm --network virtual_interna -v "$(cd .. && pwd)/db:/db" \
  -e DATABASE_URL="postgresql://virtual_admin:${!senha_var}@db-$alvo/virtual" postgres:16 bash /db/migrar.sh
# 2) senha do papel da aplicação
docker run --rm --network virtual_interna postgres:16 psql "postgresql://virtual_admin:${!senha_var}@db-$alvo/virtual" \
  -qc "alter role vc_app login password '${!app_var}'"
# 3) aplicação
docker compose --env-file .env build "app-$alvo"
docker compose --env-file .env up -d "app-$alvo" caddy
echo "Ambiente $alvo atualizado."
