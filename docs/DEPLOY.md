# Deploying Stickman Fight Club

One Node process serves the page and the WebSocket lobby on the same port. Friends need `https://` so the socket upgrades to `wss://`. This file is the exact path to a public URL. The recommended free host is Render (below). The old Fly.io app at <https://stickman-fight-club.fly.dev> still exists, but Fly's free trial stops machines after a few minutes.

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

## Fly.io (needs a paid plan or card after the trial)

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

## Render (free, no card) — the recommended host

`render.yaml` builds the same Dockerfile as a **free** web service (`plan: free`). The free plan needs no payment method. Do not change the plan to `starter` or any paid plan: Render then asks for a card.

One click: [Deploy to Render](https://render.com/deploy?repo=https://github.com/romanorecchio/stickman-fight-club). Sign in with GitHub, keep the free plan, and press **Deploy Blueprint**. Or in the dashboard: New → Blueprint → this repo. It must be a web service, not a static site, or WebSockets will not connect. The URL is `https://stickman-fight-club.onrender.com` (Render adds a suffix if that name is taken). Pushes to `main` redeploy automatically.

Free-plan limits:

- It sleeps after 15 minutes with no HTTP requests or WebSocket messages. The next visit wakes it in about a minute (Render shows a loading page). A match in progress keeps it awake.
- Sleep, restart, or redeploy drops any open rooms. Nothing else is lost: the game keeps no database or files, so no disk is needed.
- 750 free instance-hours per month per workspace (enough for one service running all month), 512 MB RAM, and a monthly outbound-bandwidth allowance. With no card on file, going over suspends the service until the next month instead of billing.

## After it is up

Open the HTTPS URL in two browsers. Create a lobby in one, join with the code in the other, and start a match. Both should see the same fighters.
