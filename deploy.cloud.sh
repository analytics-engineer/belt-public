#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")"

SERVER_IP="${1:-}"
if [[ -z "$SERVER_IP" ]]; then
  echo "Error: server IP is required." >&2
  echo "Usage: sudo ./deploy.cloud.sh <SERVER_IP>" >&2
  exit 1
fi

if [[ ! "$SERVER_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  echo "Error: '$SERVER_IP' is not a valid IPv4 address." >&2
  exit 1
fi

IFS='.' read -r -a IP_PARTS <<< "$SERVER_IP"
for part in "${IP_PARTS[@]}"; do
  if (( part > 255 )); then
    echo "Error: '$SERVER_IP' is not a valid IPv4 address." >&2
    exit 1
  fi
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Error: run this script as root or with sudo." >&2
  exit 1
fi

if [[ ! -f /etc/os-release ]]; then
  echo "Error: cannot detect the server operating system." >&2
  exit 1
fi

. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "Error: this script supports Ubuntu. Detected: ${ID:-unknown}." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl git openssl openssh-client

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

systemctl enable --now docker

if [[ ! -f .env ]]; then
  META_DB_PASSWORD="$(openssl rand -hex 32)"
  KEYCLOAK_DB_PASSWORD="$(openssl rand -hex 32)"
  KEYCLOAK_ADMIN_PASSWORD="$(openssl rand -hex 32)"
  BELT_CONNECTION_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"

  cat > .env <<EOF
BELT_ENVIRONMENT=PROD
BELT_API_DOCS_ENABLED=false
APP_ENV=production

META_DB_HOST=postgres-meta
META_DB_PORT=5432
META_DB_EXTERNAL_PORT=5432
META_DB_NAME=belt_db
META_DB_USER=postgres
META_DB_PASSWORD=${META_DB_PASSWORD}

PYTHON_EXECUTABLE=python
ROUTE_SCRIPT_PATH=/app/myetl/parser/route.py
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/1
CELERY_RESULT_EXPIRES=432000
BELT_CONNECTION_ENCRYPTION_KEY=${BELT_CONNECTION_ENCRYPTION_KEY}

KEYCLOAK_DB_PASSWORD=${KEYCLOAK_DB_PASSWORD}
KEYCLOAK_ADMIN_USERNAME=admin
KEYCLOAK_ADMIN_PASSWORD=${KEYCLOAK_ADMIN_PASSWORD}
KEYCLOAK_PUBLIC_URL=http://${SERVER_IP}:8080
KEYCLOAK_PORT=8080

REACT_APP_OIDC_REQUIRED=true
REACT_APP_OIDC_ISSUER_URL=http://${SERVER_IP}:8080/realms/belt
REACT_APP_OIDC_CLIENT_ID=belt-frontend
REACT_APP_OIDC_REDIRECT_URI=http://${SERVER_IP}/
REACT_APP_OIDC_SCOPE=openid profile email

OIDC_REQUIRED=true
OIDC_ISSUER_URL=http://${SERVER_IP}:8080/realms/belt
OIDC_CLIENT_ID=belt-frontend
OIDC_JWKS_URL=http://keycloak:8080/realms/belt/protocol/openid-connect/certs

BELT_TRANSFER_IMPORT_ENABLED=true
BELT_TRANSFER_EXPORT_ENABLED=false
BELT_TRANSFER_EXPORT_CREATION_ENABLED=false
EOF
  chmod 600 .env
else
  echo "Using existing .env; production secrets and server URLs were not changed." >&2
fi

if grep -q '^BELT_ENVIRONMENT=production$' .env; then
  sed -i 's/^BELT_ENVIRONMENT=production$/BELT_ENVIRONMENT=PROD/' .env
fi

git fetch --depth 1 origin main
git reset --hard origin/main

sed "s|\${SERVER_IP}|${SERVER_IP}|g" \
  keycloak/belt-realm.template.json \
  > keycloak/belt-realm.json

mkdir -p ../belt_data/user_workspace/python_scripts/templates

cp -rn user_workspace/python_scripts/templates/. \
  ../belt_data/user_workspace/python_scripts/templates/

docker compose --env-file .env -f docker-compose.yml up -d --build

echo "Belt is running at: http://${SERVER_IP}/"
echo "Keycloak is available at: http://${SERVER_IP}:8080/"
