# Belt

Belt is an open-source ETL application for designing and running data workflows. It includes a web interface, a Python API, background workers, scheduling, and metadata storage.

## Features

- Build and monitor workflow chains through a visual interface.
- Work with PostgreSQL, ClickHouse, and Python-based transformations.
- Schedule workflow runs and inspect their execution history.
- Review data lineage and manage transfer packages.

## Deploy to a public server (recommended)

This is the primary, production-oriented way to run Belt: on a fresh Ubuntu server, reachable at that server's public IPv4 address. Neither this script nor the repository sets up a domain name, TLS/HTTPS, or a reverse proxy — put your own (e.g., Nginx, Caddy, Traefik) with TLS in front of Belt if you need a domain and HTTPS.

### Requirements

- A fresh Ubuntu server with a public IPv4 address, and root access.
- A clone of this repository on that server (the script re-syncs it with `origin/main`).

### Start

Run as root, passing the server's public IPv4 address:

```sh
sudo ./deploy.cloud.sh <SERVER_IP>
```

This script:

- Verifies it's running on Ubuntu as root, and installs Docker if it's missing.
- Runs `git fetch --depth 1 origin main` and `git reset --hard origin/main`, which discards any uncommitted changes in the checkout. Review the script and back up local changes before running it.
- Generates `.env` only if one doesn't already exist, with `BELT_ENVIRONMENT=PROD`, `APP_ENV=production`, random database/Keycloak passwords and `BELT_CONNECTION_ENCRYPTION_KEY`, and OIDC enabled (`OIDC_REQUIRED=true`) pointing at a Keycloak instance served from the same server at `http://<SERVER_IP>:8080`.
- Disables the transfer export and export-creation features by default in production (only import stays enabled).
- Starts the stack with `docker compose up -d --build` and prints the resulting Belt and Keycloak URLs.

Belt becomes reachable at `http://<SERVER_IP>/`, and Keycloak at `http://<SERVER_IP>:8080/`.

### Temporary demo without HTTPS

The default public-server URLs use HTTP. Keycloak may show `HTTPS required` when you open its admin console through the public IP.

For a temporary demo, run the following **on the remote server**, from the repository directory. Authenticate using `KEYCLOAK_ADMIN_USERNAME` from `.env` (normally `admin`):

```sh
docker exec -it belt-keycloak /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master --user admin
```

Enter `KEYCLOAK_ADMIN_PASSWORD` from `.env` when prompted. Then allow HTTP for the admin realm:

```sh
docker exec belt-keycloak /opt/keycloak/bin/kcadm.sh update realms/master -s sslRequired=NONE
```

Open `http://<SERVER_IP>:8080/admin/`. Once the `belt` realm exists, allow HTTP for it as well:

```sh
docker exec belt-keycloak /opt/keycloak/bin/kcadm.sh update realms/belt -s sslRequired=NONE
```

The supplied Belt realm template already contains `"sslRequired": "none"`; if it was imported successfully, the second update is unnecessary. A `Resource not found` response means the `belt` realm must first be created or imported.

These settings persist in the Keycloak database across container restarts. `KC_HTTP_ENABLED=true` alone does not disable a realm's HTTPS requirement.

**HTTP does not encrypt passwords or tokens in transit. Use disposable demo credentials and no sensitive data.** This setting only removes Keycloak's HTTPS restriction; browser features used for OIDC/PKCE may still require HTTPS on a public IP. For production, configure HTTPS for Belt and Keycloak, update their public/OIDC and client redirect URLs, and restore **Require SSL** to **External requests** (or **All requests**) in both realms.

### Finish the Keycloak setup

This script does not provision the Keycloak realm or client it configures (`belt` / `belt-frontend`). After it finishes:

1. Log in to Keycloak at `http://<SERVER_IP>:8080` with the admin credentials written to `.env` on the server.
2. Create the `belt` realm and the `belt-frontend` client yourself.

Until you do, the frontend cannot complete OIDC login.

### Inspecting and stopping the deployment

```sh
docker compose ps
docker compose logs -f
docker compose down          # stop; keeps named volumes
docker compose down -v       # also delete persisted database data
```

### Quick, development-style alternative: `deploy.sh`

`deploy.sh` targets the same kind of Ubuntu server but skips Keycloak/OIDC setup entirely — it runs with OIDC disabled and Keycloak's default local admin credentials, the same as local development below. **This is not secure for a public server** and should only be used for throwaway/test servers.

```sh
./deploy.sh
```

## Run locally with Docker Compose (development)

Use this to run Belt on your own machine at `localhost`, for development only.

### Requirements

- Docker Engine
- Docker Compose v2 (`docker compose`)

### Start

1. Copy the example configuration:

   ```sh
   cp .env.example .env
   ```

2. Generate an encryption key and put its output in `BELT_CONNECTION_ENCRYPTION_KEY` in `.env`:

   ```sh
   openssl rand -base64 32
   ```

   Keep this key private and stable. Belt uses it to encrypt saved connection secrets; changing it makes previously encrypted secrets unreadable.

3. Start the application from the repository root:

   ```sh
   docker compose up --build -d
   ```

4. Open [http://localhost](http://localhost).

The local Compose configuration also starts PostgreSQL, Redis, and Keycloak. PostgreSQL and Redis data are stored in Docker volumes. Keycloak is available at [http://localhost:8080](http://localhost:8080), but no Belt realm or client is provisioned automatically. OIDC is disabled in the local example.

To use a different host port for the web interface, set `FRONTEND_PORT` in `.env`. OIDC settings prefixed with `REACT_APP_` are embedded when the frontend is built, so set them in `.env` before running `docker compose up --build`.

To inspect service status and logs:

```sh
docker compose ps
docker compose logs -f
```

Stop the services with `docker compose down`. This preserves named volumes. To also delete the persisted database data, use `docker compose down -v`.

### Configuration and security

`.env.example` contains development-only settings. Replace the example database and Keycloak passwords before exposing the application outside your machine. Do not publish `.env`, encryption keys, or production credentials.

OIDC authentication is disabled in the local example for development. Production deployments must configure an OIDC provider and set the matching frontend and backend OIDC settings; do not use the local authentication settings on a public server.

## License

Belt is distributed under the Apache License 2.0. See [LICENSE](./LICENSE).
