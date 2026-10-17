#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  apt update
  apt install -y ca-certificates curl git openssh-client

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

  apt update
  apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

if [ ! -f .env ]; then
  DB_PASSWORD="$(openssl rand -hex 32)"
  BELT_CONNECTION_ENCRYPTION_KEY="$(openssl rand -base64 32)"

  cat > .env <<EOF
META_DB_HOST=postgres-meta
META_DB_PORT=5432
META_DB_EXTERNAL_PORT=5432
META_DB_NAME=belt_db
META_DB_USER=postgres
META_DB_PASSWORD=${DB_PASSWORD}

PYTHON_EXECUTABLE=python
ROUTE_SCRIPT_PATH=/app/myetl/parser/route.py

BACKEND_PORT=8000
FRONTEND_PORT=80

BELT_ENVIRONMENT=DEV
BELT_API_DOCS_ENABLED=false
BELT_CONNECTION_ENCRYPTION_KEY=${BELT_CONNECTION_ENCRYPTION_KEY}

BELT_TRANSFER_IMPORT_ENABLED=true
BELT_TRANSFER_EXPORT_ENABLED=true
BELT_TRANSFER_EXPORT_CREATION_ENABLED=true
EOF
fi

if ! grep -q '^BELT_ENVIRONMENT=' .env; then
  echo 'BELT_ENVIRONMENT=DEV' >> .env
fi

git fetch --depth 1 origin main
git reset --hard origin/main

sed "s|\${SERVER_IP}|${SERVER_IP}|g" \
  keycloak/belt-realm.template.json \
  > keycloak/belt-realm.json

mkdir -p ../belt_data/user_workspace/python_scripts/templates

if [ ! -f ../belt_data/.examples_initialized ]; then
  cp -rn user_workspace/python_scripts/templates/. \
    ../belt_data/user_workspace/python_scripts/templates/
  touch ../belt_data/.examples_initialized
fi

docker compose --env-file .env up -d --build
