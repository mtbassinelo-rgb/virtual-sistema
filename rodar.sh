#!/bin/bash
# uso: bash rodar.sh [1=simular]
cd /opt/virtual/infra
S=$(grep '^DB_PRODUCAO_SENHA=' .env | cut -d= -f2-)
docker compose --env-file .env run --rm -T -v /root/c4:/carga -v /root/c4/aplicar.mjs:/app/aplicar-c4.mjs \
  -e SIMULAR=${1:-0} -e DATABASE_URL_ADMIN="postgresql://virtual_admin:${S}@db-producao/virtual" app-producao node aplicar-c4.mjs
