#!/usr/bin/env bash
#
# Prepara uma VM Ubuntu limpa e sobe a stack completa.
#
#   curl -fsSL https://raw.githubusercontent.com/mello13256/Talk-with-me/claude/private-client-messaging-system-ga3zyt/deploy/setup-vm.sh | bash
#
# Ou, tendo o repositório clonado:  bash deploy/setup-vm.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/mello13256/Talk-with-me.git}"
BRANCH="${BRANCH:-claude/private-client-messaging-system-ga3zyt}"
APP_DIR="${APP_DIR:-$HOME/talk-with-me}"

info() { printf '\n\033[36m==>\033[0m %s\n' "$1"; }

if [[ $EUID -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

info "Instalando Docker (se necessário)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | $SUDO sh
  $SUDO usermod -aG docker "$USER" || true
fi

info "Baixando o código"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" checkout "$BRANCH" && git -C "$APP_DIR" pull origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

if [[ ! -f .env ]]; then
  info "Gerando .env com segredos aleatórios"
  cp .env.example .env

  gen() { openssl rand -base64 36 | tr -d '/+=' | cut -c1-40; }

  # Replace the key if .env.example already defines it, append otherwise.
  # Blindly appending would leave two definitions of the same variable, and
  # which one wins is not something to leave to chance in a secrets file.
  set_env() {
    local key="$1" value="$2"
    if grep -qE "^${key}=" .env; then
      # Value goes through the replacement via a placeholder, so characters
      # such as & and / in a generated secret are never seen by sed.
      awk -v k="$key" -v v="$value" -F= 'BEGIN{OFS="="} $1==k {print k, v; next} {print}' .env > .env.tmp
      mv .env.tmp .env
    else
      printf '%s=%s\n' "$key" "$value" >> .env
    fi
  }
  SESSION_SECRET="$(gen)"; PASSWORD_PEPPER="$(gen)"
  POSTGRES_PASSWORD="$(gen)"; ADMIN_PASSWORD="$(gen)Aa1!"

  read -rp "Domínio (ex.: atendimento.seudominio.com): " DOMAIN
  read -rp "E-mail para o certificado HTTPS: "          ACME_EMAIL
  read -rp "E-mail de login do administrador: "         ADMIN_EMAIL

  set_env NODE_ENV          production
  set_env DOMAIN            "$DOMAIN"
  set_env ACME_EMAIL        "$ACME_EMAIL"
  set_env APP_URL           "https://$DOMAIN"
  set_env TRUST_PROXY       1
  set_env SESSION_SECRET    "$SESSION_SECRET"
  set_env PASSWORD_PEPPER   "$PASSWORD_PEPPER"
  set_env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
  set_env ADMIN_EMAIL       "$ADMIN_EMAIL"
  set_env ADMIN_PASSWORD    "$ADMIN_PASSWORD"
  chmod 600 .env

  # Fail loudly rather than starting with a half-written secrets file.
  for required in SESSION_SECRET PASSWORD_PEPPER POSTGRES_PASSWORD DOMAIN ACME_EMAIL; do
    if ! grep -qE "^${required}=.+" .env; then
      echo "ERRO: $required ficou vazio no .env" >&2
      exit 1
    fi
  done

  info "Senha do administrador (anote agora):"
  printf '\n    %s\n    %s\n\n' "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
fi

info "Subindo a stack (a primeira vez compila a imagem, leva alguns minutos)"
$SUDO docker compose -f docker-compose.prod.yml up -d --build

info "Pronto. Acompanhe os logs com:"
echo "    cd $APP_DIR && sudo docker compose -f docker-compose.prod.yml logs -f app"
echo ""
info "Depois de entrar e trocar a senha, remova ADMIN_PASSWORD do .env e rode:"
echo "    sudo docker compose -f docker-compose.prod.yml up -d"
