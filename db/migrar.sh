#!/usr/bin/env bash
# Aplica as migrações pendentes, em ordem, uma única vez cada.
# Uso: DATABASE_URL=postgres://... ./db/migrar.sh
set -euo pipefail
cd "$(dirname "$0")"
: "${DATABASE_URL:?Defina DATABASE_URL}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "create table if not exists public.migracoes (nome text primary key, aplicada_em timestamptz not null default now())"
for f in migrations/*.sql; do
  nome=$(basename "$f")
  ja=$(psql "$DATABASE_URL" -tAc "select 1 from public.migracoes where nome = '$nome'")
  if [ -z "$ja" ]; then
    echo "Aplicando $nome"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction -f "$f" \
      -c "insert into public.migracoes (nome) values ('$nome')"
  fi
done
echo "Banco atualizado."
