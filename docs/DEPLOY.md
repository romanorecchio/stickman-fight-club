# Deploying Stickman Fight Club

One Node process serves the page and the WebSocket lobby on the same port. Friends need `https://` so the socket upgrades to `wss://`. This file is the exact path to a public URL. A public preview was not deployed from this workspace: there is no Fly or Render login here.

## What you run locally

```bash
npm install
npm run build
PORT=4318 STATIC_DIR=packages/client/dist npm start
```

`GET /health` returns `{ "ok": true, "rooms": N }`.

| Variable | Meaning |
| --- | --- |
| `PORT` | HTTP and WebSocket port. Default `4318`. |
| `STATIC_DIR` | Folder with `index.html`. Set it in production so Node serves the game. |
| `CORS_ORIGIN` | Comma-separated browser origins. Leave unset when the page and the socket share a host. |
| `RECONNECT_GRACE_MS` | How long a dropped player keeps their fighter. Default `12000`. |
| `SFC_DB` | SQLite file for accounts and the owner audit log. Default `data/accounts.sqlite`. |
| `SFC_DELAY_MS` | Test-only delay. Leave unset in production. |
| `OWNER_USERNAME` | Owner account name. Never put this in frontend code. |
| `OWNER_PASSWORD_HASH` | `scrypt$salt$hash` from the hash script below. |
| `OWNER_CHAOS_CODE_HASH` | Unused. Chaos Control has no lock (see `docs/CHAOS_CONTROL.md`). |
| `VITE_SERVER_URL` | Only if the page is hosted somewhere else. Set it before `npm run build`. Leave unset when Node serves the page. |

`deploy/Caddyfile` is the manual TLS option: it proxies `example.com` to `127.0.0.1:4318`.

## Hash the owner secrets

```bash
node scripts/hash-secret.mjs "a long password"
node scripts/hash-secret.mjs "a second code"
```

Each command prints one `scrypt$...` line. Store those lines as `OWNER_PASSWORD_HASH` and `OWNER_CHAOS_CODE_HASH`. Do not commit them. Do not paste them into the client.

## Fly.io (one command after the app exists)

1. Install the CLI: <https://fly.io/docs/flyctl/install/>
2. `fly auth login`
3. Pick an app name that is not taken. Edit `app` in `fly.toml` if `stickman-fight-club` is taken.
4. `fly apps create stickman-fight-club`
5. Set secrets (use your own hashes):

```bash
fly secrets set \
  OWNER_USERNAME="Roman" \
  OWNER_PASSWORD_HASH="scrypt$…" \
  OWNER_CHAOS_CODE_HASH="scrypt$…" \
  SFC_DB="/data/accounts.sqlite"
```

6. Optional persistence, so accounts survive a restart:

```bash
fly volumes create sfc_data --region iad --size 1
```

Then add this block to `fly.toml` and deploy again:

```toml
[mounts]
  source = "sfc_data"
  destination = "/data"
```

7. Deploy:

```bash
fly deploy
```

8. The public URL is `https://<app-name>.fly.dev`. Open it, create a lobby, and send the join link. `fly deploy` prints the hostname. `fly status` shows it again. HTTPS and WebSockets are on that same host. `fly logs` is the process log. `/health` is the check.

Without the volume, the game still runs. Accounts reset when the machine is recreated.

## Render

`render.yaml` builds the same Dockerfile. In the Render dashboard: New → Blueprint → point it at this repo, or New → Web Service → Docker. The service must be a web service, not a static site, or WebSockets will not connect. After the first deploy, Render shows an `https://….onrender.com` URL. Set `OWNER_USERNAME`, `OWNER_PASSWORD_HASH`, and `OWNER_CHAOS_CODE_HASH` in the service environment. The default database path is on local disk, so stats reset on a new deploy unless you attach a disk and point `SFC_DB` at it.

## After it is up

Open the HTTPS URL in two browsers. Create a lobby in one, join with the code in the other, and start a match. Both should see the same fighters.
