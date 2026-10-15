#!/usr/bin/env bash
# Backup diário do banco de produção.
# Gera um arquivo compactado por dia em /backups e apaga os de mais de 30 dias.
# Próximo passo: enviar uma cópia para fora do servidor (Google Drive, via rclone).
set -euo pipefail
arquivo="/backups/virtual-$(date +%Y-%m-%d_%H%M).sql.gz"
pg_dump --no-owner --format=plain | gzip > "$arquivo"
echo "Backup criado: $arquivo ($(du -h "$arquivo" | cut -f1))"
find /backups -name 'virtual-*.sql.gz' -mtime +30 -delete
