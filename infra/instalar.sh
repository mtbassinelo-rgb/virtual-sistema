#!/usr/bin/env bash
# Instalação inicial do sistema na VPS (Ubuntu 24.04). Rodar UMA vez, como root:
#   bash instalar.sh seudominio.com
# O que faz:
#   1. Atualiza o sistema, liga o firewall (só 22, 80 e 443) e instala o Docker
#   2. Cria uma chave de acesso de leitura ao GitHub (deploy key) e espera você cadastrá-la
#   3. Baixa o código em /opt/virtual
#   4. Gera o arquivo .env com senhas aleatórias (ninguém digita senha)
#   5. Sobe teste e produção, HTTPS e backup diário
set -euo pipefail

DOMINIO="${1:?Uso: bash instalar.sh seudominio.com}"
REPO="git@github.com:mtbassinelo-rgb/virtual-sistema.git"
DESTINO="/opt/virtual"

echo "==> 1/5 Atualizando o servidor e instalando o Docker"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get upgrade -y -qq
apt-get install -y -qq git ufw openssl ca-certificates curl unattended-upgrades
ufw allow 22/tcp >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw --force enable >/dev/null
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

echo "==> 2/5 Chave de acesso ao GitHub (somente leitura)"
mkdir -p ~/.ssh && chmod 700 ~/.ssh
[ -f ~/.ssh/virtual_deploy ] || ssh-keygen -t ed25519 -N "" -C "servidor-virtual" -f ~/.ssh/virtual_deploy >/dev/null
cat > ~/.ssh/config <<EOF
Host github.com
  IdentityFile ~/.ssh/virtual_deploy
  IdentitiesOnly yes
EOF
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null
until git ls-remote "$REPO" >/dev/null 2>&1; do
  echo
  echo "Cadastre esta chave no GitHub:"
  echo "  github.com/mtbassinelo-rgb/virtual-sistema → Settings → Deploy keys → Add deploy key"
  echo "  Título: servidor-virtual   (NÃO marque 'Allow write access')"
  echo
  cat ~/.ssh/virtual_deploy.pub
  echo
  read -r -p "Depois de cadastrar, aperte Enter para continuar… "
done

echo "==> 3/5 Baixando o código"
if [ -d "$DESTINO/.git" ]; then git -C "$DESTINO" pull --ff-only; else git clone -q "$REPO" "$DESTINO"; fi
cd "$DESTINO/infra"

echo "==> 4/5 Configuração com senhas aleatórias"
if [ ! -f .env ]; then
  senha() { openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 40; }
  umask 077
  cat > .env <<EOF
DOMINIO=$DOMINIO
PORTAL_URL=https://$DOMINIO
DB_PRODUCAO_SENHA=$(senha)
DB_TESTE_SENHA=$(senha)
APP_PRODUCAO_SENHA=$(senha)
APP_TESTE_SENHA=$(senha)
EOF
  echo "Arquivo .env criado (só neste servidor)."
else
  echo "Arquivo .env já existe: mantido."
fi

echo "==> 5/5 Subindo teste, produção, HTTPS e backup"
chmod +x atualizar.sh backup.sh ../db/migrar.sh
./atualizar.sh teste
./atualizar.sh producao
docker compose --env-file .env up -d backup

echo
echo "Pronto. Confira:"
echo "  https://app.$DOMINIO     (equipe)"
echo "  https://teste.$DOMINIO   (ambiente de teste)"
echo "  https://$DOMINIO         (área do cliente)"
echo "O certificado HTTPS pode levar alguns minutos na primeira vez."
