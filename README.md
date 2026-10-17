# Belt

Belt is an open-source ETL application for designing and running data workflows. It includes a web interface, a Python API, background workers, scheduling, and metadata storage.

## Features

- Build and monitor workflow chains through a visual interface.
- Work with PostgreSQL, ClickHouse, and Python-based transformations.
- Schedule workflow runs and inspect their execution history.
- Review data lineage and manage transfer packages.

## Install on an Ubuntu server

### Requirements

- A fresh Ubuntu server with a public IPv4 address and root access.
- Network access to GitHub and container/package registries.
- Ports 80 (Belt) and 8080 (Keycloak) accessible from your browser. If your hosting provider uses a firewall, allow these ports there.

### Start

Run these commands **on the remote server as root**:

```sh
apt update
apt install -y git ca-certificates
git clone https://github.com/analytics-engineer/belt-public.git
cd belt-public
bash deploy.cloud.sh <SERVER_IP>
```

Replace `<SERVER_IP>` with your server's public IPv4 address.

The installer:

- Installs Docker Engine and the Docker Compose plugin if needed.
- Synchronizes the checkout with `origin/main` using `git reset --hard`. This discards uncommitted changes to tracked files.
- Creates `.env` on the first run with random database and Keycloak administrator passwords and a connection-encryption key.
- Enables OIDC authentication and configures Belt and Keycloak URLs using the supplied IP.
- Generates `keycloak/belt-realm.json` from the template. Keycloak imports the `belt` realm and its clients on first startup; an existing realm is not overwritten.
- Copies Python examples into `../belt_data/user_workspace/python_scripts/templates` once. You can edit or delete these copies; subsequent installer runs do not restore them. The initialization marker is stored outside the scripts directory, at `../belt_data/.examples_initialized`.
- Builds and starts the containers. Transfer settings use `BELT_ENVIRONMENT=PROD`: import is enabled, export and export creation are disabled.

Open Belt at `http://<SERVER_IP>/` and Keycloak administration at `http://<SERVER_IP>:8080/admin/`. Wait for Keycloak to finish starting before signing in.

The default installation uses HTTP and Keycloak's `start-dev` mode. It does not configure a domain, certificates, or a reverse proxy. `BELT_ENVIRONMENT=PROD` controls Belt's transfer features; it does not enable HTTPS or change Keycloak's startup mode.

### Allow HTTP for a temporary demo

If Keycloak administration shows `HTTPS required`, run the following **on the remote server**, from `~/belt-public`.

Read the generated administrator credentials:

```sh
grep -E '^KEYCLOAK_ADMIN_(USERNAME|PASSWORD)=' .env
```

Authenticate inside the container:

```sh
docker exec -it belt-keycloak /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master --user admin
```

Enter `KEYCLOAK_ADMIN_PASSWORD` when prompted. If you changed the administrator username, replace `admin` in the command.

Allow HTTP for the administration realm:

```sh
docker exec belt-keycloak /opt/keycloak/bin/kcadm.sh update realms/master -s sslRequired=NONE
```

Then open `http://<SERVER_IP>:8080/admin/`. The imported `belt` realm already allows HTTP. If you are reusing an older realm that still requires HTTPS, run:

```sh
docker exec belt-keycloak /opt/keycloak/bin/kcadm.sh update realms/belt -s sslRequired=NONE
```

These settings persist in the Keycloak database across container restarts. A `Resource not found` response for `realms/belt` means the realm was not imported; check `docker compose logs keycloak`.

**HTTP does not encrypt passwords or tokens. Use this setup for a temporary demo with disposable credentials and no sensitive data.** A production deployment needs a separately configured Keycloak `start` setup and HTTPS for public access. This installer does not automate that configuration.

### Create your first Belt user

The realm and clients are imported automatically, but the template contains no users and self-registration is disabled.

1. Sign in to Keycloak administration using the administrator credentials from `.env`.
2. Select the **belt** realm, then open **Users** and create a user.
3. In the user's **Credentials** tab, set a password. For a demo without a password-change prompt, disable **Temporary**.
4. In **Role mapping**, assign client roles from **belt-frontend**. Use **developer** to design and run workflows; add **deploy** if the user should import transfer packages.
5. Open `http://<SERVER_IP>/` and sign in with the new user.

The Keycloak administrator in the `master` realm and the Belt user in the `belt` realm are separate accounts.

## Inspecting and stopping the deployment

Run from the repository directory on the server:

```sh
docker compose ps
docker compose logs -f
```

To stop the containers while preserving data:

```sh
docker compose down
```

**Do not add `-v` unless you intend to delete the Docker volumes containing the databases and Redis data.** User Python files are stored separately in `../belt_data/user_workspace/python_scripts`.

## Re-running the installer

From the repository directory on the server:

```sh
git pull origin main
bash deploy.cloud.sh <SERVER_IP>
```

Back up your data before updating. The installer retains an existing `.env`, databases, and user Python files. It does not replace an existing Keycloak realm or rerun the database initialization SQL against an existing database; this is not an automatic database migration procedure.

Passing a different IP does not update URLs already stored in `.env`. If the server address changes, update the public/OIDC URLs in `.env` and the existing Keycloak client's redirect and origin settings. Frontend `REACT_APP_` settings are embedded during the build.

## Configuration and data

- `.env` contains generated passwords and `BELT_CONNECTION_ENCRYPTION_KEY`. Keep it private and preserve the encryption key: changing it makes saved connection secrets unreadable.
- PostgreSQL, Keycloak's PostgreSQL database, and Redis use Docker volumes.
- User Python files live in `../belt_data/user_workspace/python_scripts`, shared with the backend and workers.
- Back up both the database data and user Python files, together with the private configuration needed to restore them.

## License

Belt is distributed under the Apache License 2.0. See [LICENSE](./LICENSE).
