#!/usr/bin/env bash
# Roda todos os testes do banco num banco de TESTE vazio.
set -uo pipefail
cd "$(dirname "$0")"
: "${DATABASE_URL:?Defina DATABASE_URL (banco de teste)}"
./migrar.sh || exit 1
for t in regras precos metas sessoes estoque atacado kits importacao gestao importacao_lote caixa inteligencia recompra custos marcas precificacao; do
  if ! saida=$(psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "testes/$t.sql" 2>&1); then
    echo "$saida" | grep -E "FALHOU|ERROR" ; echo "Falhou em $t"; exit 1
  fi
  echo "$saida" | grep -E "passaram"
done
echo "Todos os testes do banco passaram."
