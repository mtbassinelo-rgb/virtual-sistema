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
docker compose --env-file .env up -d "db-$alvo"
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
