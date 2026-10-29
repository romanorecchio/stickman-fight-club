# Deploying Stickman Fight Club

One Node process serves the page and the WebSocket lobby on the same port. Friends need `https://` so the socket upgrades to `wss://`. This file is the exact path to a public URL. It is live at <https://stickman-fight-club.fly.dev>.

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
| `SFC_DELAY_MS` | Test-only delay. Leave unset in production. |
| `VITE_SERVER_URL` | Only if the page is hosted somewhere else. Set it before `npm run build`. Leave unset when Node serves the page. |

`deploy/Caddyfile` is the manual TLS option: it proxies `example.com` to `127.0.0.1:4318`.

## No accounts

There are no accounts, logins, or owner sign-in. Players are guests identified by the name they type. The server needs no database and no secrets. `OWNER_USERNAME`, `OWNER_PASSWORD_HASH`, `OWNER_CHAOS_CODE_HASH`, and `SFC_DB` are ignored if they are still set (the live Fly app still has them; they are harmless and can be unset with `fly secrets unset`).

## Fly.io (one command after the app exists)

1. Install the CLI: <https://fly.io/docs/flyctl/install/>
2. `fly auth login`
3. Pick an app name that is not taken. Edit `app` in `fly.toml` if `stickman-fight-club` is taken.
4. `fly apps create stickman-fight-club`
5. Deploy (no secrets are needed):

```bash
fly deploy
```

6. The public URL is `https://<app-name>.fly.dev`. Open it, create a lobby, and send the join link. `fly deploy` prints the hostname. `fly status` shows it again. HTTPS and WebSockets are on that same host. `fly logs` is the process log. `/health` is the check.

No volume is needed. The live app has an old `sfc_data` volume mounted at `/data` from the account era; nothing reads it now.

## Render

`render.yaml` builds the same Dockerfile. In the Render dashboard: New → Blueprint → point it at this repo, or New → Web Service → Docker. The service must be a web service, not a static site, or WebSockets will not connect. After the first deploy, Render shows an `https://….onrender.com` URL.

## After it is up

Open the HTTPS URL in two browsers. Create a lobby in one, join with the code in the other, and start a match. Both should see the same fighters.
