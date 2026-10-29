# Stickman Fight Club

Real-time 2D stickman fighting. Create a lobby, share the 6-character room code, and fight. The host can start a free-for-all, a team deathmatch, or a best-of duel. The training room is still there, with an optional sparring dummy.

The full design is in [docs/SPEC.md](docs/SPEC.md). How the code is split is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Hosting is in [docs/DEPLOY.md](docs/DEPLOY.md).

## Run locally

```bash
npm install
npm run dev
```

That starts the WebSocket server on port 4318 and the page on [http://127.0.0.1:4317](http://127.0.0.1:4317). Vite proxies `/socket.io` to the server.

Enter a name, then **Create lobby** or **Join lobby**. The join link looks like `http://127.0.0.1:4317/?room=K7P4Q2`. **Training room** stays on this computer; uncheck the dummy if you want the arena empty.

```bash
npm test          # physics suite plus lobby and socket tests
npm run build     # typecheck, client bundle, server bundle, one-second headless smoke
npm start         # serve the built server (set STATIC_DIR to also serve the page)
```

## Controls

| Input | Action |
| --- | --- |
| A / D | Move |
| W | Jump |
| S | Crouch |
| Shift | Sprint |
| Mouse | Aim and facing |
| Left mouse | Punch |
| Right mouse | Block |
| Space | Kick |
| E | Grab |
| Q | Throw |
| Esc | Pause |
| F3 | Fixture debug |

On a touch screen, the on-screen buttons drive the same actions. Balance sliders (Upright, leg torque, jump, knockback, gravity, and the rest) apply immediately. Reset tuning restores the defaults.

## Layout

- `packages/shared` — inputs, snapshots, lobby messages
- `packages/sim` — headless Planck / Box2D simulation (up to 8 fighters)
- `packages/client` — Vite, canvas, prediction
- `packages/server` — Socket.IO rooms and the 60 Hz sim
- `deploy/Caddyfile` — HTTPS/WSS reverse proxy example

## Limits right now

Free-for-all, team deathmatch, and duels score kills, respawn (or eliminate), and show a scoreboard. Accounts, weapons, and the other maps are not in yet. Rooms vanish when the process stops. A hard hit can stretch a joint for a single frame; the solver closes it. Grab is one distance joint. See [docs/DEPLOY.md](docs/DEPLOY.md) to put this on a public URL. That deploy has not been done from this workspace.
