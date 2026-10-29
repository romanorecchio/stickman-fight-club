# Deploying Stickman Fight Club

This is the hosting layout. Nothing in this repo has been deployed for you; the steps below are what you run on a machine you control.

One Node process serves the built page and the WebSocket lobby. Put TLS in front of it so friends get `https://` and `wss://` without a separate socket port.

## Build

```bash
npm install
npm run build
```

The client lands in `packages/client/dist`. The server bundle is `packages/server/dist/index.js`.

## Run

```bash
PORT=4318 \
STATIC_DIR=packages/client/dist \
CORS_ORIGIN=https://play.example.com \
RECONNECT_GRACE_MS=12000 \
npm start
```

| Variable | Meaning |
| --- | --- |
| `PORT` | HTTP + WebSocket port. Default `4318`. |
| `STATIC_DIR` | Folder with `index.html`. When set, the server serves the game and `/health`. |
| `CORS_ORIGIN` | Comma-separated browser origins allowed to open the socket. Use the public site origin. |
| `RECONNECT_GRACE_MS` | How long a dropped player keeps their fighter. Default `12000`. |
| `SFC_DELAY_MS` | Test-only one-way delay on inputs, snapshots, and pings. Leave unset in production. |
| `VITE_SERVER_URL` | Only if the page is hosted somewhere else. Set it **before** `npm run build`. Example: `https://play.example.com`. Leave it unset when Node serves the page on the same origin. |

`GET /health` returns `{ "ok": true, "rooms": N }`.

## HTTPS and WSS

`deploy/Caddyfile` proxies `example.com` to `127.0.0.1:4318`. Caddy gets a certificate and upgrades WebSocket to WSS because the page and the socket share that host. Replace `example.com`, then:

```bash
caddy run --config deploy/Caddyfile
```

Nginx works the same way: proxy `/` and `/socket.io/` to `127.0.0.1:4318` with `Upgrade` and `Connection` headers, and terminate TLS on 443.

Open `https://example.com`, create a lobby, and send the join link. Rooms live in memory on that process. A restart empties them. There is no account database in this phase.
