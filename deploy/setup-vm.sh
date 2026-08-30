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
  SESSION_SECRET="$(gen)"; PASSWORD_PEPPER="$(gen)"
  POSTGRES_PASSWORD="$(gen)"; ADMIN_PASSWORD="$(gen)Aa1!"

  read -rp "Domínio (ex.: atendimento.seudominio.com): " DOMAIN
  read -rp "E-mail para o certificado HTTPS: "          ACME_EMAIL
  read -rp "E-mail de login do administrador: "         ADMIN_EMAIL

  {
    echo ""
    echo "# --- gerado por deploy/setup-vm.sh ---"
    echo "DOMAIN=$DOMAIN"
    echo "ACME_EMAIL=$ACME_EMAIL"
    echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
    echo "ADMIN_EMAIL=$ADMIN_EMAIL"
    echo "ADMIN_PASSWORD=$ADMIN_PASSWORD"
  } >> .env

  # Substitui os placeholders do .env.example pelos segredos reais.
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$SESSION_SECRET|"   .env
  sed -i "s|^PASSWORD_PEPPER=.*|PASSWORD_PEPPER=$PASSWORD_PEPPER|" .env
  chmod 600 .env

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
